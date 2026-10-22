import type { ColumnLeafDef, Range, VirtualItem } from "./types";

export interface VirtualizerOptions {
    rowHeight: number;
    /** Fallback height for unmeasured rows in variable-height mode. */
    estimatedRowHeight?: number;
    /** Synchronous per-row height resolver. */
    getRowHeight?: (rowIndex: number) => number | undefined;
    rowOverscan: number;
    columnOverscan: number;
}

/**
 * Dynamic row-height registry: `rowIndex -> measured px height`.
 *
 * Heights live in a Fenwick tree (binary indexed tree) over the row indexes.
 * A single measurement is applied in O(log n) — the prefix sums are patched
 * in place instead of rebuilding the whole offset table — and row offsets /
 * range lookups are answered with O(log n) prefix queries and searches.
 * Rebuilding the whole table is only needed when the dataset size or the
 * estimate changes, which happens on structural changes only.
 *
 * Rows without a measurement use the resolver value, or the estimate. The
 * resolver result is captured when the index is (re)built, so it must be
 * stable for a given row index.
 */
export class RowHeightRegistry {
    private heights: Map<number, number> = new Map();
    /** Estimated height for rows without a measurement. */
    private estimatedHeight: number;
    private readonly resolver?: (rowIndex: number) => number | undefined;
    private currentVersion: number = 0;
    /** Fenwick tree of row heights (1-based indexing). */
    private tree: Float64Array = new Float64Array(1);
    /** Raw height of every row the tree covers — mirrors the tree leaves. */
    private leaves: Float64Array = new Float64Array(0);
    /** Number of rows the tree currently covers. */
    private treeCount: number = -1;
    /** Whether the tree has to be rebuilt before the next query. */
    private treeDirty: boolean = true;

    public constructor(estimatedHeight: number, resolver?: (rowIndex: number) => number | undefined) {
        this.estimatedHeight = estimatedHeight;
        this.resolver = resolver;
    }

    /** Total number of rows with an explicit measured height. @api */
    public get size(): number {
        return this.heights.size;
    }

    /** Monotonically increasing revision number bumped on any measurement or estimate change. @api */
    public get version(): number {
        return this.currentVersion;
    }

    /** Whether any variable-height input exists (resolver or measured heights). @api */
    public get hasVariableHeights(): boolean {
        return this.heights.size > 0 || this.resolver !== undefined;
    }

    /** Updates the fallback estimated height for unmeasured rows. @api */
    public setEstimatedHeight(height: number): void {
        if (height === this.estimatedHeight) return;
        this.estimatedHeight = height;
        this.currentVersion += 1;
        this.treeDirty = true;
    }

    /**
     * Records a measured height. Returns `true` when the value actually
     * changed (delta > 1px); sub-pixel noise is ignored to prevent
     * measurement/layout feedback loops.
     */
    public set(rowIndex: number, height: number): boolean {
        if (!Number.isFinite(rowIndex) || rowIndex < 0 || !Number.isInteger(rowIndex)) return false;
        if (!Number.isFinite(height) || height <= 0) return false;
        const rounded: number = Math.max(1, Math.round(height));
        const prev: number | undefined = this.heights.get(rowIndex);
        if (prev !== undefined && Math.abs(rounded - prev) <= 1) return false;
        const previousHeight: number = this.resolveHeight(rowIndex);
        this.heights.set(rowIndex, rounded);
        this.currentVersion += 1;
        this.applyDelta(rowIndex, rounded - previousHeight);
        return true;
    }

    /** Removes a single measured height. Returns `true` when one existed. */
    public reset(rowIndex: number): boolean {
        if (!this.heights.has(rowIndex)) return false;
        const previousHeight: number = this.resolveHeight(rowIndex);
        this.heights.delete(rowIndex);
        this.currentVersion += 1;
        this.applyDelta(rowIndex, this.resolveHeight(rowIndex) - previousHeight);
        return true;
    }

    /** Removes all measured heights. */
    public clear(): void {
        if (this.heights.size === 0) return;
        this.heights.clear();
        this.currentVersion += 1;
        this.treeDirty = true;
    }

    /** Returns the measured height of a row if one has been recorded, or undefined. @api */
    public get(rowIndex: number): number | undefined {
        return this.heights.get(rowIndex);
    }

    /** Returns the resolved height of a row (measured, dynamic callback, or estimated). */
    public getRowHeight(rowIndex: number): number {
        return this.resolveHeight(rowIndex);
    }

