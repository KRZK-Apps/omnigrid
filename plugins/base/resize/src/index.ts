import type { ColumnDef, ColumnLeafDef, GridApi, GridPlugin, SlotNodeContent, SlotNodeEvent, SlotRenderContext } from "@omnigrid/core";
import { flattenColumns, isColumnGroup } from "@omnigrid/core";

export interface ColumnResizeGuide {
    columnId: string;
    x: number;
    visible: boolean;
}

export interface ColumnResizePluginOptions<T> {
    onResize?: (columnId: string, width: number) => void;
    onResizeStart?: (columnId: string, width: number) => void;
    onResizeEnd?: (columnId: string, width: number) => void;
}

/**
 * Headless column-resize controller.
 *
 * The plugin owns the resizing state and writes the next width back into the
 * Grid state store via `api.setColumns()`. Adapter code can wire the actual DOM
 * handle and pointer events to the plugin methods without needing to know the
 * internal column hierarchy.
 */
export class ColumnResizePlugin<T> implements GridPlugin<T> {
    public readonly name = "@omnigrid/column-resize-plugin";
    private api?: GridApi<T>;
    private activeResize?: {
        columnId: string;
        startX: number;
        startWidth: number;
        direction: 1 | -1;
    };
    private guide: ColumnResizeGuide = { columnId: "", x: 0, visible: false };
    private readonly onResize?: (columnId: string, width: number) => void;
    private readonly onResizeStart?: (columnId: string, width: number) => void;
    private readonly onResizeEnd?: (columnId: string, width: number) => void;

    public constructor(options: ColumnResizePluginOptions<T> = {}) {
        this.onResize = options.onResize;
        this.onResizeStart = options.onResizeStart;
        this.onResizeEnd = options.onResizeEnd;
    }

    public register(api: GridApi<T>): () => void {
        this.api = api;
        this.api.setColumns(this.attachResizeHandles(this.api.getState().columns));
        const unregisterPointerHandlers = this.bindPointerHandlers();

        return () => {
            unregisterPointerHandlers();
            this.clearGuide();
            this.activeResize = undefined;
            this.api = undefined;
        };
    }

    /** Returns the current width of a leaf column. */
    public getColumnWidth(columnId: string): number | undefined {
        const column = this.findLeafColumn(columnId);
        if (!column) return undefined;
        if (column.width !== undefined) return column.width;

        if (this.api) return this.api.getColumnWidth(columnId) ?? column.minWidth ?? 40;

        return 120;
    }

    private canResizeColumn(column: ColumnLeafDef<T> | undefined): boolean {
        return !!column && column.resizable !== false;
    }

    /** Alias for `getColumnWidth`. */
    public getWidth(columnId: string): number | undefined {
        return this.getColumnWidth(columnId);
    }

    /** Sets a column width and clamps it to the configured min/max constraints. */
    public setColumnWidth(columnId: string, width: number): number {
        if (!this.api) return width;
        const column = this.findLeafColumn(columnId);
        if (!column || !this.canResizeColumn(column)) return this.getColumnWidth(columnId) ?? width;

        const nextWidth = this.clampWidth(column, width);
        const columns = this.api.getState().columns;
        const fixedFlexWidths = new Map<string, number>();
        if (!column.pinned) {
            const visibleScrollable = flattenColumns(columns).filter((leaf) => !leaf.hidden && !leaf.pinned);
            const targetIndex = visibleScrollable.findIndex((leaf) => leaf.id === columnId);
            for (const leaf of targetIndex > 0 ? visibleScrollable.slice(0, targetIndex) : []) {
                if (leaf.flex && leaf.flex > 0 && leaf.width === undefined) {
                    const currentWidth = this.api.getColumnWidth(leaf.id);
                    if (currentWidth !== undefined) fixedFlexWidths.set(leaf.id, currentWidth);
                }
            }
        }

        const updated = this.updateColumns(columns, (leaf) => {
            if (leaf.id === columnId) {
                return leaf.flex && leaf.flex > 0 && leaf.width === undefined
                    ? this.withFixedWidth(leaf, nextWidth)
                    : { ...leaf, width: nextWidth };
            }
            const fixedWidth = fixedFlexWidths.get(leaf.id);
            return fixedWidth === undefined ? leaf : this.withFixedWidth(leaf, fixedWidth);
        });
        this.api.setColumns(updated);
        this.onResize?.(columnId, nextWidth);
        return nextWidth;
    }

