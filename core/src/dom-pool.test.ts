import { describe, expect, it } from "vitest";
import { DomPool } from "./dom-pool";
import type { DomPoolBindings, DomPoolUpdate, DomPoolUpdateOptions, PooledRow, Range, RowHost } from "./types";

interface Row {
    name: string;
}

/** Minimal host: just an identity token so bindings can be tracked in tests. */
interface TestHost {
    id: number;
}

function makeBindings(log: string[]): { bindings: DomPoolBindings<Row>; hosts: TestHost[] } {
    const hosts: TestHost[] = [];
    const bindings: DomPoolBindings<Row> = {
        createRow(): RowHost<Row> {
            const host: TestHost = { id: hosts.length };
            hosts.push(host);
            return host;
        },
        bindRow(host: RowHost<Row>, row: PooledRow<Row>): void {
            log.push(`bind:${(host as TestHost).id}=${row.index}`);
        },
        transformRow(host: RowHost<Row>, offsetY: number): void {
            log.push(`pos:${(host as TestHost).id}@${offsetY}`);
        },
        recycleRow(host: RowHost<Row>): void {
            log.push(`recycle:${(host as TestHost).id}`);
        },
    };
    return { bindings, hosts };
}

function makeData(count: number): Row[] {
    return Array.from({ length: count }, (_, index) => ({ name: `row-${index}` }));
}

const ROW_HEIGHT = 30;

/** Convenience wrapper: fixed rowHeight/rowWidth, explicit range. */
function step(pool: DomPool<Row>, data: Row[], rowRange: Range, skipBind = false): DomPoolUpdate<Row> {
    const options: DomPoolUpdateOptions<Row> = { data, rowRange, rowHeight: ROW_HEIGHT, rowWidth: 100, skipBind };
    return pool.update(options);
}

describe("DomPool — ring slot mapping (slot = rowIndex % poolSize)", () => {
    it("binds every row of the initial window and positions nodes at rowIndex * rowHeight", () => {
        const log: string[] = [];
        const { bindings, hosts } = makeBindings(log);
        const pool = new DomPool<Row>({ rowHeight: ROW_HEIGHT, bindings });
        const data = makeData(100);

        const update = step(pool, data, { start: 0, end: 5 });

        expect(pool.size).toBe(5);
        expect(update.bound).toHaveLength(5);
        expect(hosts.map((host) => update.bound.find((item) => item.host === host)?.row.index)).toEqual([0, 1, 2, 3, 4]);
        for (let index = 0; index < 5; index += 1) {
            expect(log).toContain(`pos:${index}@${index * ROW_HEIGHT}`);
        }
    });

    it("scrolling by k rows rebinds ONLY the k recycled slots — content travels with its row", () => {
        const log: string[] = [];
        const { bindings } = makeBindings(log);
        const pool = new DomPool<Row>({ rowHeight: ROW_HEIGHT, bindings });
        const data = makeData(100);

        step(pool, data, { start: 0, end: 10 });
        log.length = 0;

        // Scroll down 3 rows: window [3, 13). Rows 3..9 stay on their slots
        // (only transform changes); rows 10..12 recycle the 3 slots freed by
        // rows 0..2. Slot for row r is r % 10.
        const update = step(pool, data, { start: 3, end: 13 });

        // Exactly 3 content binds: rows 10, 11, 12 on slots 0, 1, 2.
        expect(update.bound.map((item) => item.row.index)).toEqual([10, 11, 12]);
        expect(update.bound.map((item) => (item.host as TestHost).id)).toEqual([0, 1, 2]);

        // Every row keeps its slot: row r on slot r % 10 — no cross-slot moves.
        for (const item of update.bound) {
            expect((item.host as TestHost).id).toBe(item.row.index % 10);
        }
    });

    it("rebinding a recycled slot reuses the SAME node that held the departed row", () => {
        const log: string[] = [];
        const { bindings, hosts } = makeBindings(log);
        const pool = new DomPool<Row>({ rowHeight: ROW_HEIGHT, bindings });
        const data = makeData(100);

        step(pool, data, { start: 0, end: 10 });
        // Row 0 lives on host 0 (slot 0 % 10).
        const update = step(pool, data, { start: 1, end: 11 });

        // Row 10 recycles host 0, which previously showed row 0.
        expect(update.bound).toHaveLength(1);
        expect(update.bound[0].host).toBe(hosts[0]);
        expect(update.bound[0].row.index).toBe(10);
    });

    it("keeps the pool at its high-water mark — no node is created or destroyed while scrolling", () => {
        const log: string[] = [];
        const { bindings } = makeBindings(log);
        const pool = new DomPool<Row>({ rowHeight: ROW_HEIGHT, bindings });
        const data = makeData(100);

        step(pool, data, { start: 0, end: 10 });
        expect(pool.size).toBe(10);

        for (let start = 1; start <= 50; start += 1) {
            step(pool, data, { start, end: start + 10 });
        }
        expect(pool.size).toBe(10);
    });
});

