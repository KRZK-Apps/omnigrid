import type {
    DomPoolBindings,
    DomPoolUpdate,
    DomPoolUpdateOptions,
    PooledRow,
    Range,
    RowHost,
    RowId,
} from "./types";

export interface DomPoolOptions<T> {
    rowHeight: number;
    getRowId?: (row: T, index: number) => RowId;
    /**
     * Injected DOM operations. The core NEVER touches `document` —
     * the adapter performs all node manipulations through this contract.
     */
    bindings: DomPoolBindings<T>;
}

/** Off-screen Y coordinate for rows removed from the viewport. */
const OFFSCREEN_Y = -200000;

/**
 * Pool of reusable row nodes.
 *
 * The core maintains a fixed-size set of node hosts (`hosts[]`) and maps
 * each row to a pool slot via a RING mapping: `slot = rowIndex % poolSize`.
 * On scroll nodes are NOT created or destroyed —
 * a node simply changes `transform: translateY` (position) and, if its row
 * index changed, receives new data via `bindings.bindRow`. Text/content is
 * updated in-place without recreating elements. Because the slot a row
 * occupies is derived from the row index itself (not from the window
 * position), content travels with its row: scrolling by k rows recycles
 * only the k slots of rows that left the window instead of invalidating
 * the entire pool.
 *
 * The row range is provided by the caller (the Grid's single Virtualizer),
 * ensuring there is exactly one source of truth for virtualization.
 */
export class DomPool<T> {
    private readonly getRowId: (row: T, index: number) => RowId;
    private readonly bindings: DomPoolBindings<T>;

    private readonly hosts: RowHost<T>[] = [];
    private readonly hostRowIndex: Array<number | null> = [];
    /** Whether slot i's content (bindRow) has been bound since its last position change. */
    private readonly hostContentBound: boolean[] = [];
    private readonly hostOffsetY: number[] = [];
    private readonly hostHeight: number[] = [];
    /** Scratch flags: whether slot i was claimed by the current window (ring mapping). */
    private readonly slotActive: boolean[] = [];

    /** Data changed — force-rebind visible nodes on the next frame. */
    private forceRebind = false;
    private lastData: T[] | null = null;
    private destroyed = false;

    public constructor(options: DomPoolOptions<T>) {
        this.getRowId = options.getRowId ?? ((_row, index) => index);
        this.bindings = options.bindings;
    }

    public get size(): number {
        return this.hosts.length;
    }

    /** Returns current pool nodes (read-only; order matches pool indices). */
    public getHosts(): RowHost<T>[] {
        return this.hosts;
    }

