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

        const { data, rowRange, rowHeight, rowOffsets, rowHeights, visibleRowRange, rowWidth, skipBind } = viewport;
        if (data !== this.lastData) {
            this.lastData = data;
            this.forceRebind = true;
        }

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

        // Gradual re-bind: when transitioning from skip-bind mode to normal
        // (content was not bound during fast scroll), spread the binding of
        // stale slots across frames rather than binding all at once — which
        // would cause a frame drop. Each frame binds at most
        // `REBIND_PER_FRAME` stale slots, then resumes normal binding for
        // new rows.
        //
        // The quota covers the OFF-SCREEN rows only: the rows that intersect
        // the viewport are always bound (see below) — they carry the data the
        // user actually reads.
        //
        // With RING mapping the quota rarely engages during slow scroll:
        // scrolling by k rows reassigns only k slots (the ones recycled from
        // rows that left the window), so steady scrolling performs O(k) binds
        // per frame instead of O(windowSize). The quota only matters when
        // recovering from fast scroll (skipBind) or a teleport, where many
        // slots carry stale content at once.
        //
        // When forceRebind is set (from invalidate(), e.g. structural changes),
        // bind everything immediately — set quota to Infinity.
        const REBIND_PER_FRAME: number = Math.max(1, Math.floor(windowSize / 3));
        const rebindQuota: number = skipBind ? 0 : this.forceRebind ? Infinity : REBIND_PER_FRAME;
        let quota: number = rebindQuota;

        // RING MAPPING: slot = rowIndex % poolSize. The slot a row occupies is
        // derived from the row index itself, not from the position inside the
        // window. Consequence: scrolling by k rows touches only the k slots of
        // rows entering/leaving the window; every other node keeps its bound
        // content and only receives a new `transform`. This eliminates the
        // slow-scroll "row jump" produced by the old positional mapping
        // (slot i ↔ range.start + i), where EVERY slot changed its row index
        // on each frame and the rebind quota left the visible rows showing
        // stale content for several frames.
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
            const needsBind: boolean = indexChanged || this.forceRebind || !contentBound || (heightChanged && !canResize);
            // New slots (never been bound) must always bind — empty rows at the
            // viewport edge are visible as empty space, worse than a one-frame
            // bind cost.
            //
            // The rows that intersect the viewport must bind as well, even
            // during a fast scroll: the pool recycles its nodes in a ring, so
            // a node that is not re-bound keeps the content of a completely
            // unrelated row — the user would read another row's data (e.g. the
            // wrong ID) in the visible area. Only the off-screen rows (the
            // overscan corridor) follow the rebind quota.
            const inViewport: boolean = visibleRowRange !== undefined && rowIndex >= visibleRowRange.start && rowIndex < visibleRowRange.end;
            const quotaBind: boolean = needsBind && !skipBind && quota > 0;
            const mustBind: boolean = isNewSlot || this.forceRebind || (needsBind && (inViewport || quotaBind));
            if (needsBind && mustBind) {
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
                if (!isNewSlot && !this.forceRebind && quotaBind) quota -= 1;
            } else if (indexChanged || this.forceRebind) {
                // Index changed but we can't bind this frame (skipBind or
                // quota exhausted) — update rowIndex for position tracking
                // but defer content binding. The row shows previous content
                // at the correct new position until the next slow frame.
                this.hostRowIndex[slot] = rowIndex;
                this.hostContentBound[slot] = false;
                // The node stands for the new row from now on: the adapters
                // look rows up by index (hover highlight), so the index has to
                // follow the position even while the content is still stale.
                this.bindings.updateRowIndex?.(host, rowIndex);
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
