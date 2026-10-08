import { Grid } from "./grid";
import type { ColumnDef } from "./types";

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
