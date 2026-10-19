import type { CellAlign, ColumnLeafDef, PooledRow, RowId, RowSpanLayout, RowStyle, ViewportData } from "@omnigrid/core";

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
    resolveRowClasses(row: PooledRow<T>): string | undefined;
    resolveRowStyle(row: PooledRow<T>): RowStyle | undefined;
    resolveCellClasses(cellInfo: PooledCellRenderInfo<T>): string | undefined;
    resolveCellStyle(cellInfo: PooledCellRenderInfo<T>): RowStyle | undefined;
    onRowClick(row: PooledRow<T>, modifiers: PooledRowModifiers): void;
    onRowHover(row: PooledRow<T>, hovered: boolean): void;
    onCellClick(row: PooledRow<T>, column: ColumnLeafDef<T>, modifiers: PooledRowModifiers): void;
    createRoot(container: HTMLDivElement): CellRoot;
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
    span: number;
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
    public bind(row: PooledRow<T>, columns: PooledColumn<T>[], originX = 0, spans?: RowSpanLayout | null): void {
        const hovered = this.host.matches(":hover");
        if (hovered && this.row) this.callbacks.onRowHover(this.row, false);
        this.row = row;
        this.host.dataset.rowIndex = String(row.index);
        this.host.classList.remove("omnigrid-row-hover");
        this.originX = originX;
        this.applyRowSizing(row);
        // Cells must exist BEFORE presentation is applied: applyRowPresentation
        // copies the row background colour onto each existing cell. If it ran
        // first, newly created cells would keep the default CSS background
        // until the next bind (i.e. until scrolling).
        this.mapColumns(columns, true, spans);
        this.applyRowPresentation(row);
        if (hovered) this.callbacks.onRowHover(row, true);
    }

    /** Returns the currently bound row, if any. */
    public getRow(): PooledRow<T> | null {
        return this.row;
    }

    /** Re-layouts cells for a new horizontal column window. */
    public updateColumns(columns: PooledColumn<T>[], originX = 0, spans?: RowSpanLayout | null): void {
        this.originX = originX;
        const row = this.row;
        if (row) this.applyRowSizing(row);
        this.mapColumns(columns, false, spans);
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
        if (this.row && this.host.matches(":hover")) this.callbacks.onRowHover(this.row, false);
        this.row = null;
        delete this.host.dataset.rowIndex;
        this.host.classList.remove("omnigrid-row-hover");
        // Do NOT clear cell content here — React roots stay mounted so the next
        // bind() re-renders via root.render(newContent) as an in-place update,
        // avoiding the async gap between clearing and re-rendering that causes
        // visible jitter on cells with custom renderers. Roots are eventually
        // GC'd by React when the row host is destroyed.
        this.hide();
    }

    private ensureCells(count: number): void {
        while (this.cells.length < count) this.cells.push(this.createCell());
    }

    private mapColumns(columns: PooledColumn<T>[], forceContent: boolean, spans?: RowSpanLayout | null): void {
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

            // Spanned rows: covered leaves render nothing — the span origin
            // owns the merged width. Park the node off-screen so recycled
            // nodes never overlap the merged cell.
            const covered: boolean = spans?.spans[slot]?.covered ?? false;
            if (covered) {
                if (cell.column !== null) {
                    this.clearContent(cell);
                    cell.column = null;
                    cell.columnIndex = -1;
                }
                cell.offsetX = null;
                cell.width = null;
                cell.element.style.transform = `translate3d(${OFFSCREEN_X}px, 0, 0)`;
                continue;
            }

            const spanWidth: number | undefined = spans?.widths[slot];
            const spanOffset: number | undefined = spans?.offsets[slot];
            const effective: PooledColumn<T> =
                spanWidth !== undefined && spanOffset !== undefined ? { ...layout, width: spanWidth, offset: spanOffset } : layout;

            const columnChanged = cell.column !== layout.column || cell.columnIndex !== layout.index || cell.span !== (spans?.spans[slot]?.span ?? 1);
            this.layoutCell(cell, effective);

            if (columnChanged) cell.columnIndex = layout.index;
            if (columnChanged || forceContent) {
                cell.column = layout.column;
                cell.span = spans?.spans[slot]?.span ?? 1;
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
            span: 1,
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
            colSpan: cell.span,
        };
        this.applyCellPresentation(cell, cellInfo);
        const content = this.callbacks.renderCellContent(cellInfo);
        this.applyContent(cell, content, cellInfo);
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

    private applyContent(cell: CellPane<T>, content: unknown, cellInfo: PooledCellRenderInfo<T>): void {
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
        //
        // The first commit into a fresh root is ASYNC (concurrent mode) — on
        // fast scroll a newly created cell would be visibly empty for a frame
        // or two. Staging: synchronously paint a cheap scalar preview first;
        // React's first commit replaces the container contents entirely (see
        // createRoot docs), so the placeholder never outlives the real content.
        // Cells that already hold a committed root keep their (stale) content
        // instead — never empty, so no placeholder is needed there.
        if (!cell.root) {
            const placeholder = this.callbacks.renderCellPlaceholder?.(cellInfo);
            if (placeholder) cell.element.textContent = placeholder;
            cell.root = this.callbacks.createRoot(cell.element);
        }
        cell.root.render(contentToReactNode(content, this.bridge));
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
