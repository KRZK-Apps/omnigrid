import { Grid } from "./grid";
import type { ColumnDef, GridPlugin } from "./types";

interface Row {
    name: string;
}

/** Builds a grid with the given columns and a fixed row set, measured to `width`. */
function makeGrid(columns: ColumnDef<Row>[], width: number, height = 500, scrollLeft = 0): Grid<Row> {
    const data: Row[] = Array.from({ length: 100 }, (_, i) => ({ name: `row-${i}` }));
    const grid = new Grid<Row>({ columns, data, rowHeight: 32, columnOverscan: 0 });
    grid.setViewport({ width, height });
    if (scrollLeft) grid.setViewport({ scrollLeft });
    return grid;
}

describe("Grid.getViewportData — pinned columns", () => {
    const columns: ColumnDef<Row>[] = [
        { id: "pl1", pinned: "left", width: 100 },
        { id: "c1", width: 120 },
        { id: "c2", flex: 1 },
        { id: "pl2", pinned: "left", width: 80 },
        { id: "pr1", pinned: "right", width: 90 },
    ];

    it("partitions columns into pinned-left / scrollable / pinned-right", () => {
        const grid = makeGrid(columns, 1000);
        const vd = grid.getViewportData();

        const pinnedIds = (items: { column: ColumnDef<Row> }[]) => items.map((i) => i.column.id);
        expect(pinnedIds(vd.pinnedLeftColumns)).toEqual(["pl1", "pl2"]);
        expect(pinnedIds(vd.columns)).toEqual(["c1", "c2"]);
        expect(pinnedIds(vd.pinnedRightColumns)).toEqual(["pr1"]);
    });

    it("composes offsets across the three groups and sums to totalWidth", () => {
        const grid = makeGrid(columns, 1000);
        const vd = grid.getViewportData();

        // Pinned-left: absolute offsets from 0.
        expect(vd.pinnedLeftColumns[0]).toMatchObject({ column: { id: "pl1" }, offset: 0, width: 100 });
        expect(vd.pinnedLeftColumns[1]).toMatchObject({ column: { id: "pl2" }, offset: 100, width: 80 });

        // Scrollable: shifted by pinnedLeftWidth (180). c1 fixed=120, c2 flex fills remainder.
        const scrollLeftWidth = 730; // 1000 - 180 - 90
        expect(vd.columns[0]).toMatchObject({ column: { id: "c1" }, offset: 180, width: 120 });
        expect(vd.columns[1]).toMatchObject({ column: { id: "c2" }, offset: 300, width: scrollLeftWidth - 120 });

        // Pinned-right: shifted by pinnedLeftWidth + scrollableWidth (= 180 + 730 = 910).
        expect(vd.pinnedRightColumns[0]).toMatchObject({ column: { id: "pr1" }, offset: 910, width: 90 });

        // totalWidth is the sum of all three group widths.
        expect(vd.totalWidth).toBe(180 + scrollLeftWidth + 90);
        expect(vd.totalWidth).toBe(1000);
    });

    it("does not include pinned columns in the scrollable column window", () => {
        const grid = makeGrid(columns, 1000);
        const vd = grid.getViewportData();
        expect(vd.columnRange).toEqual({ start: 0, end: 2 });
        expect(vd.columns.every((c) => c.column.pinned === undefined)).toBe(true);
    });

    it("respects an explicit width on a flex column while preserving relative sizing for the remaining flex columns", () => {
        const grid = makeGrid(
            [
                { id: "a", flex: 1, minWidth: 80, width: 140 },
                { id: "b", flex: 1, minWidth: 80 },
                { id: "c", flex: 1, minWidth: 80 },
            ],
            600,
        );

        const vd = grid.getViewportData();
        expect(vd.columns.map((item) => item.width)).toEqual([140, 230, 230]);
    });

    it("recomputes flex widths when setColumns changes a non-leading column", () => {
        const grid = makeGrid(
            [
                { id: "locked", width: 100, resizable: false },
                { id: "resized", flex: 1, minWidth: 100 },
                { id: "remaining", flex: 1, minWidth: 100 },
            ],
            600,
        );

        expect(grid.getViewportData().columns.map((item) => item.width)).toEqual([100, 250, 250]);

        grid.setColumns([
            { id: "locked", width: 100, resizable: false },
            { id: "resized", width: 300 },
            { id: "remaining", flex: 1, minWidth: 100 },
        ]);

        expect(grid.getViewportData().columns.map((item) => item.width)).toEqual([100, 300, 200]);
    });
});

