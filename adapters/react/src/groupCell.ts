import { type ReactNode, createElement } from "react";

import type { ColumnLeafDef, GridApi, GroupRowNode, RowId, TreeRowNode } from "@omnigrid/core";

import { type ContentBridge, contentToReactNode } from "./content";

type ToggleGroupMethod = (groupId: string) => void;
type GridWithToggleGroup<T> = GridApi<T> & { toggleGroup?: ToggleGroupMethod };

const TREE_DATA_LEVEL_INDENT: number = 20;
// Align leaf labels with group labels after the 24px toggle and 6px gap.
const TREE_DATA_LEAF_CONTROL_OFFSET: number = 30;

function isToggleGroupMethod(method: unknown): method is ToggleGroupMethod {
    return typeof method === "function";
}

function hasTreeDataRowModel<T>(grid: GridApi<T>): boolean {
    return typeof grid.methods.getTreeRows === "function";
}

export function getTreeDataLeafIndent<T>(row: unknown, column: ColumnLeafDef<T>, grid: GridApi<T>): number | undefined {
    if (!hasTreeDataRowModel(grid) || !row || typeof row !== "object" || !("type" in row) || row.type !== "leaf") {
        return undefined;
    }
    if (!("level" in row) || typeof row.level !== "number") return undefined;

    const state = grid.getState();
    const groupBy: string[] = state.groupBy ?? [];
    const mode: "single" | "perLevel" = state.groupColumnMode ?? "single";
    if (!getGroupColumnRole(column, groupBy, mode).isGroupColumn) return undefined;

    return row.level * TREE_DATA_LEVEL_INDENT + TREE_DATA_LEAF_CONTROL_OFFSET;
}

/**
 * Checks whether an arbitrary row node represents a grouping tree node.
 *
 * @api
 */
export function isGroupRowNode<T>(row: unknown): row is GroupRowNode<T> {
    return Boolean(row && typeof row === "object" && "type" in row && (row as TreeRowNode<T>).type === "group");
}

/**
 * Stable row id resolver for pooled rows: tree nodes expose their stable `id` path,
 * whereas regular data rows resolve via `grid.getRowId`.
 *
 * @api
 */
export function poolGetRowId<T>(grid: GridApi<T>, row: unknown, index: number): RowId {
    if (row && typeof row === "object" && "id" in row && "type" in row) {
        return (row as { id: RowId }).id;
    }
    return grid.getRowId(row as T, index);
}

/**
 * Determines whether a column functions as the group column for a row level.
 */
export function getGroupColumnRole<T>(
    column: ColumnLeafDef<T>,
    groupBy: string[],
    mode: "single" | "perLevel",
): { isGroupColumn: boolean; level: number | null } {
    if (!groupBy || groupBy.length === 0) return { isGroupColumn: false, level: null };
    const match = (field: string): boolean => column.id === field || column.field === field;
    if (mode === "single") {
        return match(groupBy[0]) ? { isGroupColumn: true, level: null } : { isGroupColumn: false, level: null };
    }
    for (let level = 0; level < groupBy.length; level += 1) {
        if (match(groupBy[level])) return { isGroupColumn: true, level };
    }
    return { isGroupColumn: false, level: null };
}

/**
 * Returns the grouping value for a leaf row collapsed from a single-child group
 * when the current column is the appropriate display column for the mode.
 *
 * @api
 */
export function getCollapsedGroupDisplay<T>(
    row: unknown,
    column: ColumnLeafDef<T>,
    groupBy: string[],
    mode: "single" | "perLevel",
): { value: string; level: number } | undefined {
    if (!row || typeof row !== "object" || !("collapsedGroup" in row)) return undefined;
    const collapsedGroup = (row as { collapsedGroup?: { field: string; key: string; level: number } }).collapsedGroup;
    if (!collapsedGroup) return undefined;

    const displayValue: boolean =
        mode === "single"
            ? getGroupColumnRole(column, groupBy, mode).isGroupColumn
            : column.id === collapsedGroup.field || column.field === collapsedGroup.field;
    return displayValue ? { value: collapsedGroup.key, level: collapsedGroup.level } : undefined;
}

