import type { CellAlign, ColumnLeafDef, PooledRow, RowId, RowStyle, ViewportData } from "@omnigrid/core";

import { type ContentBridge, contentToReactNode, isSlotHtmlContent } from "./content";
import type { CellRoot } from "./reactRoot";

/** Column within the pool: definition + geometry from the virtual window. */
export type PooledColumn<T> = ViewportData<T>["columns"][number];

export interface PooledCellRenderInfo<T> {
    data: T;
    column: ColumnLeafDef<T>;
    columnIndex: number;
    rowId: RowId;
    rowIndex: number;
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
    resolveRowClasses(row: PooledRow<T>): string | undefined;
    resolveRowStyle(row: PooledRow<T>): RowStyle | undefined;
    resolveCellClasses(cellInfo: PooledCellRenderInfo<T>): string | undefined;
    resolveCellStyle(cellInfo: PooledCellRenderInfo<T>): RowStyle | undefined;
    onRowClick(row: PooledRow<T>, modifiers: PooledRowModifiers): void;
    onRowHover(row: PooledRow<T>, hovered: boolean): void;
    onCellClick(row: PooledRow<T>, column: ColumnLeafDef<T>, modifiers: PooledRowModifiers): void;
    createRoot(container: HTMLDivElement): CellRoot;
}

const OFFSCREEN_X = -200000;
const OFFSCREEN_Y = -200000;

const ALIGN_TO_JUSTIFY: Record<CellAlign, string> = {
    left: "flex-start",
    center: "center",
    right: "flex-end",
};

/**
 * Converts a CSS style key in camelCase (e.g. `backgroundColor`) into the
 * kebab-case form required by `CSSStyleDeclaration.setProperty` /
 * `removeProperty` (e.g. `background-color`). The CSSOM does NOT accept
 * camelCase keys, so styles defined as JS objects must be converted.
 */