describe("Grid.getViewportData — horizontal windowing of scrollable columns", () => {
    const columns: ColumnDef<Row>[] = [
        { id: "pl", pinned: "left", width: 100 },
        { id: "c0", width: 100 },
        { id: "c1", width: 100 },
        { id: "c2", width: 100 },
        { id: "c3", width: 100 },
        { id: "c4", width: 100 },
        { id: "c5", width: 100 },
        { id: "c6", width: 100 },
        { id: "c7", width: 100 },
        { id: "c8", width: 100 },
        { id: "c9", width: 100 },
        { id: "pr", pinned: "right", width: 100 },
    ];

    it("windows the central slice based on scrollLeft, with offsets in table space", () => {
        // viewport 500; pinned 100+100; scrollable viewport = 300 -> 3 columns visible.
        const grid = makeGrid(columns, 500, 500, 0);
        const first = grid.getViewportData();

        expect(first.columns.map((c) => c.column.id)).toEqual(["c0", "c1", "c2", "c3"]);
        // Central column offsets are shifted by pinnedLeftWidth (100).
        expect(first.columns[0].offset).toBe(100);
        expect(first.columns[1].offset).toBe(200);
        expect(first.columnRange).toEqual({ start: 0, end: 4 });

        // Pinned members are unaffected by horizontal scroll.
        const pinnedRightOffset = 100 + 1000; // pinnedLeftWidth + scrollableWidth
        expect(grid.getViewportData().pinnedLeftColumns[0].offset).toBe(0);
        expect(grid.getViewportData().pinnedRightColumns[0].offset).toBe(pinnedRightOffset);
    });

    it("shifts the central window without moving the pinned columns", () => {
        const grid = makeGrid(columns, 500, 500, 400);
        const vd = grid.getViewportData();

        // At scrollLeft=400 the visible central columns are c4..x.
        expect(vd.columns[0].column.id).toBe("c4");
        expect(vd.columns[0].offset).toBe(100 + 400); // pinnedLeftWidth + scrollLeft
        expect(vd.pinnedLeftColumns[0].offset).toBe(0);
        expect(vd.pinnedRightColumns[0].offset).toBe(100 + 1000);
        expect(vd.totalWidth).toBe(100 + 1000 + 100);
    });

    it("falls back to a degenerate window when there are no scrollable columns", () => {
        const grid = makeGrid([{ id: "pl", pinned: "left", width: 120 }], 800);
        const vd = grid.getViewportData();
        expect(vd.columns).toEqual([]);
        expect(vd.columnRange).toEqual({ start: 0, end: 0 });
        expect(vd.totalWidth).toBe(120);
    });
});

describe("Grid.getViewportData — column spanning", () => {
    const columns: ColumnDef<Row>[] = [
        { id: "c0", width: 100, colSpan: 3 },
        { id: "c1", width: 100 },
        { id: "c2", width: 100 },
        { id: "c3", width: 100 },
        { id: "c4", width: 100 },
        { id: "c5", width: 100 },
        { id: "c6", width: 100 },
        { id: "c7", width: 100 },
        { id: "c8", width: 100 },
        { id: "c9", width: 100 },
    ];

    it("exposes full leaf geometry and expands the window so spans are not clipped", () => {
        // Scroll deep: base window would start at c4, but the c0 span origin
        // lookback pulls it back and the static span extends the right edge.
        const grid = makeGrid(columns, 500, 500, 400);
        const vd = grid.getViewportData();

        expect(vd.leafColumns.map((c) => c.id)).toEqual(columns.map((c) => c.id));
        expect(vd.columnOffsets).toHaveLength(10);
        expect(vd.columnOffsets[0]).toMatchObject({ offset: 0, size: 100 });
        // Expanded left (origin lookback) and right (static span tail).
        expect(vd.columnRange.start).toBe(0);
        expect(vd.columns[0].column.id).toBe("c0");
        expect(vd.columns.map((c) => c.column.id)).toContain("c6");

        const data: Row[] = [{ name: "row-0" }];
        const spanned = makeGrid(columns, 500, 500, 400);
        spanned.setData(data);
        const layout = spanned.getRowSpans(data[0], 0, vd.leafColumns, vd.columnOffsets);
        expect(layout.spans[0]).toEqual({ span: 3, covered: false });
        expect(layout.widths[0]).toBe(300);
        expect(layout.offsets[0]).toBe(0);
        expect(spanned.resolveColSpan(data[0], 0, vd.leafColumns[0], 0, vd.leafColumns.length)).toBe(3);
        spanned.destroy();
        grid.destroy();
    });

    it("leaves the window untouched when no column declares colSpan", () => {
        const plain: ColumnDef<Row>[] = [
            { id: "c0", width: 100 },
            { id: "c1", width: 100 },
            { id: "c2", width: 100 },
            { id: "c3", width: 100 },
            { id: "c4", width: 100 },
            { id: "c5", width: 100 },
        ];
        const grid = makeGrid(plain, 500, 500, 200);
        const vd = grid.getViewportData();
        expect(vd.columnRange).toEqual({ start: 2, end: 6 });
        expect(vd.leafColumns.map((c) => c.id)).toEqual(["c0", "c1", "c2", "c3", "c4", "c5"]);
        grid.destroy();
    });
});