    /** Materializes the cumulative offsets table (`offsets[i]` = top of row `i`). @api */
    public getOffsets(count: number): number[] {
        const size: number = Math.max(0, count);
        this.ensureTree(size);
        const offsets: number[] = new Array<number>(size + 1);
        let top: number = 0;
        offsets[0] = 0;
        for (let index: number = 0; index < size; index += 1) {
            top += this.leaves[index] ?? 0;
            offsets[index + 1] = top;
        }
        return offsets;
    }

    /** Total scrollable content height for `count` rows. @api */
    public getTotalHeight(count: number): number {
        if (count <= 0) return 0;
        this.ensureTree(count);
        return RowHeightRegistry.prefixSum(this.tree, count);
    }

    /** Absolute top offset of a row (clamped to the dataset). @api */
    public getTop(rowIndex: number, count: number): number {
        if (count <= 0) return 0;
        const clamped: number = Math.max(0, Math.min(count - 1, Math.floor(rowIndex)));
        this.ensureTree(count);
        return RowHeightRegistry.prefixSum(this.tree, clamped);
    }

    /**
     * First row whose bottom edge is strictly below `offset`
     * (binary search over the Fenwick tree).
     * @api
     */
    public findStart(count: number, offset: number): number {
        if (count <= 0) return 0;
        if (offset <= 0) return 0;
        this.ensureTree(count);
        return Math.min(count, RowHeightRegistry.findFloor(this.tree, count, offset).index);
    }

    /**
     * First row whose top edge is at or past `offset`
     * (binary search over the Fenwick tree). Used as the exclusive window end.
     * @api
     */
    public findEnd(count: number, offset: number): number {
        if (count <= 0) return 0;
        if (offset <= 0) return 0;
        this.ensureTree(count);
        const floor = RowHeightRegistry.findFloor(this.tree, count, offset);
        // The first row whose TOP edge is at or past the offset: the row that
        // starts exactly at the offset is included, otherwise the next one.
        const index: number = floor.sum >= offset ? floor.index : floor.index + 1;
        return Math.min(count, index);
    }

    /** Marks the offset index dirty when the dataset identity changes. @api */
    public invalidate(count: number): void {
        if (count !== this.treeCount) this.treeDirty = true;
    }

    /** Resolves the effective height of a row: measured, resolver, or estimate. */
    private resolveHeight(rowIndex: number): number {
        const measured: number | undefined = this.heights.get(rowIndex);
        if (measured !== undefined) return measured;
        const resolved: number | undefined = this.resolver?.(rowIndex);
        if (resolved !== undefined && Number.isFinite(resolved) && resolved > 0) {
            return Math.max(1, Math.round(resolved));
        }
        return this.estimatedHeight;
    }

    /** Rebuilds the Fenwick tree when the dataset size or the estimate changed. */
    private ensureTree(count: number): void {
        const size: number = Math.max(0, count);
        if (!this.treeDirty && this.treeCount === size) return;
        const tree: Float64Array = new Float64Array(size + 1);
        const leaves: Float64Array = new Float64Array(size);
        for (let index: number = 0; index < size; index += 1) {
            const height: number = this.resolveHeight(index);
            leaves[index] = height;
            tree[index + 1] = height;
        }
        // O(n) Fenwick build: every node accumulates its children.
        for (let index: number = 1; index <= size; index += 1) {
            const parent: number = index + (index & -index);
            if (parent <= size) tree[parent] += tree[index];
        }
        this.tree = tree;
        this.leaves = leaves;
        this.treeCount = size;
        this.treeDirty = false;
    }

    /** Patches a single row height into the live tree (O(log n)). */
    private applyDelta(rowIndex: number, delta: number): void {
        if (delta === 0) return;
        // A dirty tree is rebuilt from scratch on the next query — the delta
        // is already part of the source data at that point.
        if (this.treeDirty) return;
        if (rowIndex >= this.treeCount) return;
        this.leaves[rowIndex] = (this.leaves[rowIndex] ?? 0) + delta;
        for (let position: number = rowIndex + 1; position < this.tree.length; position += position & -position) {
            this.tree[position] += delta;
        }
    }

    /** Sum of the first `count` row heights. */
    private static prefixSum(tree: Float64Array, count: number): number {
        let sum: number = 0;
        for (let position: number = count; position > 0; position -= position & -position) {
            sum += tree[position];
        }
        return sum;
    }

