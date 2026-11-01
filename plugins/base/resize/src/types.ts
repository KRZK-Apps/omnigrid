import type { ColumnDef } from "@omnigrid/core";

/**
 * Live drag-guide state for the currently resizing column.
 */
export interface ColumnResizeGuide {
    /** ID of the column being resized. */
    columnId: string;
    /** Current pointer x-coordinate, in viewport pixels. */
    x: number;
    /** Whether the guide is currently visible. */
    visible: boolean;
}

/**
 * Configuration for the column resize plugin.
 */
export interface ColumnResizePluginOptions<T> {
    /** Called with the column id and clamped width each time the width changes during a drag. */
    onResize?: (columnId: string, width: number) => void;
    /** Called when a drag begins, with the column id and its starting width. */
    onResizeStart?: (columnId: string, width: number) => void;
    /** Called when a drag completes, with the column id and its final width. */
    onResizeEnd?: (columnId: string, width: number) => void;
}