describe("Grid.getRevision — structural change detection", () => {
    it("increments on setData", () => {
        const grid = makeGrid([{ id: "a", width: 100 }], 800);
        const before = grid.getRevision();
        grid.setData([{ name: "x" }]);
        expect(grid.getRevision()).toBe(before + 1);
    });

    it("does not increment on scroll-only updates", () => {
        const grid = makeGrid([{ id: "a", width: 100 }], 800);
        const before = grid.getRevision();
        grid.setViewport({ scrollLeft: 50 });
        expect(grid.getRevision()).toBe(before);
    });

    it("requests native scroll updates through the scrollTo event", () => {
        const grid = makeGrid([{ id: "a", width: 100 }], 800);
        const listener = vi.fn();
        grid.on("scrollTo", listener);

        grid.scrollTo({ scrollTop: 64 });

        expect(grid.getScrollPosition()).toEqual({ scrollTop: 64, scrollLeft: 0 });
        expect(listener).toHaveBeenCalledWith({ scrollTop: 64, scrollLeft: 0 });
    });
});

describe("Grid.appendData — chunk-append for incremental loading", () => {
    it("appends rows to the end of the existing dataset", () => {
        const grid = makeGrid([{ id: "a", width: 100 }], 800);
        const initialLength: number = grid.getState().data.length;

        grid.appendData([{ name: "appended-0" }, { name: "appended-1" }]);

        const data = grid.getState().data;
        expect(data.length).toBe(initialLength + 2);
        expect(data[initialLength]).toEqual({ name: "appended-0" });
        expect(data[initialLength + 1]).toEqual({ name: "appended-1" });
    });

    it("emits a single dataChange with the combined array", () => {
        const grid = makeGrid([{ id: "a", width: 100 }], 800);
        const listener = vi.fn();
        grid.on("dataChange", listener);

        grid.appendData([{ name: "appended-0" }]);

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(grid.getState().data);
    });

    it("increments the revision and invalidates the processed data cache", () => {
        const grid = makeGrid([{ id: "a", width: 100 }], 800);
        const before = grid.getRevision();
        const cachedBefore = grid.getProcessedData();

        grid.appendData([{ name: "appended-0" }]);

        expect(grid.getRevision()).toBe(before + 1);
        expect(grid.getProcessedData()).not.toBe(cachedBefore);
        expect(grid.getProcessedData().length).toBe(101);
    });

    it("is a no-op for empty, null, or undefined rows", () => {
        const grid = makeGrid([{ id: "a", width: 100 }], 800);
        const listener = vi.fn();
        grid.on("dataChange", listener);
        const before = grid.getRevision();

        grid.appendData([]);
        grid.appendData(null);
        grid.appendData(undefined);

        expect(grid.getState().data.length).toBe(100);
        expect(grid.getRevision()).toBe(before);
        expect(listener).not.toHaveBeenCalled();
    });
});

describe("Grid.getColumnWidth", () => {
    it("returns calculated widths for columns outside the current virtual window", () => {
        const columns: ColumnDef<Row>[] = Array.from({ length: 8 }, (_, index) => ({
            id: `c${index}`,
            flex: 1,
        }));
        const grid = makeGrid(columns, 800, 500, 400);
        const viewportData = grid.getViewportData();

        expect(viewportData.columns.some((item) => item.column.id === "c0")).toBe(false);
        expect(grid.getColumnWidth("c0")).toBe(100);
        expect(grid.getColumnWidth("c7")).toBe(100);
        expect(grid.getColumnWidth("missing")).toBeUndefined();
    });
});

