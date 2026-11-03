import type { ReactNode } from "react";

import type { SlotRenderContext, UIInputControl } from "@omnigrid/core";

import type { CellRoot } from "./reactRoot";
import type { ReactGridOptions } from "./reactColumnDef";

/**
 * Bridge between the core's headless content and native adapter values.
 * `registry` — registry of React components for `SlotComponentContent`;
 * `context()` — factory for the current render context so providers see
 * up-to-date grid state at render time.
 */
export interface ContentBridge<T> {
    registry: Record<string, (payload: unknown, context: SlotRenderContext<T>) => ReactNode>;
    context: () => SlotRenderContext<T>;
}

/** Column within the pool: definition + geometry from the virtual window. */
export type PooledColumn<T> = import("@omnigrid/core").ViewportData<T>["columns"][number];

export interface PooledCellRenderInfo<T> {
    data: T;
    column: import("@omnigrid/core").ColumnLeafDef<T>;
    columnIndex: number;
    rowId: import("@omnigrid/core").RowId;
    rowIndex: number;
    /**
     * Normalized horizontal span of this cell (`1` = plain cell).
     * Span origins render the merged width; covered cells are skipped.
     */
    colSpan: number;
}

export interface PooledRowModifiers {
    ctrlKey: boolean;
    shiftKey: boolean;
}

/**
 * Injected back-channel: the row panel does NOT know about grid/adapter —
 * it only fires these callbacks. This allows the panel to be reused across
 * any adapter with a DOM environment.
 */
export interface PooledRowCallbacks<T> {
    rowHeight: number;
    renderCellContent(info: PooledCellRenderInfo<T>): unknown;
    resolveRowClasses(row: import("@omnigrid/core").PooledRow<T>): string | undefined;
    resolveRowStyle(row: import("@omnigrid/core").PooledRow<T>): import("@omnigrid/core").RowStyle | undefined;
    resolveCellClasses(cellInfo: PooledCellRenderInfo<T>): string | undefined;
    resolveCellStyle(cellInfo: PooledCellRenderInfo<T>): import("@omnigrid/core").RowStyle | undefined;
    onRowClick(row: import("@omnigrid/core").PooledRow<T>, modifiers: PooledRowModifiers): void;
    onRowHover(row: import("@omnigrid/core").PooledRow<T>, hovered: boolean): void;
    onCellClick(row: import("@omnigrid/core").PooledRow<T>, column: import("@omnigrid/core").ColumnLeafDef<T>, modifiers: PooledRowModifiers): void;
    createRoot(container: HTMLDivElement): CellRoot;
    onRowHeightChange?(rowIndex: number, height: number): void;
    /**
     * Returns a cheap scalar preview of the cell value, painted synchronously
     * into a blank cell while its first React commit (complex content) is
     * pending — keeps the grid from showing empty cells during fast scroll
     * ("staging" placeholder; React's first commit replaces it entirely).
     * Return `null` to skip staging for this cell.
     *
     * @api
     */
    renderCellPlaceholder?(info: PooledCellRenderInfo<T>): string | null;
}

export interface DebouncedInputProps {
    descriptor: UIInputControl;
}

export interface PopupHostProps<T> {
    grid: import("@omnigrid/core").GridApi<T>;
}

export interface UseGridResult<T> {
    grid: import("@omnigrid/core").Grid<T>;
    state: import("@omnigrid/core").GridState<T>;
    viewportData: import("@omnigrid/core").ViewportData<T>;
}

/**
 * Registry of native adapter components for `SlotComponentContent`:
 *   slotComponents={{ ["my-widget"]: (payload, context) => <MyWidget .../> }}
 */
export interface SlotRendererRegistry<T> {
    [kind: string]: (payload: unknown, context: SlotRenderContext<T>) => ReactNode;
}

export type OverlayComponentProps<T> = import("@omnigrid/core").OverlayComponentProps<T>;

export type OverlayComponent<T> =
    import("react").ComponentType<import("@omnigrid/core").OverlayComponentProps<T>> | import("@omnigrid/core").OverlayComponent<T>;

export interface GridProps<T> extends Omit<ReactGridOptions<T>, "overlayComponents"> {
    className?: string;
    style?: import("react").CSSProperties;
    /**
     * Minimum grid height in rows when `style.height` is not set (auto-height
     * mode). The viewport will be at least `headerHeight + minHeight *
     * rowHeight` tall so the grid does not collapse when it has few or no
     * rows. Set to `0` to disable.
     *
     * @api
     * @default 3
     */
    minHeight?: number;
    slotComponents?: SlotRendererRegistry<T>;
    overlayComponents?: Record<string, import("@omnigrid/core").OverlayComponent<T>>;
}

/**
 * Pre-resolved presentation (classes and inline styles) for a column data body.
 * Evaluated once per column across the dataset, then applied to each rendered cell in O(1).
 *
 * @api
 */
export interface ResolvedColumnPresentation {
    /** Space-separated CSS class names for the column body. */
    classes: string;
    /** Combined inline styles for the column body. */
    style: import("@omnigrid/core").ColumnStyle;
}