export interface CellRenderInfo<T> {
    rowId: RowId;
    rowIndex: number;
    column: ColumnLeafDef<T>;
    data: unknown;
}

/**
 * Renders cell content when grouping is active (either group header row or indented leaf).
 * Returns undefined when cell does not require grouping-specific rendering.
 *
 * @api
 */
export function renderGroupCellContent<T>(
    info: CellRenderInfo<T>,
    bridgeArg: ContentBridge<T>,
    grid: GridApi<T>,
): ReactNode | undefined {
    const column: ColumnLeafDef<T> = info.column;
    const node: TreeRowNode<T> = info.data as unknown as TreeRowNode<T>;
    const state = grid.getState();
    const groupBy: string[] = state.groupBy ?? [];
    const mode: "single" | "perLevel" = state.groupColumnMode ?? "single";
    const showGroupValues: boolean = false;
    const showChildCount: boolean = state.showChildCount ?? true;
    const groupRowRenderer = state.groupRowRenderer;

    if (isGroupRowNode<T>(node)) {
        const role = getGroupColumnRole(column, groupBy, mode);
        if (role.isGroupColumn) {
            const level: number = node.level;
            if (mode !== "single" && role.level !== node.level) return null;
            const chevronName: string = node.expanded ? "chevron-down" : "chevron-right";
            const icon: ReactNode = contentToReactNode(bridgeArg.context().api.icons.get(chevronName), bridgeArg);
            const toggleButton: ReactNode = createElement(
                "button",
                {
                    type: "button",
                    className: "omnigrid-icon-button",
                    "data-omnigrid-group-toggle": "",
                    "aria-label": `${node.expanded ? "Collapse" : "Expand"} ${String(node.key)} group`,
                    "aria-expanded": node.expanded,
                    onClick: (event: { stopPropagation: () => void }) => {
                        event.stopPropagation();
                        const gridWithToggleGroup: GridWithToggleGroup<T> = grid as GridWithToggleGroup<T>;
                        const toggleGroup: unknown = grid.methods.toggleGroup ?? gridWithToggleGroup.toggleGroup;
                        if (!isToggleGroupMethod(toggleGroup)) {
                            throw new Error("Cannot toggle group: the grid does not expose a group toggle method.");
                        }
                        toggleGroup.call(grid, node.id);
                    },
                },
                icon,
            );
            if (groupRowRenderer) {
                const rendered: unknown = (groupRowRenderer as (params: unknown) => unknown)({
                    node: node as GroupRowNode<T>,
                    column,
                    id: info.rowId,
                    index: info.rowIndex,
                    api: grid,
                    state,
                });
                return contentToReactNode(rendered, bridgeArg);
            }
            if (showChildCount) {
                return createElement(
                    "span",
                    {
                        className: "omnigrid-group-cell-content",
                        style: { paddingLeft: mode === "single" ? level * 20 : 0 },
                    },
                    toggleButton,
                    createElement("span", { className: "omnigrid-group-cell-label omnigrid-cell-truncated" }, node.key),
                    createElement("span", { className: "omnigrid-group-cell-count" }, `(${node.childrenCount})`),
                );
            }
            return createElement(
                "span",
                {
                    className: "omnigrid-group-cell-content",
                    style: { paddingLeft: mode === "single" ? level * 20 : 0 },
                },
                toggleButton,
                createElement("span", { className: "omnigrid-group-cell-label omnigrid-cell-truncated" }, node.key),
            );
        }
        if (column.cellRenderer) {
            const value: unknown = node.aggregations[column.id];
            const rendered: unknown = (column.cellRenderer as (params: unknown) => unknown)({
                value,
                data: undefined,
                column,
                id: info.rowId,
                index: info.rowIndex,
            });
            const content = contentToReactNode(rendered, bridgeArg);
            if (column.valueFormatter && typeof value === "number") {
                const formatted = column.valueFormatter(value);
                // For numeric aggregations, prefer formatted output if renderer returns simple value
            }
            return content;
        }
        // Non-group column within a group row: show pre-computed aggregate.
        const value: unknown = node.aggregations[column.id];
        return column.valueFormatter ? column.valueFormatter(value) : String(value ?? "");
    }

    if (getCollapsedGroupDisplay(node, column, groupBy, mode) !== undefined) return undefined;

    if (!hasTreeDataRowModel(grid) && groupBy.length > 0 && mode === "single") {
        const role = getGroupColumnRole(column, groupBy, mode);
        if (role.isGroupColumn) {
            return createElement("span", { style: { paddingLeft: node.level * 20 } });
        }
        const isGroupField: boolean = groupBy.some((g: string) => column.id === g || column.field === g);
        if (isGroupField) {
            return createElement("span");
        }
    }
    if (!hasTreeDataRowModel(grid) && groupBy.length > 0 && mode === "perLevel") {
        const role = getGroupColumnRole(column, groupBy, mode);
        if (role.isGroupColumn && !showGroupValues) {
            return createElement("span");
        }
    }

    return undefined;
}