describe("Grid.getViewportData — column groups", () => {
    it("flattens nested columns into the virtual window and reports group spans", () => {
        const columns: ColumnDef<Row>[] = [
            {
                id: "g1",
                header: "G1",
                children: [
                    { id: "a", header: "A", width: 100 },
                    { id: "b", header: "B", width: 100 },
                ],
            },
            { id: "c", header: "C", flex: 1, minWidth: 100 },
        ];
        const grid = makeGrid(columns, 800);
        const vd = grid.getViewportData();

        // Only leaf columns reach the virtual window — groups never do.
        expect(vd.columns.map((item) => item.column.id)).toEqual(["a", "b", "c"]);
        expect(vd.columns[1].offset).toBe(100);
        expect(vd.totalWidth).toBe(800);

        // Group metadata spans the flattened visible leaf order.
        expect(vd.columnGroups).toHaveLength(1);
        expect(vd.columnGroups[0]).toMatchObject({
            startIndex: 0,
            endIndex: 2,
            depth: 0,
        });
        expect(vd.columnGroups[0].group.id).toBe("g1");
    });

    it("treats group members as plain leaves when pinned", () => {
        const columns: ColumnDef<Row>[] = [
            {
                id: "g",
                header: "G",
                children: [
                    { id: "pl", header: "PL", width: 80, pinned: "left" },
                    { id: "c", header: "C", width: 120 },
                ],
            },
        ];
        const grid = makeGrid(columns, 800);
        const vd = grid.getViewportData();

        expect(vd.pinnedLeftColumns.map((item) => item.column.id)).toEqual(["pl"]);
        expect(vd.columns.map((item) => item.column.id)).toEqual(["c"]);
        expect(vd.columnGroups[0]).toMatchObject({ startIndex: 0, endIndex: 2, depth: 0 });
    });

    it("excludes hidden leaves from the flat layout and group spans", () => {
        const columns: ColumnDef<Row>[] = [
            {
                id: "g",
                header: "G",
                children: [
                    { id: "a", header: "A", width: 100 },
                    { id: "hidden", header: "H", width: 100, hidden: true },
                    { id: "b", header: "B", width: 100 },
                ],
            },
        ];
        const grid = makeGrid(columns, 800);
        const vd = grid.getViewportData();

        expect(vd.columns.map((item) => item.column.id)).toEqual(["a", "b"]);
        // The span counts visible leaves only: [a, b) -> indices 0..2.
        expect(vd.columnGroups[0]).toMatchObject({ startIndex: 0, endIndex: 2, depth: 0 });
    });

    it("returns an empty group list when the columns contain no groups", () => {
        const grid = makeGrid([{ id: "a", width: 100 }], 800);
        const vd = grid.getViewportData();
        expect(vd.columnGroups).toEqual([]);
        expect(vd.headerRowCount).toBe(0);
        expect(vd.columnGroupDepth.size).toBe(0);
    });
});

describe("Grid.getViewportData — group header metadata", () => {
    it("reports headerRowCount as maxGroupDepth + 1 for nested groups", () => {
        const columns: ColumnDef<Row>[] = [
            { id: "a", width: 100 },
            {
                id: "g",
                header: "G",
                children: [
                    {
                        id: "inner",
                        header: "Inner",
                        children: [
                            { id: "b", width: 100 },
                            { id: "c", width: 100 },
                        ],
                    },
                    { id: "d", width: 100 },
                ],
            },
        ];
        const grid = makeGrid(columns, 800);
        const vd = grid.getViewportData();

        // Two group depths (0 and 1) → headerRowCount = 2.
        expect(vd.headerRowCount).toBe(2);
    });

    it("maps each leaf column to its deepest covering group depth", () => {
        const columns: ColumnDef<Row>[] = [
            { id: "a", width: 100 },
            {
                id: "outer",
                header: "O",
                children: [
                    {
                        id: "inner",
                        header: "I",
                        children: [
                            { id: "b", width: 100 },
                            { id: "c", width: 100 },
                        ],
                    },
                    { id: "d", width: 100 },
                ],
            },
            { id: "e", width: 100 },
        ];
        const grid = makeGrid(columns, 800);
        const vd = grid.getViewportData();

        // Flat visible leaf order: a(0), b(1), c(2), d(3), e(4)
        // - a: no group covers it (top-level leaf sibling of "outer")
        // - b: depth 1 (covered by "inner" at depth 1, which is under "outer" depth 0)
        // - c: depth 1 (same as b)
        // - d: depth 0 (covered by "outer" only — not under "inner")
        // - e: no group covers it (top-level leaf sibling of "outer")
        expect(vd.columnGroupDepth.has(0)).toBe(false);
        expect(vd.columnGroupDepth.get(1)).toBe(1);
        expect(vd.columnGroupDepth.get(2)).toBe(1);
        expect(vd.columnGroupDepth.get(3)).toBe(0);
        expect(vd.columnGroupDepth.has(4)).toBe(false);
    });
});

