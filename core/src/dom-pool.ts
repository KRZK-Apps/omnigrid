import type {
    DomPoolBindings,
    DomPoolUpdate,
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

/**
 * Viewport frame for the DomPool.
 *
 * The `rowRange` and `columnRanges` are computed by the Grid's single
 * Virtualizer (see `Grid.getViewportData()`). The DomPool does NOT virtualize
 * on its own — it trusts the range provided by the core.
 */
export interface DomPoolViewport<T> {
    /** Inclusive start, exclusive end of visible rows (from Virtualizer). */
    rowRange: Range;
    /** Full (post-processing) array of rows. */
    data: T[];
    /** Pixel height of each row. */
    rowHeight: number;
    /** Pixel width of each row (sum of all column widths). */
    rowWidth: number;
}

/** Off-screen Y coordinate for rows removed from the viewport. */
const OFFSCREEN_Y = -200000;

/**
 * Pool of reusable row nodes.
 *
 * The core maintains a fixed-size set of node hosts (`hosts[]`) and maps
 * "pool slot i → row index". On scroll nodes are NOT created or destroyed —
 * a node simply changes `transform: translateY` (position) and, if its row
 * index changed, receives new data via `bindings.bindRow`. Text/content is
 * updated in-place without recreating elements.
 *
 * The row range is provided by the caller (the Grid's single Virtualizer),
 * ensuring there is exactly one source of truth for virtualization.
 */
export class DomPool<T> {
    private readonly getRowId: (row: T, index: number) => RowId;
    private readonly bindings: DomPoolBindings<T>;

    private readonly hosts: RowHost<T>[] = [];
    private readonly hostRowIndex: Array<number | null> = [];
    private readonly hostOffsetY: number[] = [];

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
    public update(viewport: DomPoolViewport<T>): DomPoolUpdate<T> {
        this.assertActive();

        const { data, rowRange, rowHeight, rowWidth } = viewport;
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
            this.hostOffsetY.push(OFFSCREEN_Y);
        }

        const bound: DomPoolUpdate<T>["bound"] = [];
        const positioned: DomPoolUpdate<T>["positioned"] = [];
        const recycled: RowHost<T>[] = [];

        for (let slot = 0; slot < windowSize; slot += 1) {
            const host = this.hosts[slot];
            const rowIndex = range.start + slot;
            const offsetY = rowIndex * rowHeight;

            if (this.hostRowIndex[slot] !== rowIndex || this.forceRebind) {
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
                this.bindings.bindRow(host, row);
                bound.push({ host, row });
            }

            if (this.hostOffsetY[slot] !== offsetY) {
                this.hostOffsetY[slot] = offsetY;
                this.bindings.transformRow(host, offsetY);
                positioned.push({ host, offsetY });
            }
        }

        // Tail nodes that fell outside the current window: clear their content
        // and move them off-screen, but keep the nodes for the next frame.
        for (let slot = windowSize; slot < this.hosts.length; slot += 1) {
            if (this.hostRowIndex[slot] === null) continue;
            const host = this.hosts[slot];
            this.hostRowIndex[slot] = null;
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
        this.hostOffsetY.length = 0;
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
