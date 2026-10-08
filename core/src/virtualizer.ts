import type { ColumnLeafDef, Range, VirtualItem } from "./types";

export interface VirtualizerOptions {
    rowHeight: number;
    rowOverscan: number;
    columnOverscan: number;
}

export class Virtualizer<T> {
    private readonly options: VirtualizerOptions;
    private lastScrollTop: number | null = null;
    private lastRowRange: Range | null = null;
    private lastRowCount = 0;
    private lastRowViewportHeight = 0;

    public constructor(options: VirtualizerOptions) {
        this.options = options;
    }

    public getRowRange(count: number, scrollTop: number, viewportHeight: number): Range {
        if (count === 0) {
            this.lastScrollTop = null;
            this.lastRowRange = null;
            this.lastRowCount = 0;
            this.lastRowViewportHeight = 0;
            return { start: 0, end: 0 };
        }

        const rowHeight = this.options.rowHeight;
        const visibleStart = Math.floor(Math.max(0, scrollTop) / rowHeight);
        const visibleEnd = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportHeight)) / rowHeight);

        // Guaranteed buffer: the visible page + at least one full extra page
        // above and below. Even if a frame is rendered with a one-frame
        // lookahead (rAF viewport update), the visible area is always fully
        // covered by real rows — no blank gaps.
        const visibleRows = Math.max(1, visibleEnd - visibleStart);
        const overscan = Math.max(this.options.rowOverscan, visibleRows);
        const windowed: Range = {
            start: Math.max(0, visibleStart - overscan),
            end: Math.min(count, visibleEnd + overscan),
        };

        // Same data, position, and window size: return the previously computed
        // range (handles StrictMode double-render and redundant re-renders).
        if (scrollTop === this.lastScrollTop && count === this.lastRowCount && viewportHeight === this.lastRowViewportHeight) {
            return this.lastRowRange ?? windowed;
        }

        const previousTop = this.lastScrollTop;
        this.lastScrollTop = scrollTop;
        this.lastRowCount = count;
        this.lastRowViewportHeight = viewportHeight;

        if (previousTop === null) {
            this.lastRowRange = windowed;
            return windowed;
        }

        const prevVisibleStart = Math.floor(Math.max(0, previousTop) / rowHeight);
        const prevVisibleEnd = Math.ceil((Math.max(0, previousTop) + Math.max(0, viewportHeight)) / rowHeight);

        // Normal scroll: the half-page buffer already covers both the old and
        // new positions (scroll delta is smaller than the combined buffer).
        const closeEnough = visibleStart <= prevVisibleEnd + overscan && prevVisibleStart <= visibleEnd + overscan;
        if (closeEnough) {
            this.lastRowRange = windowed;
            return windowed;
        }

        // Teleport (large jump): build a continuous "corridor" from the old
        // position to the new one, capped to avoid spawning hundreds of nodes.
        const corridorCap = visibleRows * 2 + this.options.rowOverscan * 2;
        const corridorStart = Math.max(0, Math.min(prevVisibleStart, visibleStart) - overscan);
        const corridorEnd = Math.min(count, Math.max(prevVisibleEnd, visibleEnd) + overscan);

        if (corridorEnd - corridorStart > corridorCap) {
            this.lastRowRange = windowed;
            return windowed;
        }

        const corridor: Range = { start: corridorStart, end: corridorEnd };
        this.lastRowRange = corridor;
        return corridor;
    }

    /**
     * Column geometry works on the FLAT working set of leaf columns only —
     * groups never reach the Virtualizer (see `Grid.getViewportData()`).
     */
    public getColumnRange(columns: ColumnLeafDef<T>[], scrollLeft: number, viewportWidth: number): Range {
        const offsets = this.getColumnOffsets(columns, viewportWidth);
        const start = this.findStart(offsets, scrollLeft);
        const end = this.findEnd(offsets, scrollLeft + viewportWidth);
        return {
            start: Math.max(0, start - this.options.columnOverscan),
            end: Math.min(columns.length, end + 1 + this.options.columnOverscan),
        };
    }

    public getColumnOffsets(columns: ColumnLeafDef<T>[], viewportWidth = 0): VirtualItem[] {
        const widths = this.getColumnWidths(columns, viewportWidth);
        let offset = 0;
        return columns.map((column, index) => {
            const size = widths[index];
            const item = { index, offset, size };
            offset += size;
            return item;
        });
    }

    public getTotalHeight(rowCount: number): number {
        return rowCount * this.options.rowHeight;
    }

    public getTotalWidth(columns: ColumnLeafDef<T>[], viewportWidth = 0): number {
        return this.getColumnOffsets(columns, viewportWidth).reduce((total, item) => total + item.size, 0);
    }

    private getRange(count: number, itemSize: number, scrollOffset: number, viewportSize: number, overscan: number): Range {
        if (count === 0) return { start: 0, end: 0 };
        const start = Math.floor(Math.max(0, scrollOffset) / itemSize);
        const end = Math.ceil((Math.max(0, scrollOffset) + Math.max(0, viewportSize)) / itemSize);
        return {
            start: Math.max(0, start - overscan),
            end: Math.min(count, end + overscan),
        };
    }

    private getColumnWidths(columns: ColumnLeafDef<T>[], viewportWidth: number): number[] {
        const widths = columns.map((column) => this.getBaseColumnWidth(column));
        const flexIndexes = columns
            .map((column, index) => (column.flex && column.flex > 0 && column.width === undefined ? index : -1))
            .filter((index) => index >= 0);

        if (flexIndexes.length === 0) return widths;

        const fixedWidth = widths.reduce((total, width, index) => (flexIndexes.includes(index) ? total : total + width), 0);
        const minimumFlexWidth = flexIndexes.reduce((total, index) => total + this.getMinColumnWidth(columns[index]), 0);
        let remaining = Math.max(0, viewportWidth - fixedWidth - minimumFlexWidth);
        const activeIndexes = new Set(flexIndexes);

        flexIndexes.forEach((index) => {
            widths[index] = this.getMinColumnWidth(columns[index]);
        });

        while (remaining > 0 && activeIndexes.size > 0) {
            const flexTotal = [...activeIndexes].reduce((total, index) => total + (columns[index].flex ?? 0), 0);
            let distributed = 0;

            activeIndexes.forEach((index) => {
                const column = columns[index];
                const share = (remaining * (column.flex ?? 0)) / flexTotal;
                const available = this.getMaxColumnWidth(column) - widths[index];
                const addition = Math.min(share, Math.max(0, available));
                widths[index] += addition;
                distributed += addition;

                if (addition < share) activeIndexes.delete(index);
            });

            if (distributed === 0) break;
            remaining -= distributed;
        }

        return this.quantizeWidths(widths);
    }

    /**
     * Snaps fractional (flex-distributed) widths to whole pixels while keeping
     * the exact total width (largest-remainder rounding).
     *
     * Without this the flex↔fixed seam can land on a sub-pixel coordinate:
     * cells round their `left`, but the neighbouring opaque cell may overlap
     * the fractional right edge and cover the 1px border — the border visually
     * disappears at the flex/fixed boundary. Integer geometry guarantees every
     * adjacent cell touches at an exact pixel boundary.
     */
    private quantizeWidths(widths: number[]): number[] {
        const target = Math.round(widths.reduce((total, width) => total + width, 0));

        let total = 0;
        const remainders: Array<{ index: number; fraction: number }> = [];
        for (let index = 0; index < widths.length; index += 1) {
            const exact = widths[index];
            const floor = Math.floor(exact);
            widths[index] = floor;
            total += floor;
            const fraction = exact - floor;
            if (fraction > 0) remainders.push({ index, fraction });
        }

        // Restore the pixels lost to flooring — largest fractional remainder
        // first — so the widths sum back to the natural total exactly.
        let deficit = target - total;
        remainders.sort((a, b) => b.fraction - a.fraction);
        for (const { index } of remainders) {
            if (deficit <= 0) break;
            widths[index] += 1;
            deficit -= 1;
        }

        return widths;
    }

    private getBaseColumnWidth(column: ColumnLeafDef<T>): number {
        if (column.flex && column.flex > 0) {
            if (column.width !== undefined) {
                return Math.min(this.getMaxColumnWidth(column), Math.max(this.getMinColumnWidth(column), column.width));
            }
            return this.getMinColumnWidth(column);
        }
        const width = column.width ?? 120;
        return Math.min(this.getMaxColumnWidth(column), Math.max(this.getMinColumnWidth(column), width));
    }

    private getMinColumnWidth(column: ColumnLeafDef<T>): number {
        return Math.max(0, column.minWidth ?? 40);
    }

    private getMaxColumnWidth(column: ColumnLeafDef<T>): number {
        return Math.max(this.getMinColumnWidth(column), column.maxWidth ?? Infinity);
    }

    private findStart(items: VirtualItem[], offset: number): number {
        return items.findIndex((item) => item.offset + item.size > offset) === -1 ? items.length : items.findIndex((item) => item.offset + item.size > offset);
    }

    private findEnd(items: VirtualItem[], offset: number): number {
        return items.findIndex((item) => item.offset >= offset) === -1 ? items.length : items.findIndex((item) => item.offset >= offset);
    }
}
