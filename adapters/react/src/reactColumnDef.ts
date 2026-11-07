import type { ReactNode } from "react";

import type { CellRenderParams, ColumnGroupDef, ColumnLeafDef, GridOptions } from "@omnigrid/core";

/**
 * React cell renderer accepted by the React adapter.
 *
 * @api
 */
export type ReactCellRenderer<T> = (params: CellRenderParams<T>) => ReactNode;

/**
 * Context supplied to a custom cell or header tooltip renderer.
 *
 * @api
 */
export interface CellTooltipRenderContext {
    /** Bounds of the truncated text or header label in viewport coordinates. */
    anchorRect: DOMRectReadOnly;
    /** Pointer position in viewport coordinates, or `null` when unavailable. */
    pointer: { clientX: number; clientY: number } | null;
    /** Whether the truncated content belongs to a data cell or a header. */
    source: "cell" | "header";
    /** Column identifier for data cells; group headers may not have one. */
    columnId?: string;
    /** Side of the anchor where the tooltip is displayed after viewport collision handling. */
    placement: "top" | "bottom";
}

/**
 * Renders the full text of a truncated cell or header in its hover tooltip.
 *
 * @api
 */
export type CellTooltipRenderer = (text: string, context?: CellTooltipRenderContext) => ReactNode;

/**
 * Leaf column definition with a renderer typed for React content.
 *
 * @api
 */
export type ReactColumnLeafDef<T> = Omit<ColumnLeafDef<T>, "cellRenderer"> & {
    /** Replaces the default cell content with a React node. */
    cellRenderer?: ReactCellRenderer<T>;
    /** Overrides the grid-level renderer for this column's truncated cell content. */
    cellTooltipRenderer?: CellTooltipRenderer;
    /** Overrides the grid-level class for this column's truncated cell tooltip. */
    cellTooltipClassName?: string;
};

/**
 * Column group definition whose children use React-specific column types.
 *
 * @api
 */
export type ReactColumnGroupDef<T> = Omit<ColumnGroupDef<T>, "children"> & {
    children: ReactColumnDef<T>[];
};

/**
 * Leaf or grouped column definition accepted by the React adapter.
 *
 * @api
 */
export type ReactColumnDef<T> = ReactColumnLeafDef<T> | ReactColumnGroupDef<T>;

/**
 * Core grid options with React-specific column definitions.
 *
 * @api
 */
export type ReactGridOptions<T> = Omit<GridOptions<T>, "columns" | "defaultColumnDef"> & {
    columns: ReactColumnDef<T>[];
    defaultColumnDef?: Partial<Omit<ReactColumnLeafDef<T>, "id" | "header">>;
};
