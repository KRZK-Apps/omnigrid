import { createElement, type ReactNode } from "react";
import type { ColumnLeafDef, GridApi, GroupRowNode, RowId, TreeRowNode } from "@omnigrid/core";
import { type ContentBridge, contentToReactNode } from "./content";

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
                        style: { paddingLeft: mode === "single" ? level * 20 : 0, display: "flex", alignItems: "center", gap: 6 },
                        title: String(node.key),
                    },
                    icon,
                    " ",
                    node.key,
                    " (",
                    node.childrenCount,
                    ")",
                );
            }
            return createElement(
                "span",
                {
                    style: { paddingLeft: mode === "single" ? level * 20 : 0, display: "flex", alignItems: "center", gap: 6 },
                    title: String(node.key),
                },
                icon,
                " ",
                node.key,
            );
        }
        if (column.cellRenderer) return undefined;
        // Non-group column within a group row: show pre-computed aggregate.
        const value: unknown = node.aggregations[column.id];
        return column.valueFormatter ? column.valueFormatter(value) : String(value ?? "");
    }

    if (groupBy.length > 0 && mode === "single") {
        const role = getGroupColumnRole(column, groupBy, mode);
        if (role.isGroupColumn) {
            return createElement("span", { style: { paddingLeft: node.level * 20 } });
        }
        const isGroupField: boolean = groupBy.some((g: string) => column.id === g || column.field === g);
        if (isGroupField) {
            return createElement("span");
        }
    }
    if (groupBy.length > 0 && mode === "perLevel") {
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

    if (groupBy.length > 0 && mode === "single") {
        const role = getGroupColumnRole(column, groupBy, mode);
        if (role.isGroupColumn) return "";
        const isGroupField: boolean = groupBy.some((g: string) => column.id === g || column.field === g);
        if (isGroupField) return "";
    }
    if (groupBy.length > 0 && mode === "perLevel") {
        const role = getGroupColumnRole(column, groupBy, mode);
        if (role.isGroupColumn && !showGroupValues) return "";
    }

    return undefined;
}