describe("Grid.getViewportData — integer pixel geometry for flex columns", () => {
    it("emits whole-pixel widths and offsets when the flex share is fractional", () => {
        // 1161 is an awkward width: two equal flex columns would each get
        // 35.5 extra px — a sub-pixel flex↔fixed seam that used to cover the
        // 1px column border (the sector | speedKmh bug).
        const columns: ColumnDef<Row>[] = [
            { id: "fixedA", width: 110 },
            { id: "flexA", flex: 1, minWidth: 300 },
            { id: "flexB", flex: 1, minWidth: 300 },
            { id: "fixedB", width: 130 },
        ];
        const grid = makeGrid(columns, 1161);
        const vd = grid.getViewportData();

        expect(vd.totalWidth).toBe(1161);
        const flat = vd.columns;
        expect(flat).toHaveLength(columns.length);
        expect(flat.every((item) => Number.isInteger(item.width))).toBe(true);
        expect(flat.every((item) => Number.isInteger(item.offset))).toBe(true);

        // Adjacent columns always touch at an exact pixel boundary — no
        // sub-pixel overlap or gap at the flex↔fixed seam.
        let cursor = 0;
        for (const item of flat) {
            expect(item.offset).toBe(cursor);
            cursor += item.width;
        }
        expect(cursor).toBe(1161);
    });
});

describe("Grid.setPlugins — dynamic plugin reconciliation", () => {
    it("registers new plugins, unregisters removed ones and keeps unchanged ones", () => {
        const cleanupA: ReturnType<typeof vi.fn> = vi.fn();
        const cleanupB: ReturnType<typeof vi.fn> = vi.fn();
        const registerA: ReturnType<typeof vi.fn> = vi.fn(() => cleanupA);
        const registerB: ReturnType<typeof vi.fn> = vi.fn(() => cleanupB);
        const pluginA: GridPlugin<unknown> = { name: "a", register: registerA };
        const pluginB: GridPlugin<unknown> = { name: "b", register: registerB };
        const grid: Grid<unknown> = new Grid<unknown>({ columns: [], data: [], plugins: [pluginA] });

        grid.setPlugins([pluginA, pluginB]);
        expect(registerA).toHaveBeenCalledTimes(1);
        expect(registerB).toHaveBeenCalledTimes(1);

        grid.setPlugins([pluginB]);
        expect(cleanupA).toHaveBeenCalledTimes(1);
        expect(cleanupB).not.toHaveBeenCalled();

        grid.setPlugins([pluginA]);
        expect(cleanupB).toHaveBeenCalledTimes(1);
        expect(registerA).toHaveBeenCalledTimes(2);
    });

    it("resets vertical scroll only when the plugin set changes", () => {
        const plugin: GridPlugin<unknown> = { name: "a", register: () => undefined };
        const grid: Grid<unknown> = new Grid<unknown>({ columns: [], data: [], plugins: [plugin] });

        grid.scrollTo({ scrollTop: 300, scrollLeft: 40 });
        grid.setPlugins([plugin]);
        expect(grid.getScrollPosition().scrollTop).toBe(300);

        grid.setPlugins([]);
        expect(grid.getScrollPosition()).toEqual({ scrollTop: 0, scrollLeft: 40 });
    });
});

