import type { AggregationFunc, DataRowNode, GridApi, GridPlugin, GridState, GroupRowNode, RowHierarchyScope, RowId, TreeRowNode } from "@omnigrid/core";
import type { ResolvedAggregationFunc } from "@omnigrid/aggregation-plugin";
import { buildGroupTree, computeAggregations, flattenTree } from "./groupingPipeline";
import type { BuildGroupNode } from "./groupingPipeline";
import type { GroupingPluginOptions, GroupingColumnConfig } from "./types";

export type { GroupingPluginOptions, GroupingColumnConfig } from "./types";
export { buildGroupTree, computeAggregations, flattenTree } from "./groupingPipeline";

interface HierarchyCache<T> {
    data: T[];
    groupByKey: string;
    leafIds: Map<RowId, readonly RowId[]>;
}

/**
 * Headless row grouping plugin: collapses rows that share a value on grouped
 * fields into expandable group rows, computes group aggregations, and provides
 * grouping methods on `GridApi`.
 *
 * @api
 */
export class GroupingPlugin<T> implements GridPlugin<T> {
    public readonly name: string = "@omnigrid/grouping-plugin";
    private api?: GridApi<T>;
    private readonly initialGroupBy: string[];
    private readonly initialExpandedGroups: Record<string, boolean>;
    private config: GroupingColumnConfig;
    private groupedRowsCache: TreeRowNode<T>[] | null = null;
    private groupedRowsRevision: number = -1;
    private readonly aggregationFuncs: Map<string, AggregationFunc<T>> = new Map();
    private unregisterMethods?: () => void;
    private unregisterRowHierarchy?: () => void;
    private readonly hierarchyCache = new Map<RowHierarchyScope, HierarchyCache<T>>();
    private readonly collapseSingleChildGroups: boolean;

    public constructor(options: GroupingPluginOptions<T> = {}) {
        this.initialGroupBy = options.groupBy ?? [];
        this.initialExpandedGroups = options.expandedGroups ?? {};
        this.config = {
            mode: options.groupColumnMode ?? "single",
            header: options.groupColumnHeader ?? "Group",
            showGroupValues: options.showGroupValues ?? false,
            showChildCount: true,
            groupRowRenderer: undefined,
        };
        this.collapseSingleChildGroups = options.collapseSingleChildGroups ?? false;
    }

    public register(api: GridApi<T>): () => void {
        this.api = api;

        // Initialize state slice
        api.setState((prev) => ({
            ...prev,
            groupBy: [...this.initialGroupBy],
            expandedGroups: { ...this.initialExpandedGroups },
            groupColumnMode: this.config.mode,
            groupColumnHeader: this.config.header,
            showChildCount: this.config.showChildCount,
            groupRowRenderer: this.config.groupRowRenderer,
        }));

        // Register grouping API methods
        this.unregisterMethods = api.registerMethods({
            setGroupBy: (fields: string[] | null | undefined, expandedGroups?: Record<string, boolean>) => this.setGroupBy(fields, expandedGroups),
            toggleGroup: (groupId: string) => this.toggleGroup(groupId),
            expandAll: () => this.expandAll(),
            collapseAll: () => this.collapseAll(),
            setExpandedGroups: (expandedGroups: Record<string, boolean>) => this.setExpandedGroups(expandedGroups),
            setGroupColumnConfig: (config: Partial<GroupingColumnConfig>) => this.setGroupColumnConfig(config),
            getGroupedRows: () => this.getGroupedRows(),
            registerAggregationFuncs: (funcs: Record<string, AggregationFunc<T>>) => this.registerAggregationFuncs(funcs),
        });
        this.syncRowHierarchyRegistration();

        return () => {
            this.unregisterMethods?.();
            this.unregisterMethods = undefined;
            this.unregisterRowHierarchy?.();
            this.unregisterRowHierarchy = undefined;
            if (this.api && !this.api.isDestroyed()) {
                this.api.setState((prev) => ({
                    ...prev,
                    groupBy: [],
                    expandedGroups: {},
                }));
            }
            this.groupedRowsCache = null;
            this.groupedRowsRevision = -1;
            this.aggregationFuncs.clear();
            this.hierarchyCache.clear();
            this.api = undefined;
        };
    }

