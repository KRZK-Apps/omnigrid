import type { AggregationFunc, GridApi, GridPlugin, GroupRowNode, TreeRowNode } from "@omnigrid/core";
import type { ResolvedAggregationFunc } from "@omnigrid/aggregation-plugin";
import { buildGroupTree, computeAggregations, flattenTree } from "./groupingPipeline";
import type { GroupingPluginOptions, GroupingColumnConfig } from "./types";

export type { GroupingPluginOptions, GroupingColumnConfig } from "./types";
export { buildGroupTree, computeAggregations, flattenTree } from "./groupingPipeline";

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

        return () => {
            this.unregisterMethods?.();
            this.unregisterMethods = undefined;
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
        const root = buildGroupTree(processed, groupBy, state.expandedGroups ?? {}, (row: T, index: number) => this.api!.getRowId(row, index));
        if (!root) return [];

        const aggregations = Object.fromEntries(this.aggregationFuncs);
        computeAggregations(root, aggregations);
        const flat: TreeRowNode<T>[] = flattenTree(root, state.expandedGroups ?? {});

        this.groupedRowsCache = flat;
        this.groupedRowsRevision = revision;
        return flat;
    }
}