    /**
     * Finds the largest row count whose cumulative height does not exceed
     * `offset` — i.e. the number of rows fully above the offset.
     */
    private static findFloor(tree: Float64Array, count: number, offset: number): { index: number; sum: number } {
        let index: number = 0;
        let remaining: number = offset;
        let step: number = 1;
        while (step * 2 <= count) step *= 2;
        for (; step >= 1; step = Math.floor(step / 2)) {
            const next: number = index + step;
            if (next <= count && tree[next] <= remaining) {
                index = next;
                remaining -= tree[next];
            }
        }
        return { index, sum: offset - remaining };
    }
}

export class Virtualizer<T> {
    private readonly options: VirtualizerOptions;
    private readonly heights: RowHeightRegistry;
    private lastScrollTop: number | null = null;
    private lastRowRange: Range | null = null;
    private lastRowCount: number = 0;
    private lastRowViewportHeight: number = 0;
    private lastHeightsVersion: number = 0;

    public constructor(options: VirtualizerOptions) {
        this.options = options;
        this.heights = new RowHeightRegistry(options.estimatedRowHeight ?? options.rowHeight, options.getRowHeight);
    }

    /** Dynamic height registry backing variable-height mode. @api */
    public get rowHeights(): RowHeightRegistry {
        return this.heights;
    }

    /** Estimated height used for rows without a measurement. @api */
    public get estimatedRowHeight(): number {
        return this.options.estimatedRowHeight ?? this.options.rowHeight;
    }

    /** Whether any variable-height input exists (resolver counts or measured heights exist). @api */
    public get hasVariableHeights(): boolean {
        return this.heights.hasVariableHeights;
    }

    /**
     * Visible row range calculation for fixed or variable heights.
     * @api
     */
    public getRowRange(count: number, scrollTop: number, viewportHeight: number, variableHeights = false): Range {
        if (count === 0) {
            this.lastScrollTop = null;
            this.lastRowRange = null;
            this.lastRowCount = 0;
            this.lastRowViewportHeight = 0;
            this.lastHeightsVersion = this.heights.version;
            return { start: 0, end: 0 };
        }

        if (variableHeights || this.hasVariableHeights) {
            return this.getVariableRowRange(count, scrollTop, viewportHeight);
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
     * Computes the visible row window for variable-height mode using the
     * incremental offset index (binary search over the Fenwick tree).
     * @api
     */
    public getVariableRowRange(count: number, scrollTop: number, viewportHeight: number): Range {
        const visibleStart: number = this.heights.findStart(count, Math.max(0, scrollTop));
        const visibleEnd: number = this.heights.findEnd(count, Math.max(0, scrollTop) + Math.max(0, viewportHeight));
        const visibleRows = Math.max(1, visibleEnd - visibleStart);
        const overscan = Math.max(this.options.rowOverscan, visibleRows);
        const windowed: Range = {
            start: Math.max(0, visibleStart - overscan),
            end: Math.min(count, visibleEnd + overscan),
        };
        if (
            scrollTop === this.lastScrollTop &&
            count === this.lastRowCount &&
            viewportHeight === this.lastRowViewportHeight &&
            this.lastHeightsVersion === this.heights.version
        ) {
            return this.lastRowRange ?? windowed;
        }
        const previousTop: number | null = this.lastScrollTop;
        this.lastScrollTop = scrollTop;
        this.lastRowCount = count;
        this.lastRowViewportHeight = viewportHeight;
        this.lastHeightsVersion = this.heights.version;
        if (previousTop === null) {
            this.lastRowRange = windowed;
            return windowed;
        }
        const prevVisibleStart: number = this.heights.findStart(count, Math.max(0, previousTop));
        const prevVisibleEnd: number = this.heights.findEnd(count, Math.max(0, previousTop) + Math.max(0, viewportHeight));
        const closeEnough = visibleStart <= prevVisibleEnd + overscan && prevVisibleStart <= visibleEnd + overscan;
        if (closeEnough) {
            this.lastRowRange = windowed;
            return windowed;
        }
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
     * Rows that intersect the viewport — the range WITHOUT the overscan
     * buffer.
     *
     * The DOM pool reuses its nodes in a ring: a node that was not re-bound
     * keeps the content of a completely unrelated row. The rows that
     * intersect the viewport must therefore always be bound, even while a
     * fast scroll defers the off-screen (overscan) rows.
     * @api
     */
    public getVisibleRowRange(count: number, scrollTop: number, viewportHeight: number): Range {
        if (count <= 0) return { start: 0, end: 0 };
        if (this.hasVariableHeights) {
            return {
                start: this.heights.findStart(count, Math.max(0, scrollTop)),
                end: this.heights.findEnd(count, Math.max(0, scrollTop) + Math.max(0, viewportHeight)),
            };
        }
        const rowHeight: number = this.options.rowHeight;
        const start: number = Math.floor(Math.max(0, scrollTop) / rowHeight);
        const end: number = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportHeight)) / rowHeight);
        return { start: Math.min(count, start), end: Math.min(count, end) };
    }