    /** Replaces the active grouping fields. Pass `[]` / `null` to disable grouping. */
    public setGroupBy(fields: string[] | null | undefined, expandedGroups?: Record<string, boolean>): void {
        if (!this.api) return;
        const next: string[] = fields ? [...fields] : [];
        this.groupedRowsCache = null;
        this.groupedRowsRevision = -1;
        this.api.setState((prev) => ({
            ...prev,
            groupBy: next,
            expandedGroups: expandedGroups ?? {},
        }));
        this.syncRowHierarchyRegistration();
        this.api.scrollTo({ scrollTop: 0 });
    }

    /** Toggles the expanded state of a single group by its stable id. */
    public toggleGroup(groupId: string): void {
        if (!this.api) return;
        const state = this.api.getState();
        const current: Record<string, boolean> = state.expandedGroups ?? {};
        const next: Record<string, boolean> = { ...current };
        next[groupId] = current[groupId] === false;
        this.groupedRowsCache = null;
        this.groupedRowsRevision = -1;
        this.api.setState((prev) => ({ ...prev, expandedGroups: next }));
    }

    /** Expands every group. */
    public expandAll(): void {
        if (!this.api) return;
        const state = this.api.getState();
        const next: Record<string, boolean> = { ...(state.expandedGroups ?? {}) };
        this.getGroupedRows()
            .filter((row): row is GroupRowNode<T> => row.type === "group")
            .forEach((group) => {
                next[group.id] = true;
            });
        this.groupedRowsCache = null;
        this.groupedRowsRevision = -1;
        this.api.setState((prev) => ({ ...prev, expandedGroups: next }));
    }

    /** Collapses every group. */
    public collapseAll(): void {
        if (!this.api) return;
        const state = this.api.getState();
        const next: Record<string, boolean> = { ...(state.expandedGroups ?? {}) };
        this.getGroupedRows()
            .filter((row): row is GroupRowNode<T> => row.type === "group")
            .forEach((group) => {
                next[group.id] = false;
            });
        this.groupedRowsCache = null;
        this.groupedRowsRevision = -1;
        this.api.setState((prev) => ({ ...prev, expandedGroups: next }));
    }

    /** Replaces the expanded-state map for groups. */
    public setExpandedGroups(expandedGroups: Record<string, boolean>): void {
        if (!this.api) return;
        const state = this.api.getState();
        const next: Record<string, boolean> = { ...expandedGroups };
        const changed: boolean = JSON.stringify(next) !== JSON.stringify(state.expandedGroups);
        if (!changed) return;
        this.groupedRowsCache = null;
        this.groupedRowsRevision = -1;
        this.api.setState((prev) => ({ ...prev, expandedGroups: next }));
    }

    /** Configures the group column UI mode and header. */
    public setGroupColumnConfig(config: Partial<GroupingColumnConfig>): void {
        this.config = { ...this.config, ...config };
        if (this.api) {
            this.api.setState((prev) => ({
                ...prev,
                groupColumnMode: this.config.mode,
                groupColumnHeader: this.config.header,
                showChildCount: this.config.showChildCount,
                groupRowRenderer: this.config.groupRowRenderer,
            }));
        }
    }

    public getGroupColumnConfig(): GroupingColumnConfig {
        return { ...this.config };
    }

    /** Current grouping fields in nesting order. */
    public getGroupBy(): string[] {
        return this.api ? [...(this.api.getState().groupBy ?? [])] : [...this.initialGroupBy];
    }

    /** Current expanded-state map keyed by stable group id. */
    public getExpandedGroups(): Record<string, boolean> {
        return this.api ? { ...(this.api.getState().expandedGroups ?? {}) } : { ...this.initialExpandedGroups };
    }

    /**
     * Registers column id -> aggregation function mappings.
     * @param funcs - Column id to aggregation function map.
     * @returns Unregister function.
     * @api
     */
    public registerAggregationFuncs(funcs: Record<string, ResolvedAggregationFunc<T>>): () => void {
        for (const [key, func] of Object.entries(funcs)) {
            this.aggregationFuncs.set(key, func);
        }
        this.groupedRowsCache = null;
        this.groupedRowsRevision = -1;
        const registeredKeys: string[] = Object.keys(funcs);
        return () => {
            for (const key of registeredKeys) {
                this.aggregationFuncs.delete(key);
            }
            this.groupedRowsCache = null;
            this.groupedRowsRevision = -1;
        };
    }