describe("DomPool — fast scroll (skipBind) and recovery", () => {
    it("skipBind updates positions but defers content binding for recycled slots", () => {
        const log: string[] = [];
        const { bindings } = makeBindings(log);
        const pool = new DomPool<Row>({ rowHeight: ROW_HEIGHT, bindings });
        const data = makeData(100);

        step(pool, data, { start: 0, end: 10 });
        log.length = 0;

        const update = step(pool, data, { start: 7, end: 17 }, true);

        // No content binds — fast-scroll strategy defers them.
        expect(update.bound).toHaveLength(0);
        // Only the 7 ENTERING rows (10..16) receive a transform; rows 7..9
        // keep their absolute offsets (rowIndex * rowHeight) untouched.
        expect(update.positioned).toHaveLength(7);
        expect(update.positioned[0].offsetY).toBe(10 * ROW_HEIGHT);
    });

    it("after fast scroll stops, stale slots are rebound within the gradual quota", () => {
        const log: string[] = [];
        const { bindings } = makeBindings(log);
        const pool = new DomPool<Row>({ rowHeight: ROW_HEIGHT, bindings });
        const data = makeData(100);

        step(pool, data, { start: 0, end: 9 });
        step(pool, data, { start: 20, end: 29 }, true);

        // First slow frame: quota = floor(9 / 3) = 3 — top of window first.
        const first = step(pool, data, { start: 20, end: 29 });
        expect(first.bound.map((item) => item.row.index)).toEqual([20, 21, 22]);

        // Second frame binds the next 3, third frame finishes the window.
        const second = step(pool, data, { start: 20, end: 29 });
        expect(second.bound.map((item) => item.row.index)).toEqual([23, 24, 25]);
        const third = step(pool, data, { start: 20, end: 29 });
        expect(third.bound.map((item) => item.row.index)).toEqual([26, 27, 28]);

        // Settled: nothing left to bind.
        const settled = step(pool, data, { start: 20, end: 29 });
        expect(settled.bound).toHaveLength(0);
    });

    it("resizes recycled nodes during a fast scroll so the boxes match the virtualizer", () => {
        const log: string[] = [];
        const { bindings } = makeBindings(log);
        const resized: number[] = [];
        bindings.resizeRow = (host: RowHost<Row>, height: number): void => {
            resized.push(height);
        };
        const pool = new DomPool<Row>({ rowHeight: ROW_HEIGHT, bindings });
        const data = makeData(100);

        // Slow frame: rows 0..4 with individual heights.
        pool.update({
            data,
            rowRange: { start: 0, end: 5 },
            rowHeight: ROW_HEIGHT,
            rowOffsets: [0, 40, 80, 120, 160],
            rowHeights: [40, 40, 40, 40, 40],
            rowWidth: 100,
        });

        resized.length = 0;
        // Fast scroll: the window jumps to rows 50..54, the content binding is
        // deferred — but the recycled nodes MUST get the height of the row
        // they now stand for, otherwise a 40px node occupies a 90px slot
        // (overlap) or a 90px node occupies a 40px slot (gap).
        const update = pool.update({
            data,
            rowRange: { start: 50, end: 55 },
            rowHeight: ROW_HEIGHT,
            rowOffsets: [500, 590, 680, 770, 860],
            rowHeights: [90, 90, 90, 90, 90],
            rowWidth: 100,
            skipBind: true,
        });

        expect(update.bound).toHaveLength(0);
        expect(resized).toEqual([90, 90, 90, 90, 90]);
    });

    it("binds the rows that intersect the viewport even while the fast scroll defers the rest", () => {
        const log: string[] = [];
        const { bindings } = makeBindings(log);
        const pool = new DomPool<Row>({ rowHeight: ROW_HEIGHT, bindings });
        const data = makeData(100);

        step(pool, data, { start: 0, end: 10 });
        log.length = 0;

        // Fast scroll to rows 50..59 — the viewport only shows rows 52..55.
        const update = pool.update({
            data,
            rowRange: { start: 50, end: 60 },
            rowHeight: ROW_HEIGHT,
            rowWidth: 100,
            visibleRowRange: { start: 52, end: 56 },
            skipBind: true,
        });

        // Only the VISIBLE rows are bound: a recycled node that is not
        // re-bound would show the data of an unrelated row.
        expect(update.bound.map((item) => item.row.index)).toEqual([52, 53, 54, 55]);
    });

    it("reports the new row index of a recycled node even while its content is still stale", () => {
        const log: string[] = [];
        const { bindings } = makeBindings(log);
        const pool = new DomPool<Row>({ rowHeight: ROW_HEIGHT, bindings });
        const data = makeData(100);

        const indexes: number[] = [];
        bindings.updateRowIndex = (host: RowHost<Row>, rowIndex: number): void => {
            indexes.push(rowIndex);
        };

        step(pool, data, { start: 0, end: 9 });
        log.length = 0;

        // Fast scroll: the off-screen slots are re-used for new rows, but their
        // content cannot be re-bound in the same frame.
        pool.update({
            data,
            rowRange: { start: 20, end: 29 },
            rowHeight: ROW_HEIGHT,
            rowWidth: 100,
            visibleRowRange: { start: 20, end: 23 },
            skipBind: true,
        });

        // Every re-used node reports the row it now stands for — the adapters
        // look rows up by index (hover highlight), a stale index would
        // highlight the wrong node. The VISIBLE rows (20..22) are bound right
        // away, so they report their index through the bind.
        expect(indexes).toEqual([23, 24, 25, 26, 27, 28]);
    });

    it("keeps the off-screen rows unbound during a fast scroll and binds them by the quota afterwards", () => {
        const log: string[] = [];
        const { bindings } = makeBindings(log);
        const pool = new DomPool<Row>({ rowHeight: ROW_HEIGHT, bindings });
        const data = makeData(100);

        step(pool, data, { start: 0, end: 9 });
        log.length = 0;

        const fast = pool.update({
            data,
            rowRange: { start: 20, end: 29 },
            rowHeight: ROW_HEIGHT,
            rowWidth: 100,
            visibleRowRange: { start: 20, end: 23 },
            skipBind: true,
        });
        // Only the three visible rows are bound right away.
        expect(fast.bound.map((item) => item.row.index)).toEqual([20, 21, 22]);

        // The scroll settled: the stale off-screen slots follow the quota
        // (floor(9 / 3) = 3 per frame) — the visible ones are already bound.
        const first = pool.update({
            data,
            rowRange: { start: 20, end: 29 },
            rowHeight: ROW_HEIGHT,
            rowWidth: 100,
            visibleRowRange: { start: 20, end: 23 },
        });
        expect(first.bound.map((item) => item.row.index)).toEqual([23, 24, 25]);
    });
});