describe("Grid — Variable Row Height", () => {
    it("supports setRowHeight without touching the structural revision", () => {
        const grid = makeGrid([{ id: "a", width: 100 }], 800);
        const revisionBefore: number = grid.getRevision();

        const correction: number = grid.setRowHeight(0, 60);
        expect(correction).toBe(0); // at scrollTop 0, no scroll anchoring needed
        // A height change is a geometry change, not a structural one: bumping
        // the revision would force the DOM pool to re-bind every visible row.
        expect(grid.getRevision()).toBe(revisionBefore);
        expect(grid.getRowHeight(0)).toBe(60);
        expect(grid.getRowHeight(1)).toBe(32);
        expect(grid.getRowTop(0)).toBe(0);
        expect(grid.getRowTop(1)).toBe(60);
    });

    it("notifies subscribers about a height change", () => {
        const grid = makeGrid([{ id: "a", width: 100 }], 800);
        const listener = vi.fn();
        grid.subscribe(listener);

        grid.setRowHeight(0, 60);
        expect(listener).toHaveBeenCalled();
    });

    it("does not notify subscribers when the measured height did not change", () => {
        const grid = makeGrid([{ id: "a", width: 100 }], 800);
        const listener = vi.fn();
        grid.subscribe(listener);

        grid.setRowHeight(0, 60);
        listener.mockClear();

        // Sub-pixel noise is ignored by the registry.
        grid.setRowHeight(0, 60.5);
        expect(listener).not.toHaveBeenCalled();
    });

    it("defers the scroll anchoring correction when anchoring is disabled", () => {
        const grid = makeGrid([{ id: "a", width: 100 }], 800);
        grid.scrollTo({ scrollTop: 200 });

        const listener = vi.fn();
        grid.on("scrollTo", listener);

        const correction: number = grid.setRowHeight(0, 60, { anchor: false });
        expect(correction).toBe(28);
        expect(grid.getScrollPosition().scrollTop).toBe(200);
        expect(listener).not.toHaveBeenCalled();
    });

    it("triggers scroll anchoring when row above the viewport changes height", () => {
        const grid = makeGrid([{ id: "a", width: 100 }], 800);
        grid.scrollTo({ scrollTop: 200 });

        const listener = vi.fn();
        grid.on("scrollTo", listener);

        // Row 0 is at top 0 (< 200), grows by 28px (from 32 to 60)
        const correction: number = grid.setRowHeight(0, 60);
        expect(correction).toBe(28);
        expect(grid.getScrollPosition().scrollTop).toBe(228);
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ scrollTop: 228 }));
    });

    it("provides rowOffsets and rowHeights in getViewportData for variable-height grids", () => {
        const grid = makeGrid([{ id: "a", width: 100 }], 800);
        grid.setRowHeight(0, 50);
        grid.setRowHeight(1, 80);

        const vd = grid.getViewportData();
        expect(vd.rowOffsets).toBeDefined();
        expect(vd.rowHeights).toBeDefined();
        expect(vd.rowOffsets?.[0]).toBe(0);
        expect(vd.rowOffsets?.[1]).toBe(50);
        expect(vd.rowHeights?.[0]).toBe(50);
        expect(vd.rowHeights?.[1]).toBe(80);
        expect(vd.rows[0].offset).toBe(0);
        expect(vd.rows[0].height).toBe(50);
        expect(vd.rows[1].offset).toBe(50);
        expect(vd.rows[1].height).toBe(80);
    });

    it("keeps the row offsets consistent while the rows are measured during a scroll", () => {
        const data: Row[] = Array.from({ length: 300 }, (_: unknown, index: number) => ({ name: `row-${index}` }));
        const grid = new Grid<Row>({
            columns: [{ id: "a", width: 120 }],
            data,
            rowHeight: 32,
        });
        grid.setViewport({ width: 800, height: 480 });

        const measured: Set<number> = new Set();
        for (let step: number = 0; step < 40; step += 1) {
            grid.setViewport({ scrollTop: Math.min(9000, step * 300) });
            const viewport = grid.getViewportData();
            // The DOM measures the rows that are visible (plus the overscan).
            for (let index: number = viewport.rowRange.start; index < viewport.rowRange.end; index += 1) {
                if (measured.has(index)) continue;
                measured.add(index);
                grid.setRowHeight(index, 32 + ((index * 37) % 50));
            }

            const after = grid.getViewportData();
            const offsets: number[] = after.rowOffsets ?? [];
            for (let i: number = 1; i < offsets.length; i += 1) {
                const previous: number = offsets[i - 1] as number;
                const current: number = offsets[i] as number;
                // The offsets grow monotonically and match the measured heights.
                expect(current).toBeGreaterThanOrEqual(previous);
                const rowIndex: number = after.rowRange.start + i - 1;
                expect(Math.abs(current - (previous + grid.getRowHeight(rowIndex)))).toBeLessThanOrEqual(1);
            }
        }
    });

    it("respects declarative getRowHeight option", () => {
        const data: Row[] = [{ name: "r0" }, { name: "r1" }, { name: "r2" }];
        const grid = new Grid<Row>({
            columns: [{ id: "a", width: 100 }],
            data,
            rowHeight: 30,
            estimatedRowHeight: 35,
            getRowHeight: (index, row) => (row.name === "r1" ? 70 : undefined),
        });
        grid.setViewport({ width: 500, height: 500 });

        expect(grid.getRowHeight(0)).toBe(35); // fallback to estimatedRowHeight
        expect(grid.getRowHeight(1)).toBe(70); // resolved via callback
        expect(grid.getRowHeight(2)).toBe(35);

        const vd = grid.getViewportData();
        expect(vd.rowHeights?.[0]).toBe(35);
        expect(vd.rowHeights?.[1]).toBe(70);
        expect(vd.rowHeights?.[2]).toBe(35);
        expect(vd.totalHeight).toBe(35 + 70 + 35);
    });

    it("resets measured row heights on setData", () => {
        const grid = makeGrid([{ id: "a", width: 100 }], 800);
        grid.setRowHeight(0, 100);
        expect(grid.getRowHeight(0)).toBe(100);

        grid.setData([{ name: "new-0" }]);
        expect(grid.getRowHeight(0)).toBe(32); // restored back to default rowHeight
    });

    it("applies the grid-level wrapText flag to columns without an explicit one", () => {
        const grid = new Grid<Row>({
            columns: [
                { id: "a", field: "name" },
                { id: "b", field: "name", wrapText: false },
            ],
            data: [{ name: "r0" }],
            rowHeight: 32,
            wrapText: true,
        });

        const columns = grid.getState().columns;
        expect((columns[0] as { wrapText?: boolean }).wrapText).toBe(true);
        // An explicit column-level flag always wins.
        expect((columns[1] as { wrapText?: boolean }).wrapText).toBe(false);
    });
});