    /**
     * Returns flattened `TreeRowNode[]` consumed by the virtualizer when
     * grouping is active; empty array when grouping is disabled.
     * @returns Flattened group and leaf rows.
     * @api
     */
    public getGroupedRows(): TreeRowNode<T>[] {
        if (!this.api) return [];
        const state = this.api.getState();
        const groupBy: string[] = state.groupBy ?? [];
        if (groupBy.length === 0) {
            this.groupedRowsCache = null;
            this.groupedRowsRevision = -1;
            return [];
        }

        const revision: number = this.api.getRevision();
        if (this.groupedRowsCache !== null && this.groupedRowsRevision === revision) {
            return this.groupedRowsCache;
        }

        const processed: T[] = this.api.getProcessedData();
        const getStableRowId: (row: T, index: number) => RowId = this.createStableRowIdResolver(state.data);
        const root: BuildGroupNode<T> | null = buildGroupTree(processed, groupBy, state.expandedGroups ?? {}, getStableRowId);
        if (!root) return [];

        const aggregations = Object.fromEntries(this.aggregationFuncs);
        computeAggregations(root, aggregations);
        const flat: TreeRowNode<T>[] = flattenTree(root, state.expandedGroups ?? {}, this.collapseSingleChildGroups);

        // When collapseSingleChildGroups is enabled, record the grouping field
        // and value on leaf rows whose parent group was collapsed (i.e. not
        // rendered as a separate group row). Adapters can read this to display
        // the grouping value in the group column instead of the row's own field.
        if (this.collapseSingleChildGroups) {
            const renderedGroupIds = new Set<string>();
            for (const row of flat) {
                if (row.type === "group") {
                    renderedGroupIds.add(row.id);
                }
            }
            for (const row of flat) {
                if (row.type === "leaf" && row.parent && !renderedGroupIds.has(row.parent.id)) {
                    (row as DataRowNode<T>).collapsedGroup = {
                        field: row.parent.field,
                        key: row.parent.key,
                        level: row.parent.level,
                    };
                }
            }
        }

        this.groupedRowsCache = flat;
        this.groupedRowsRevision = revision;
        return flat;
    }

    private getLeafRowIds(rowId: RowId, scope: RowHierarchyScope): readonly RowId[] | undefined {
        if (!this.api) return undefined;
        const state: GridState<T> = this.api.getState();
        const groupBy: string[] = state.groupBy ?? [];
        if (groupBy.length === 0) return undefined;
        const data: T[] = scope === "all" ? state.data : this.api.getFilteredData();
        const groupByKey: string = JSON.stringify(groupBy);
        let cached: HierarchyCache<T> | undefined = this.hierarchyCache.get(scope);
        if (!cached || cached.data !== data || cached.groupByKey !== groupByKey) {
            const root: BuildGroupNode<T> | null = buildGroupTree(data, groupBy, {}, this.createStableRowIdResolver(state.data));
            if (!root) return undefined;
            const leafIds: Map<RowId, readonly RowId[]> = new Map<RowId, readonly RowId[]>();
            const visit = (group: BuildGroupNode<T>): RowId[] => {
                const ids: RowId[] = group.leaves.map((leaf) => leaf.id);
                for (const child of group.children) {
                    if (child.type === "group") ids.push(...visit(child as BuildGroupNode<T>));
                }
                leafIds.set(group.id, ids);
                return ids;
            };
            visit(root);
            cached = { data, groupByKey, leafIds };
            this.hierarchyCache.set(scope, cached);
        }
        return cached.leafIds.get(rowId);
    }

    private createStableRowIdResolver(sourceData: T[]): (row: T, index: number) => RowId {
        const sourceIndexes: Map<T, number[]> = new Map<T, number[]>();
        sourceData.forEach((row, index) => {
            const indexes: number[] = sourceIndexes.get(row) ?? [];
            indexes.push(index);
            sourceIndexes.set(row, indexes);
        });
        const occurrences: Map<T, number> = new Map<T, number>();
        return (row: T, index: number): RowId => {
            const occurrence: number = occurrences.get(row) ?? 0;
            occurrences.set(row, occurrence + 1);
            const sourceIndex: number | undefined = sourceIndexes.get(row)?.[occurrence];
            return this.api!.getRowId(row, sourceIndex ?? index);
        };
    }

    private syncRowHierarchyRegistration(): void {
        if (!this.api) return;
        const groupingActive: boolean = (this.api.getState().groupBy ?? []).length > 0;
        if (groupingActive && !this.unregisterRowHierarchy) {
            this.unregisterRowHierarchy = this.api.registerRowHierarchy({
                getLeafRowIds: (rowId, scope) => this.getLeafRowIds(rowId, scope),
            });
        } else if (!groupingActive && this.unregisterRowHierarchy) {
            this.unregisterRowHierarchy();
            this.unregisterRowHierarchy = undefined;
            this.hierarchyCache.clear();
        }
    }
}