    /**
     * Absolute vertical offset (px) of the top of a row, accounting for variable heights.
     * @api
     */
    public getRowTop(rowIndex: number, count: number): number {
        if (count <= 0) return 0;
        const clamped: number = Math.max(0, Math.min(count - 1, Math.floor(rowIndex)));
        return this.heights.getTop(clamped, count);
    }

    /** Current (measured, resolved, or estimated) height of a row. @api */
    public getRowHeight(rowIndex: number): number {
        return this.heights.getRowHeight(rowIndex);
    }

    /**
     * Records a measured row height and returns the scrollTop correction needed
     * to keep the visually anchored row stable (scroll anchoring).
     * @api
     */
    public setRowHeight(rowIndex: number, height: number, scrollTop: number, count: number): number {
        const rowTop: number = this.getRowTop(rowIndex, count);
        const prevHeight: number = this.getRowHeight(rowIndex);
        const changed: boolean = this.heights.set(rowIndex, height);
        if (!changed) return 0;
        const newHeight: number = this.getRowHeight(rowIndex);
        const delta: number = newHeight - prevHeight;
        if (rowTop < scrollTop) {
            return delta;
        }
        return 0;
    }

    /** Removes a measured row height (falls back to resolver or estimate). @api */
    public resetRowHeight(rowIndex: number, scrollTop: number, count: number): number {
        const hadHeight: boolean = this.heights.get(rowIndex) !== undefined;
        if (!hadHeight) return 0;
        const rowTop: number = this.getRowTop(rowIndex, count);
        const prevHeight: number = this.getRowHeight(rowIndex);
        const removed: boolean = this.heights.reset(rowIndex);
        if (!removed) return 0;
        const newHeight: number = this.getRowHeight(rowIndex);
        const delta: number = newHeight - prevHeight;
        if (rowTop < scrollTop) {
            return delta;
        }
        return 0;
    }

    /** Removes all measured row heights (e.g. after `setColumns`). @api */
    public resetAllRowHeights(): void {
        this.heights.clear();
    }

    /** Total scrollable content height for `count` rows, accounting for variable heights. @api */
    public getTotalHeight(count: number): number {
        if (count <= 0) return 0;
        if (!this.hasVariableHeights) return count * this.options.rowHeight;
        return this.heights.getTotalHeight(count);
    }

    /**
     * Column geometry works on the FLAT working set of leaf columns only —
     * groups never reach the Virtualizer (see `Grid.getViewportData()`).
     *
     * Pass pre-computed `offsets` (from a prior `getColumnOffsets` call) to skip
     * the redundant width/offset computation — `getViewportData` already has
     * them in hand.
     */
    public getColumnRange(columns: ColumnLeafDef<T>[], scrollLeft: number, viewportWidth: number, offsets?: VirtualItem[]): Range {
        const computed = offsets ?? this.getColumnOffsets(columns, viewportWidth);
        const start = this.findStart(computed, scrollLeft);
        const end = this.findEnd(computed, scrollLeft + viewportWidth);
        return {
            start: Math.max(0, start - this.options.columnOverscan),
            end: Math.min(columns.length, end + 1 + this.options.columnOverscan),
        };
    }

    private readonly widthsCache = new WeakMap<object, { viewportWidth: number; columns: readonly ColumnLeafDef<T>[]; widths: number[] }>();

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
        // Column objects are stable across scroll frames, so validate each
        // identity before reusing cached widths. Checking only the first column
        // misses updates to other columns when setColumns replaces them.
        if (columns.length > 0) {
            const cacheKey = columns[0];
            const cached = this.widthsCache.get(cacheKey);
            const columnsUnchanged =
                cached?.columns.length === columns.length && cached.columns.every((column, index) => column === columns[index]);
            if (cached && cached.viewportWidth === viewportWidth && columnsUnchanged) {
                return cached.widths;
            }
        }

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

        const result = this.quantizeWidths(widths);
        if (columns.length > 0) {
            this.widthsCache.set(columns[0], { viewportWidth, columns: [...columns], widths: result });
        }
        return result;
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
        const index = items.findIndex((item) => item.offset + item.size > offset);
        return index === -1 ? items.length : index;
    }

    private findEnd(items: VirtualItem[], offset: number): number {
        const index = items.findIndex((item) => item.offset >= offset);
        return index === -1 ? items.length : index;
    }
}
