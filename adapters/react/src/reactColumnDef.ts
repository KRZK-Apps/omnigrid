import type { ReactNode } from "react";

import type { CellRenderParams, ColumnGroupDef, ColumnLeafDef, GridOptions } from "@omnigrid/core";

/**
 * React cell renderer accepted by the React adapter.
 *
 * @api
 */
export type ReactCellRenderer<T> = (params: CellRenderParams<T>) => ReactNode;

/**
 * Leaf column definition with a renderer typed for React content.
 *
 * @api
 */
export type ReactColumnLeafDef<T> = Omit<ColumnLeafDef<T>, "cellRenderer"> & {
    /** Replaces the default cell content with a React node. */
    cellRenderer?: ReactCellRenderer<T>;
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
export type ReactGridOptions<T> = Omit<GridOptions<T>, "columns"> & {
    columns: ReactColumnDef<T>[];
};