    /** Alias for `setColumnWidth`. */
    public setWidth(columnId: string, width: number): number {
        return this.setColumnWidth(columnId, width);
    }

    /** Changes the width by a delta in pixels. */
    public resizeColumn(columnId: string, delta: number): number {
        const current = this.getColumnWidth(columnId);
        if (current === undefined) return delta;
        return this.setColumnWidth(columnId, current + delta);
    }

    /** Alias for `resizeColumn`. */
    public resize(columnId: string, delta: number): number {
        return this.resizeColumn(columnId, delta);
    }

    /** Starts an interactive resize using the pointer x-coordinate. */
    public beginResize(columnId: string, clientX: number): number {
        const column = this.findLeafColumn(columnId);
        if (!this.canResizeColumn(column)) return this.getColumnWidth(columnId) ?? 0;

        const currentWidth = this.getColumnWidth(columnId);
        if (currentWidth === undefined) return 0;

        this.activeResize = {
            columnId,
            startX: clientX,
            startWidth: currentWidth,
            direction: column?.pinned === "right" ? -1 : 1,
        };
        this.guide = { columnId, x: clientX, visible: true };
        this.onResizeStart?.(columnId, currentWidth);
        return currentWidth;
    }

    /** Adapter-friendly alias for pointer-down events. */
    public handlePointerDown(columnId: string, clientX: number): number {
        return this.beginResize(columnId, clientX);
    }

    /** Updates the current resize using the new pointer x-coordinate. */
    public resizeTo(clientX: number): number {
        const active = this.activeResize;
        if (!active) return 0;

        const delta = (clientX - active.startX) * active.direction;
        this.guide = { columnId: active.columnId, x: clientX, visible: true };
        return this.resizeBy(delta);
    }

    /** Adapter-friendly alias for pointer-move events. */
    public handlePointerMove(clientX: number): number {
        return this.resizeTo(clientX);
    }

    /** Updates the current resize using an already-calculated delta. */
    public resizeBy(delta: number): number {
        if (!this.activeResize) return 0;

        const { columnId, startWidth } = this.activeResize;
        const nextWidth = this.setColumnWidth(columnId, startWidth + delta);
        this.guide = { columnId, x: this.guide.x, visible: true };
        return nextWidth;
    }

    /** Completes the active pointer drag and hides the resize guide. */
    public endResize(): number {
        const active = this.activeResize;
        if (!active) return 0;
        const width = this.getColumnWidth(active.columnId) ?? active.startWidth;
        this.onResizeEnd?.(active.columnId, width);
        this.clearGuide();
        this.activeResize = undefined;
        return width;
    }

    /** Adapter-friendly alias for double-click auto-fit. */
    public handleDoubleClick(columnId: string): number {
        return this.autoSizeColumn(columnId);
    }

    /** Calculates the best-fit width from header text and visible row content. */
    public autoSizeColumn(columnId: string): number {
        const column = this.findLeafColumn(columnId);
        if (!column || !this.canResizeColumn(column) || !this.api) return this.getColumnWidth(columnId) ?? 0;

        const data = this.api.getProcessedData();
        const headerLength = String(column.header ?? "").length;
        const rowValues = data
            .map((row) => this.resolveCellValue(row, column))
            .filter((value) => value !== undefined)
            .map((value) => String(value).length);

        const maxLength = Math.max(headerLength, ...rowValues, 0);
        const estimatedWidth = Math.round(maxLength * 8 + 24);
        const minimum = column.minWidth ?? 0;
        const maximum = column.maxWidth ?? Number.POSITIVE_INFINITY;
        return this.setColumnWidth(columnId, Math.min(Math.max(estimatedWidth, minimum), maximum));
    }

    /** Alias for `autoSizeColumn`. */
    public autoFitColumn(columnId: string): number {
        return this.autoSizeColumn(columnId);
    }

    /** Returns the current drag guide state for integrations. */
    public getResizeGuide(): ColumnResizeGuide {
        return { ...this.guide };
    }

    /** Resets the current drag guide state. */
    public clearGuide(): void {
        this.guide = { columnId: "", x: 0, visible: false };
    }