    /**
     * Processes the next viewport frame. Idempotent: calls bindings
     * ONLY for nodes that have actually changed and returns an info
     * report describing the update.
     */
    public update(viewport: DomPoolUpdateOptions<T>): DomPoolUpdate<T> {
        this.assertActive();

        const { data, rowRange, rowHeight, rowOffsets, rowHeights, visibleRowRange, rowWidth, forceContent } = viewport;
        if (data !== this.lastData) {
            this.lastData = data;
            this.forceRebind = true;
        }
        // Read and reset forceRebind so it doesn't persist across frames —
        // each pool.update() only re-binds if invalidate() was called since
        // the last update.
        const forceRebind = this.forceRebind;
        this.forceRebind = false;

        const range: Range = rowRange;
        const windowSize: number = range.end - range.start;

        // Pool grows only up to the high-water mark of the window: during
        // normal scrolling the pool size stays stable — nodes are neither
        // created nor destroyed.
        while (this.hosts.length < windowSize) {
            const host: RowHost<T> = this.bindings.createRow();
            this.hosts.push(host);
            this.hostRowIndex.push(null);
            this.hostContentBound.push(false);
            this.hostOffsetY.push(OFFSCREEN_Y);
            this.hostHeight.push(-1);
        }

        const bound: DomPoolUpdate<T>["bound"] = [];
        const positioned: DomPoolUpdate<T>["positioned"] = [];
        const recycled: RowHost<T>[] = [];

        // RING MAPPING: slot = rowIndex % poolSize. The slot a row occupies is
        // derived from the row index itself, not from the position inside the
        // window. Consequence: scrolling by k rows touches only the k slots of
        // rows entering/leaving the window; every other node keeps its bound
        // content and only receives a new `transform`. This eliminates the
        // slow-scroll "row jump" produced by the old positional mapping
        // (slot i ↔ range.start + i), where EVERY slot changed its row index
        // on each frame.
        const poolSize: number = this.hosts.length;
        for (let slot: number = 0; slot < poolSize; slot += 1) this.slotActive[slot] = false;

        // Iterate the window in ascending row order so the rebind quota, when
        // it engages, always refreshes from the top of the window downward.
        for (let rowIndex: number = range.start; rowIndex < range.end; rowIndex += 1) {
            const slot: number = rowIndex % poolSize;
            this.slotActive[slot] = true;
            const host: RowHost<T> = this.hosts[slot];
            const rangeIndex: number = rowIndex - range.start;
            const offsetY: number = rowOffsets ? (rowOffsets[rangeIndex] ?? rowIndex * rowHeight) : rowIndex * rowHeight;
            const currentHeight: number = rowHeights ? (rowHeights[rangeIndex] ?? rowHeight) : rowHeight;

            // Position is always updated — we need the transform to keep rows
            // at the correct offset regardless of whether content is bound.
            if (this.hostOffsetY[slot] !== offsetY) {
                this.hostOffsetY[slot] = offsetY;
                this.bindings.transformRow(host, offsetY);
                positioned.push({ host, offsetY });
            }

            const indexChanged: boolean = this.hostRowIndex[slot] !== rowIndex;
            const heightChanged: boolean = this.hostHeight[slot] !== currentHeight;
            const isNewSlot: boolean = this.hostRowIndex[slot] === null;
            const contentBound: boolean = this.hostContentBound[slot];

            // The row BOX follows the virtualizer unconditionally: position AND
            // height are geometry, not content. During a fast scroll the
            // content of a recycled node is stale (it still belongs to the
            // previous row), but the node must get the size of the row it
            // stands for NOW — otherwise a 60px node occupies a 32px slot and
            // the rows overlap (or leave gaps when the height shrinks).
            // `resizeRow` only touches the box, never the content.
            const resizeRow = this.bindings.resizeRow;
            const canResize: boolean = resizeRow !== undefined && !this.forceRebind;
            if (heightChanged && canResize && !isNewSlot) {
                this.hostHeight[slot] = currentHeight;
                resizeRow?.(host, currentHeight);
            }

            // A content re-bind is needed when the node shows a different row,
            // when it has no content at all, or on a forced re-bind. A height
            // change alone never invalidates the content — unless the adapter
            // cannot resize a node, in which case the row has to be re-bound
            // to pick up the new height.
            const needsBind: boolean = indexChanged || forceRebind || forceContent || !contentBound || (heightChanged && !canResize);
            if (needsBind) {
                // bindRow → applyContent overwrites content directly under flushSync.
                // We deliberately do NOT call clearContent here — wiping the DOM
                // before an async React root.render() creates an empty frame that
                // flashes on screen during fast scroll. The new content replaces
                // the old one atomically inside flushSync, so no stale content
                // is ever visible.
                const dataRow: T = data[rowIndex];
                const row: PooledRow<T> = {
                    index: rowIndex,
                    rowId: this.getRowId(dataRow, rowIndex),
                    data: dataRow,
                    offsetY,
                    height: currentHeight,
                    width: rowWidth,
                };
                this.hostRowIndex[slot] = rowIndex;
                this.hostHeight[slot] = currentHeight;
                this.hostContentBound[slot] = true;
                this.bindings.bindRow(host, row);
                bound.push({ host, row });
            }
        }

        // Slots not claimed by the current window (their row left the window):
        // clear their content and move them off-screen, but keep the nodes for
        // the next frame. With ring mapping these slots are scattered across
        // the pool rather than forming a tail.
        for (let slot: number = 0; slot < poolSize; slot += 1) {
            if (this.slotActive[slot]) continue;
            if (this.hostRowIndex[slot] === null) continue;
            const host: RowHost<T> = this.hosts[slot];
            this.hostRowIndex[slot] = null;
            this.hostHeight[slot] = -1;
            this.hostContentBound[slot] = false;
            this.hostOffsetY[slot] = OFFSCREEN_Y;
            this.bindings.recycleRow(host);
            this.bindings.transformRow(host, OFFSCREEN_Y);
            recycled.push(host);
        }

        this.forceRebind = false;

        return {
            windowStart: range.start,
            windowEnd: range.end,
            poolSize: this.hosts.length,
            bound,
            positioned,
            recycled,
        };
    }