describe("Grid.applyTransaction — targeted row mutations", () => {
    interface Item {
        id: number;
        name: string;
    }

    function makeItemGrid(data: Item[] = []): Grid<Item> {
        const grid = new Grid<Item>({
            columns: [
                { id: "id", field: "id" },
                { id: "name", field: "name" },
            ],
            data,
            getRowId: (row) => row.id,
            rowHeight: 32,
        });
        grid.setViewport({ width: 800, height: 400 });
        return grid;
    }

    it("adds rows to the end and returns added nodes with resolved ids/indexes", () => {
        const grid = makeItemGrid([
            { id: 1, name: "a" },
            { id: 2, name: "b" },
        ]);
        const listener = vi.fn();
        grid.on("dataChange", listener);
        const before = grid.getRevision();

        const result = grid.applyTransaction({
            add: [{ id: 3, name: "c" }, { id: 4, name: "d" }],
        });

        expect(result.added).toEqual([
            { id: 3, index: 2, data: { id: 3, name: "c" } },
            { id: 4, index: 3, data: { id: 4, name: "d" } },
        ]);
        expect(result.updated).toEqual([]);
        expect(result.removed).toEqual([]);
        expect(grid.getState().data).toEqual([
            { id: 1, name: "a" },
            { id: 2, name: "b" },
            { id: 3, name: "c" },
            { id: 4, name: "d" },
        ]);
        expect(grid.getRevision()).toBe(before + 1);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(grid.getState().data);
    });

    it("inserts added rows at addIndex", () => {
        const grid = makeItemGrid([
            { id: 1, name: "a" },
            { id: 3, name: "c" },
        ]);
        const result = grid.applyTransaction({ add: [{ id: 2, name: "b" }], addIndex: 1 });

        expect(result.added).toEqual([{ id: 2, index: 1, data: { id: 2, name: "b" } }]);
        expect(grid.getState().data.map((row) => row.id)).toEqual([1, 2, 3]);
    });

    it("updates existing rows by id and returns updated nodes", () => {
        const grid = makeItemGrid([
            { id: 1, name: "a" },
            { id: 2, name: "b" },
        ]);
        const result = grid.applyTransaction({ update: [{ id: 2, name: "B" }] });

        expect(result.updated).toEqual([{ id: 2, index: 1, data: { id: 2, name: "B" } }]);
        expect(result.added).toEqual([]);
        expect(result.removed).toEqual([]);
        expect(grid.getState().data).toEqual([{ id: 1, name: "a" }, { id: 2, name: "B" }]);
        expect(grid.getState().data.length).toBe(2);
    });

    it("ignores updates for unknown ids", () => {
        const grid = makeItemGrid([{ id: 1, name: "a" }]);
        const before = grid.getRevision();
        const result = grid.applyTransaction({ update: [{ id: 99, name: "x" }] });

        expect(result.updated).toEqual([]);
        expect(grid.getState().data).toEqual([{ id: 1, name: "a" }]);
        expect(grid.getRevision()).toBe(before);
    });

    it("removes rows by id", () => {
        const grid = makeItemGrid([
            { id: 1, name: "a" },
            { id: 2, name: "b" },
            { id: 3, name: "c" },
        ]);
        const result = grid.applyTransaction({ remove: [2] });

        expect(result.removed).toEqual([{ id: 2, index: 1, data: { id: 2, name: "b" } }]);
        expect(grid.getState().data.map((row) => row.id)).toEqual([1, 3]);
    });

    it("removes rows by row object reference", () => {
        const grid = makeItemGrid([
            { id: 1, name: "a" },
            { id: 2, name: "b" },
        ]);
        const row: Item = grid.getState().data[1];
        const result = grid.applyTransaction({ remove: [row] });

        expect(result.removed).toEqual([{ id: 2, index: 1, data: { id: 2, name: "b" } }]);
        expect(grid.getState().data.map((row) => row.id)).toEqual([1]);
    });

    it("combines add, update and remove in a single transaction", () => {
        const grid = makeItemGrid([
            { id: 1, name: "a" },
            { id: 2, name: "b" },
            { id: 3, name: "c" },
        ]);
        const result = grid.applyTransaction({
            add: [{ id: 4, name: "d" }],
            update: [{ id: 2, name: "B" }],
            remove: [3],
        });

        expect(result.added).toEqual([{ id: 4, index: 2, data: { id: 4, name: "d" } }]);
        expect(result.updated).toEqual([{ id: 2, index: 1, data: { id: 2, name: "B" } }]);
        expect(result.removed).toEqual([{ id: 3, index: 2, data: { id: 3, name: "c" } }]);
        expect(grid.getState().data.map((row) => row.id)).toEqual([1, 2, 4]);
    });

    it("is a no-op for an empty transaction", () => {
        const grid = makeItemGrid([{ id: 1, name: "a" }]);
        const before = grid.getRevision();
        const result = grid.applyTransaction({});

        expect(result.added).toEqual([]);
        expect(result.updated).toEqual([]);
        expect(result.removed).toEqual([]);
        expect(grid.getRevision()).toBe(before);
        expect(grid.getState().data).toEqual([{ id: 1, name: "a" }]);
    });

    it("invalidates the processed data cache so the next read reflects the transaction", () => {
        const grid = makeItemGrid([
            { id: 1, name: "a" },
            { id: 2, name: "b" },
        ]);
        const cached = grid.getProcessedData();
        grid.applyTransaction({ add: [{ id: 3, name: "c" }] });

        expect(grid.getProcessedData()).not.toBe(cached);
        expect(grid.getProcessedData().length).toBe(3);
    });

    it("resets measured row heights for updated rows only (no size change)", () => {
        const grid = makeItemGrid([
            { id: 1, name: "a" },
            { id: 2, name: "b" },
        ]);
        grid.setRowHeight(0, 60);
        grid.setRowHeight(1, 80);
        expect(grid.getRowHeight(0)).toBe(60);
        expect(grid.getRowHeight(1)).toBe(80);

        grid.applyTransaction({ update: [{ id: 2, name: "B" }] });
        expect(grid.getRowHeight(0)).toBe(60);
        expect(grid.getRowHeight(1)).toBe(32);
    });

    it("resets all row heights when the dataset size changes", () => {
        const grid = makeItemGrid([
            { id: 1, name: "a" },
            { id: 2, name: "b" },
        ]);
        grid.setRowHeight(0, 60);
        grid.setRowHeight(1, 80);

        grid.applyTransaction({ add: [{ id: 3, name: "c" }] });
        expect(grid.getRowHeight(0)).toBe(32);
        expect(grid.getRowHeight(1)).toBe(32);
        expect(grid.getRowHeight(2)).toBe(32);
    });
});