describe("DomPool — window shrink and invalidate", () => {
    it("recycles slots whose row left the window, wherever they sit in the pool", () => {
        const log: string[] = [];
        const { bindings, hosts } = makeBindings(log);
        const pool = new DomPool<Row>({ rowHeight: ROW_HEIGHT, bindings });
        const data = makeData(100);

        step(pool, data, { start: 0, end: 10 });
        log.length = 0;

        // Window shrinks to [0, 4): rows 4..9 (slots 4..9) leave the window.
        const update = step(pool, data, { start: 0, end: 4 });

        expect(update.recycled).toHaveLength(6);
        const recycledIds: number[] = update.recycled.map((host) => (host as TestHost).id).sort((a, b) => a - b);
        expect(recycledIds).toEqual([4, 5, 6, 7, 8, 9]);
        // Recycled nodes are parked off-screen.
        for (const id of recycledIds) {
            expect(log).toContain(`pos:${id}@-200000`);
        }
        expect(hosts).toHaveLength(10);
    });

    it("invalidate() rebinds every visible row on the next frame", () => {
        const log: string[] = [];
        const { bindings } = makeBindings(log);
        const pool = new DomPool<Row>({ rowHeight: ROW_HEIGHT, bindings });
        const data = makeData(100);

        step(pool, data, { start: 5, end: 10 });
        pool.invalidate();

        const update = step(pool, data, { start: 5, end: 10 });
        expect(update.bound.map((item) => item.row.index)).toEqual([5, 6, 7, 8, 9]);
    });

    it("data replacement force-rebinds visible rows without growing the pool", () => {
        const log: string[] = [];
        const { bindings } = makeBindings(log);
        const pool = new DomPool<Row>({ rowHeight: ROW_HEIGHT, bindings });

        step(pool, makeData(50), { start: 0, end: 8 });
        const update = step(pool, makeData(50), { start: 0, end: 8 });

        expect(pool.size).toBe(8);
        expect(update.bound).toHaveLength(8);
    });

    it("respects rowOffsets and rowHeights when provided for variable-height rows", () => {
        const log: string[] = [];
        const { bindings } = makeBindings(log);
        const pool = new DomPool<Row>({ rowHeight: ROW_HEIGHT, bindings });
        const data = makeData(10);

        // rowOffsets: [0, 45, 120], rowHeights: [45, 75, 30]
        const update = pool.update({
            data,
            rowRange: { start: 0, end: 3 },
            rowHeight: ROW_HEIGHT,
            rowOffsets: [0, 45, 120],
            rowHeights: [45, 75, 30],
            rowWidth: 100,
        });

        expect(log).toContain("pos:0@0");
        expect(log).toContain("pos:1@45");
        expect(log).toContain("pos:2@120");

        expect(update.bound[0]?.row.height).toBe(45);
        expect(update.bound[1]?.row.height).toBe(75);
        expect(update.bound[2]?.row.height).toBe(30);
    });

    it("rebinds an existing row slot when its height changes", () => {
        const log: string[] = [];
        const { bindings } = makeBindings(log);
        const pool = new DomPool<Row>({ rowHeight: ROW_HEIGHT, bindings });
        const data = makeData(10);

        pool.update({
            data,
            rowRange: { start: 0, end: 2 },
            rowHeight: ROW_HEIGHT,
            rowOffsets: [0, 30],
            rowHeights: [30, 30],
            rowWidth: 100,
        });

        log.length = 0;
        // Same row indices 0 and 1, but row 0 height changes to 80
        const update = pool.update({
            data,
            rowRange: { start: 0, end: 2 },
            rowHeight: ROW_HEIGHT,
            rowOffsets: [0, 80],
            rowHeights: [80, 30],
            rowWidth: 100,
        });

        // Row 0 had height changed, so it must be rebound
        expect(update.bound.some((item) => item.row.index === 0 && item.row.height === 80)).toBe(true);
    });

    it("resizes — instead of re-binding — a row whose height changed", () => {
        const log: string[] = [];
        const { bindings } = makeBindings(log);
        const resized: number[] = [];
        bindings.resizeRow = (host: RowHost<Row>, height: number): void => {
            resized.push(height);
            log.push(`resize:${(host as TestHost).id}@${height}`);
        };
        const pool = new DomPool<Row>({ rowHeight: ROW_HEIGHT, bindings });
        const data = makeData(10);

        pool.update({
            data,
            rowRange: { start: 0, end: 2 },
            rowHeight: ROW_HEIGHT,
            rowOffsets: [0, 30],
            rowHeights: [30, 30],
            rowWidth: 100,
        });

        log.length = 0;
        const update = pool.update({
            data,
            rowRange: { start: 0, end: 2 },
            rowHeight: ROW_HEIGHT,
            rowOffsets: [0, 80],
            rowHeights: [80, 30],
            rowWidth: 100,
        });

        // The row content is still valid — only its box changed.
        expect(update.bound).toHaveLength(0);
        expect(resized).toEqual([80]);
        expect(log).toContain("resize:0@80");
        // The row below keeps its position, the resized row moves down.
        expect(log).toContain("pos:1@80");
    });
});