     /**
     * Updates ONLY the positions (transforms) and heights of existing pool
     * nodes — no node creation, no content binding, no recycling.
     *
     * This is the synchronous fast path invoked from the scroll handler so
     * the browser repaints rows at their correct position in the same frame as
     * the native scroll, eliminating the blank-frame flash on scrollbar thumb
     * drags. The subsequent `update` call (in the rAF callback) handles
     * content binding for rows whose index changed.
     *
     * Unlike `update`, this method does NOT modify `hostRowIndex` or
     * `hostContentBound` — so `update` will still detect index changes and
     * bind content. It also does not grow the pool or recycle nodes.
     * @param viewport - DOM pool update options for the current scroll position.
     * @returns Number of nodes whose transform was updated this call.
     * @api
     */
    public syncTransforms(viewport: DomPoolUpdateOptions<T>): number {
        this.assertActive();
        const { rowRange, rowHeight, rowOffsets, rowHeights, visibleRowRange, data, rowWidth } = viewport;
        const poolSize: number = this.hosts.length;
        if (poolSize === 0 || rowRange.end <= rowRange.start) return 0;

        const rangeSize: number = rowRange.end - rowRange.start;
        const activeSlots: boolean[] = new Array<boolean>(poolSize).fill(false);
        let positioned: number = 0;

        for (let i: number = 0; i < rangeSize; i += 1) {
            const rowIndex: number = rowRange.start + i;
            const slot: number = rowIndex % poolSize;
            activeSlots[slot] = true;

            const offsetY: number = rowOffsets ? (rowOffsets[i] ?? rowIndex * rowHeight) : rowIndex * rowHeight;
            const currentHeight: number = rowHeights ? (rowHeights[i] ?? rowHeight) : rowHeight;
            const host: RowHost<T> = this.hosts[slot];

            if (this.hostOffsetY[slot] !== offsetY) {
                this.hostOffsetY[slot] = offsetY;
                this.bindings.transformRow(host, offsetY);
                positioned += 1;
            }
            if (rowHeights && this.hostHeight[slot] !== currentHeight && this.bindings.resizeRow) {
                this.hostHeight[slot] = currentHeight;
                this.bindings.resizeRow(host, currentHeight);
            }

            // For rows intersecting the viewport: synchronously push scalar
            // content so the user sees correct text in the same frame as the
            // scroll. The subsequent `update` call in the rAF callback handles
            // root-managed cells and overscan content.
            if (visibleRowRange && rowIndex >= visibleRowRange.start && rowIndex < visibleRowRange.end && this.bindings.syncContent) {
                const dataRow: T = data[rowIndex];
                if (dataRow !== undefined) {
                    this.bindings.syncContent(host, {
                        index: rowIndex,
                        rowId: this.getRowId(dataRow, rowIndex),
                        data: dataRow,
                        offsetY,
                        height: currentHeight,
                        width: rowWidth,
                    });
                }
            }
        }

        // Move any pool slot no longer covered by the window off-screen so it
        // never paints stale geometry at a wrong position during a teleport.
        for (let slot: number = 0; slot < poolSize; slot += 1) {
            if (activeSlots[slot]) continue;
            if (this.hostOffsetY[slot] !== OFFSCREEN_Y) {
                this.hostOffsetY[slot] = OFFSCREEN_Y;
                this.bindings.transformRow(this.hosts[slot], OFFSCREEN_Y);
                positioned += 1;
            }
        }

        return positioned;
    }

    /**
     * Force-rebinds all visible nodes on the next frame.
     * Used by the adapter on `refresh()` or data replacement when
     * the visible range hasn't changed but content/styles have.
     */
    public invalidate(): void {
        this.assertActive();
        this.forceRebind = true;
    }

    /** Releases all pool nodes (called when the grid is destroyed). */
    public destroy(): void {
        if (this.destroyed) return;
        for (let slot = 0; slot < this.hosts.length; slot += 1) {
            if (this.hostRowIndex[slot] === null) continue;
            this.bindings.recycleRow(this.hosts[slot]);
            this.hostRowIndex[slot] = null;
        }
        this.hosts.length = 0;
        this.hostRowIndex.length = 0;
        this.hostContentBound.length = 0;
        this.hostOffsetY.length = 0;
        this.hostHeight.length = 0;
        this.slotActive.length = 0;
        this.lastData = null;
        this.destroyed = true;
    }

    public isDestroyed(): boolean {
        return this.destroyed;
    }

    private assertActive(): void {
        if (this.destroyed) throw new Error("DomPool has been destroyed");
    }
}