/**
 * Generates placeholder text for group rows during fast scrolling.
 * Returns undefined when standard placeholder should be used.
 *
 * @api
 */
export function renderGroupCellPlaceholder<T>(
    info: CellRenderInfo<T>,
    grid: GridApi<T>,
): string | undefined {
    const column: ColumnLeafDef<T> = info.column;
    const node: TreeRowNode<T> = info.data as unknown as TreeRowNode<T>;
    const state = grid.getState();
    const groupBy: string[] = state.groupBy ?? [];
    const mode: "single" | "perLevel" = state.groupColumnMode ?? "single";
    const showGroupValues: boolean = false;
    const showChildCount: boolean = state.showChildCount ?? true;
    const groupRowRenderer = state.groupRowRenderer;

    if (isGroupRowNode<T>(node)) {
        const role = getGroupColumnRole(column, groupBy, mode);
        if (role.isGroupColumn) {
            const level: number = node.level;
            if (mode !== "single" && role.level !== node.level) return "";
            if (groupRowRenderer) {
                const rendered: unknown = (groupRowRenderer as (params: unknown) => unknown)({
                    node: node as GroupRowNode<T>,
                    column,
                    id: info.rowId,
                    index: info.rowIndex,
                    api: grid,
                    state,
                });
                if (typeof rendered === "string" || typeof rendered === "number" || typeof rendered === "boolean") {
                    return String(rendered);
                }
            }
            if (showChildCount) {
                return `${node.expanded ? "▼" : "▶"} ${node.key} (${node.childrenCount})`;
            }
            return `${node.expanded ? "▼" : "▶"} ${node.key}`;
        }
        if (column.cellRenderer) return undefined;
        const value: unknown = node.aggregations[column.id];
        return column.valueFormatter ? column.valueFormatter(value) : String(value ?? "");
    }

    if (getCollapsedGroupDisplay(node, column, groupBy, mode) !== undefined) return undefined;

    if (!hasTreeDataRowModel(grid) && groupBy.length > 0 && mode === "single") {
        const role = getGroupColumnRole(column, groupBy, mode);
        if (role.isGroupColumn) return "";
        const isGroupField: boolean = groupBy.some((g: string) => column.id === g || column.field === g);
        if (isGroupField) return "";
    }
    if (!hasTreeDataRowModel(grid) && groupBy.length > 0 && mode === "perLevel") {
        const role = getGroupColumnRole(column, groupBy, mode);
        if (role.isGroupColumn && !showGroupValues) return "";
    }

    return undefined;
}