function cssPropertyName(property: string): string {
    return property.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

interface CellPane<T> {
    element: HTMLDivElement;
    column: ColumnLeafDef<T> | null;
    columnIndex: number;
    root: CellRoot | null;
    offsetX: number | null;
    width: number | null;
    justify: string | null;
    appliedStyleKeys: string[];
}

/**
 * Reusable row panel: holds a fixed set of cells, lays them out for the
 * horizontal column window via `translateX`, and updates content in-place
 * (textContent for scalars, innerHTML for HTML fragments, an isolated
 * React root for components).
 *
 * All DOM manipulations are imperative and bypass React reconciliation:
 * this is the scroll hot path.
 */
export class PooledRowPane<T> {
    private readonly cells: CellPane<T>[] = [];
    private readonly appliedStyleKeys: string[] = [];
    private row: PooledRow<T> | null = null;
    /**
     * Horizontal origin (in table coordinates) of the pane this panel renders
     * into. Column offsets coming from the core's `ViewportData` are absolute
     * (table-space); the pane translates them into its own local coordinate
     * space by subtracting this origin. Pinned-left panes use 0, the scrollable
     * pane uses the left-pinned width, and the right-pinned pane uses the sum
     * of the left + scrollable widths.
     */
    private originX = 0;

    public constructor(
        private readonly host: HTMLDivElement,
        private readonly callbacks: PooledRowCallbacks<T>,
        private readonly bridge: ContentBridge<T>,
    ) {
        host.classList.add("omnigrid-row");
        host.setAttribute("role", "row");
        host.style.position = "absolute";
        host.style.top = "0";
        host.style.left = "0";

        host.addEventListener("mousedown", (event: MouseEvent) => {
            // Shift + click should not select text (same as React version).
            if (event.shiftKey) event.preventDefault();
        });
        host.addEventListener("click", (event: MouseEvent) => {
            const row = this.row;
            if (!row) return;
            this.callbacks.onRowClick(row, { ctrlKey: event.ctrlKey || event.metaKey, shiftKey: event.shiftKey });
        });
        host.addEventListener("mouseenter", () => {
            const row = this.row;
            if (row) this.callbacks.onRowHover(row, true);
        });
        host.addEventListener("mouseleave", () => {
            const row = this.row;
            if (row) this.callbacks.onRowHover(row, false);
        });
    }
    /** Binds a row to the panel and fully rebuilds content. */
    public bind(row: PooledRow<T>, columns: PooledColumn<T>[], originX = 0): void {
        this.row = row;
        this.originX = originX;
        this.applyRowSizing(row);
        // Cells must exist BEFORE presentation is applied: applyRowPresentation
        // copies the row background colour onto each existing cell. If it ran
        // first, newly created cells would keep the default CSS background
        // until the next bind (i.e. until scrolling).
        this.mapColumns(columns, true);
        this.applyRowPresentation(row);
    }

    /** Re-layouts cells for a new horizontal column window. */
    public updateColumns(columns: PooledColumn<T>[], originX = 0): void {
        this.originX = originX;
        const row = this.row;
        if (row) this.applyRowSizing(row);
        this.mapColumns(columns, false);
    }

    /** Single row positioning operation — transform only (no reflow). */
    public setOffsetY(offsetY: number): void {
        this.host.style.transform = `translate3d(0, ${Math.round(offsetY)}px, 0)`;
    }

    /** Moves an unused row far off-screen (outside viewport). */
    public hide(): void {
        this.host.style.transform = `translate3d(0, ${OFFSCREEN_Y}px, 0)`;
    }

    /** Clears content and unbinds the row, preserving DOM nodes. */
    public recycle(): void {
        this.row = null;
        for (const cell of this.cells) this.clearContent(cell);
        this.hide();
    }

    private ensureCells(count: number): void {
        while (this.cells.length < count) this.cells.push(this.createCell());
    }

    private mapColumns(columns: PooledColumn<T>[], forceContent: boolean): void {
        this.ensureCells(columns.length);

        for (let slot = 0; slot < this.cells.length; slot += 1) {
            const cell = this.cells[slot];
            const layout = slot < columns.length ? columns[slot] : null;

            if (!layout) {
                if (cell.column !== null) {
                    this.clearContent(cell);
                    cell.column = null;
                    cell.columnIndex = -1;
                    cell.offsetX = null;
                    cell.width = null;
                    cell.element.style.transform = `translate3d(${OFFSCREEN_X}px, 0, 0)`;
                }
                continue;
            }

            const columnChanged = cell.column !== layout.column || cell.columnIndex !== layout.index;
            this.layoutCell(cell, layout);

            if (columnChanged) cell.columnIndex = layout.index;
            if (columnChanged || forceContent) {
                cell.column = layout.column;
                this.renderContent(cell);
            }
        }
    }

    private layoutCell(cell: CellPane<T>, layout: PooledColumn<T>): void {
        const element = cell.element;
        const justify = ALIGN_TO_JUSTIFY[layout.column.align ?? "left"];
        const offset = Math.round(layout.offset - this.originX);

        if (cell.offsetX !== offset || cell.width !== layout.width) {
            element.style.transform = `translate3d(${offset}px, 0, 0)`;
            element.style.width = `${layout.width}px`;
            cell.offsetX = offset;
            cell.width = layout.width;
        }
        if (cell.justify !== justify) {
            element.style.justifyContent = justify;
            cell.justify = justify;
        }
    }
    private createCell(): CellPane<T> {
        const element = document.createElement("div");
        element.setAttribute("role", "cell");
        element.style.position = "absolute";
        element.style.top = "0";
        element.style.left = "0";
        element.style.overflow = "hidden";
        element.style.height = `${this.callbacks.rowHeight}px`;
        this.host.appendChild(element);

        const cell: CellPane<T> = {
            element,
            column: null,
            columnIndex: -1,
            root: null,
            offsetX: null,
            width: null,
            justify: null,
            appliedStyleKeys: [],
        };

        element.addEventListener("click", (event: MouseEvent) => {
            event.stopPropagation();
            const row = this.row;
            const column = cell.column;
            if (!row || !column) return;
            this.callbacks.onCellClick(row, column, { ctrlKey: event.ctrlKey || event.metaKey, shiftKey: event.shiftKey });
        });

        return cell;
    }

    private renderContent(cell: CellPane<T>): void {
        const row = this.row;
        const column = cell.column;
        if (!row || !column) {
            this.clearContent(cell);
            return;
        }
        const cellInfo: PooledCellRenderInfo<T> = {
            data: row.data,
            column,
            columnIndex: cell.columnIndex,
            rowId: row.rowId,
            rowIndex: row.index,
        };
        this.applyCellPresentation(cell, cellInfo);
        const content = this.callbacks.renderCellContent(cellInfo);
        this.applyContent(cell, content);
    }

    private applyCellPresentation(cell: CellPane<T>, cellInfo: PooledCellRenderInfo<T>): void {
        const cellClasses = this.callbacks.resolveCellClasses(cellInfo);
        cell.element.className = cellClasses ?? "";

        for (const key of cell.appliedStyleKeys) cell.element.style.removeProperty(cssPropertyName(key));
        cell.appliedStyleKeys.length = 0;

        const style = this.callbacks.resolveCellStyle(cellInfo);
        if (style) {
            for (const [key, value] of Object.entries(style)) {
                if (value === undefined) continue;
                cell.element.style.setProperty(cssPropertyName(key), String(value));
                cell.appliedStyleKeys.push(key);
            }
        }
    }

    private applyContent(cell: CellPane<T>, content: unknown): void {
        if (content == null) {
            this.clearContent(cell);
            return;
        }

        const contentType = typeof content;
        // Fast path: scalars written directly to textContent — no React.
        if (contentType === "string" || contentType === "number" || contentType === "boolean") {
            if (cell.root) {
                cell.root.render(String(content));
            } else {
                cell.element.textContent = String(content);
            }
            return;
        }

        // HTML fragment — directly into innerHTML.
        if (isSlotHtmlContent(content)) {
            if (cell.root) {
                cell.root.render(contentToReactNode(content, this.bridge));
            } else {
                cell.element.innerHTML = content.html;
            }
            return;
        }

        // Everything complex (React components, CheckboxControl, SlotNode):
        // render through an isolated root. The cell node is NOT recreated.
        const root = cell.root ?? (cell.root = this.callbacks.createRoot(cell.element));
        root.render(contentToReactNode(content, this.bridge));
    }

    private clearContent(cell: CellPane<T>): void {
        if (cell.root) {
            // Keep the root mounted while the pooled cell is reused. Calling
            // root.unmount() during another React commit causes a race warning.
            cell.root.render(null);
        } else if (cell.element.textContent !== "" || cell.element.childElementCount > 0) {
            cell.element.replaceChildren();
        }
    }

    private applyRowSizing(row: PooledRow<T>): void {
        // The row node is an absolutely-positioned block: without explicit
        // dimensions it collapses to 0×0, hiding the row background and row
        // hover styles. Width covers the full content (all columns), height
        // matches the row height.
        if (row.width > 0) this.host.style.width = `${row.width}px`;
        if (row.height > 0) this.host.style.height = `${row.height}px`;
    }

    private applyRowPresentation(row: PooledRow<T>): void {
        this.host.className = this.callbacks.resolveRowClasses(row) ?? "omnigrid-row";

        for (const key of this.appliedStyleKeys) this.host.style.removeProperty(cssPropertyName(key));
        this.appliedStyleKeys.length = 0;

        const style = this.callbacks.resolveRowStyle(row);
        if (style) {
            for (const [key, value] of Object.entries(style)) {
                if (value === undefined) continue;
                this.host.style.setProperty(cssPropertyName(key), String(value));
                this.appliedStyleKeys.push(key);
            }
        }

        const backgroundColor = typeof style?.backgroundColor === "string" ? style.backgroundColor : "";
        for (const cell of this.cells) {
            if (cell.appliedStyleKeys.includes("backgroundColor")) continue;
            if (cell.element.style.backgroundColor !== backgroundColor) cell.element.style.backgroundColor = backgroundColor;
        }
    }
}