    private attachResizeHandles(columns: ColumnDef<T>[]): ColumnDef<T>[] {
        return columns.map((column) => {
            if (isColumnGroup(column)) {
                return { ...column, children: this.attachResizeHandles(column.children) };
            }

            if (column.resizable === false) {
                return column;
            }

            const originalHeaderRenderer = column.headerRenderer;
            return {
                ...column,
                headerRenderer: (headerColumn: ColumnDef<T>) => {
                    const resolvedHeader = originalHeaderRenderer ? originalHeaderRenderer(headerColumn) : headerColumn.header ?? headerColumn.id;
                    return this.createResizeHandleNode(headerColumn as ColumnLeafDef<T>, resolvedHeader);
                },
            };
        });
    }

    private createResizeHandleNode(column: ColumnLeafDef<T>, content: unknown): SlotNodeContent<T> {
        const handleClass = column.pinned === "right"
            ? "omnigrid-column-resize-handle omnigrid-column-resize-handle-left"
            : "omnigrid-column-resize-handle";
        const contentStyle = column.pinned === "right"
            ? "position:relative; display:flex; align-items:center; width:calc(100% + 12px); margin-left:-12px; padding-left:12px; min-width:0;"
            : "position:relative; display:flex; align-items:center; width:calc(100% + 12px); margin-right:-12px; min-width:0;";

        return {
            type: "node",
            tag: "span",
            attrs: {
                class: "omnigrid-header-content",
                style: contentStyle,
            },
            children: [
                {
                    type: "node",
                    tag: "span",
                    attrs: { class: "omnigrid-header-label", style: "overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" },
                    children: [content],
                },
                {
                    type: "node",
                    tag: "span",
                    attrs: {
                        class: handleClass,
                        "aria-hidden": true,
                        title: "Resize column",
                    },
                    on: {
                        pointerdown: (_context: SlotRenderContext<T>, event: SlotNodeEvent) => {
                            if (typeof event.clientX === "number") {
                                this.beginResize(column.id, event.clientX);
                            }
                        },
                        dblclick: (_context: SlotRenderContext<T>) => {
                            this.autoSizeColumn(column.id);
                        },
                    },
                },
            ],
        };
    }

    private bindPointerHandlers(): () => void {
        if (typeof document === "undefined") {
            return () => undefined;
        }

        const handlePointerMove = (event: PointerEvent) => {
            if (!this.activeResize) return;
            this.resizeTo(event.clientX);
        };

        const handlePointerUp = () => {
            if (!this.activeResize) return;
            this.endResize();
        };

        document.addEventListener("pointermove", handlePointerMove);
        document.addEventListener("pointerup", handlePointerUp);
        document.addEventListener("pointercancel", handlePointerUp);

        return () => {
            document.removeEventListener("pointermove", handlePointerMove);
            document.removeEventListener("pointerup", handlePointerUp);
            document.removeEventListener("pointercancel", handlePointerUp);
        };
    }

    private findLeafColumn(columnId: string): ColumnLeafDef<T> | undefined {
        if (!this.api) return undefined;
        return flattenColumns(this.api.getState().columns).find((column) => column.id === columnId);
    }

    private clampWidth(column: ColumnLeafDef<T>, width: number): number {
        const minimum = column.minWidth ?? 0;
        const maximum = column.maxWidth ?? Number.POSITIVE_INFINITY;
        return Math.min(Math.max(width, minimum), maximum);
    }

    private withFixedWidth(column: ColumnLeafDef<T>, width: number): ColumnLeafDef<T> {
        const fixedColumn = { ...column, width };
        delete fixedColumn.flex;
        return fixedColumn;
    }

    private resolveCellValue(row: T, column: ColumnLeafDef<T>): unknown {
        if (column.valueGetter) return column.valueGetter(row);
        if (!column.field) return undefined;
        return (row as Record<string, unknown>)[String(column.field)];
    }

    private updateColumns(
        columns: ColumnDef<T>[],
        updater: (column: ColumnLeafDef<T>) => ColumnLeafDef<T>,
    ): ColumnDef<T>[] {
        return columns.map((column) => {
            if (isColumnGroup(column)) {
                return { ...column, children: this.updateColumns(column.children, updater) };
            }
            return updater(column);
        });
    }
}

export const ResizePlugin = ColumnResizePlugin;
export type ResizePluginOptions<T> = ColumnResizePluginOptions<T>;
