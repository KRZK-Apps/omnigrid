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

        const { data, rowRange, rowHeight, rowWidth, skipBind } = viewport;
        if (data !== this.lastData) {
            this.lastData = data;
            this.forceRebind = true;
        }

        const range: Range = rowRange;
        const windowSize = range.end - range.start;

        // Pool grows only up to the high-water mark of the window: during
        // normal scrolling the pool size stays stable — nodes are neither
        // created nor destroyed.
        while (this.hosts.length < windowSize) {
            const host = this.bindings.createRow();
            this.hosts.push(host);
            this.hostRowIndex.push(null);
            this.hostContentBound.push(false);
            this.hostOffsetY.push(OFFSCREEN_Y);
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
        // With RING mapping the quota rarely engages during slow scroll:
        // scrolling by k rows reassigns only k slots (the ones recycled from
        // rows that left the window), so steady scrolling performs O(k) binds
        // per frame instead of O(windowSize). The quota only matters when
        // recovering from fast scroll (skipBind) or a teleport, where many
        // slots carry stale content at once.
        //
        // When forceRebind is set (from invalidate(), e.g. structural changes),
        // bind everything immediately — set quota to Infinity.
        const REBIND_PER_FRAME = Math.max(1, Math.floor(windowSize / 3));
        const rebindQuota = skipBind ? 0 : this.forceRebind ? Infinity : REBIND_PER_FRAME;
        let quota = rebindQuota;

        // RING MAPPING: slot = rowIndex % poolSize. The slot a row occupies is
        // derived from the row index itself, not from the position inside the
        // window. Consequence: scrolling by k rows touches only the k slots of
        // rows entering/leaving the window; every other node keeps its bound
        // content and only receives a new `transform`. This eliminates the
        // slow-scroll "row jump" produced by the old positional mapping
        // (slot i ↔ range.start + i), where EVERY slot changed its row index
        // on each frame and the rebind quota left the visible rows showing
        // stale content for several frames.
        const poolSize = this.hosts.length;
        for (let slot = 0; slot < poolSize; slot += 1) this.slotActive[slot] = false;

        // Iterate the window in ascending row order so the rebind quota, when
        // it engages, always refreshes from the top of the window downward.
        for (let rowIndex = range.start; rowIndex < range.end; rowIndex += 1) {
            const slot = rowIndex % poolSize;
            this.slotActive[slot] = true;
            const host = this.hosts[slot];
            const offsetY = rowIndex * rowHeight;

            // Position is always updated — we need the transform to keep rows
            // at the correct offset regardless of whether content is bound.
            if (this.hostOffsetY[slot] !== offsetY) {
                this.hostOffsetY[slot] = offsetY;
                this.bindings.transformRow(host, offsetY);
                positioned.push({ host, offsetY });
            }

            const indexChanged = this.hostRowIndex[slot] !== rowIndex;
            const isNewSlot = this.hostRowIndex[slot] === null;
            const needsBind = indexChanged || this.forceRebind || !this.hostContentBound[slot];
            // New slots (never been bound) must always bind — empty rows at the
            // viewport edge are visible as empty space, worse than a one-frame
            // bind cost. During fast scroll (skipBind), only DEFER rebinding
            // slots that already had content at a different row index.
            const mustBind = isNewSlot || this.forceRebind || (needsBind && !skipBind && quota > 0);
            if (needsBind && mustBind) {
                const dataRow = data[rowIndex];
                const row: PooledRow<T> = {
                    index: rowIndex,
                    rowId: this.getRowId(dataRow, rowIndex),
                    data: dataRow,
                    offsetY,
                    height: rowHeight,
                    width: rowWidth,
                };
                this.hostRowIndex[slot] = rowIndex;
                this.hostContentBound[slot] = true;
                this.bindings.bindRow(host, row);
                bound.push({ host, row });
                if (!isNewSlot && !this.forceRebind) quota -= 1;
            } else if (indexChanged || this.forceRebind) {
                // Index changed but we can't bind this frame (skipBind or
                // quota exhausted) — update rowIndex for position tracking
                // but defer content binding. The row shows previous content
                // at the correct new position until the next slow frame.
                this.hostRowIndex[slot] = rowIndex;
                this.hostContentBound[slot] = false;
            }
        }

        // Slots not claimed by the current window (their row left the window):
        // clear their content and move them off-screen, but keep the nodes for
        // the next frame. With ring mapping these slots are scattered across
        // the pool rather than forming a tail.
        for (let slot = 0; slot < poolSize; slot += 1) {
            if (this.slotActive[slot]) continue;
            if (this.hostRowIndex[slot] === null) continue;
            const host = this.hosts[slot];
            this.hostRowIndex[slot] = null;
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
