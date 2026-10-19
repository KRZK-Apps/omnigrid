import { flattenColumns, getCellSpanningParams, getColumnGroups, getRowSpans, isColumnGroup, isColumnLeaf, resolveColSpan } from "./columns";
import type { CellSpanningParams, ColumnDef, ColumnLeafDef } from "./types";

interface Row {
    name: string;
}

describe("flattenColumns", () => {
    it("returns the input untouched when there are no groups", () => {
        const columns: ColumnDef<Row>[] = [
            { id: "a", header: "A" },
            { id: "b", header: "B" },
        ];
        expect(flattenColumns(columns).map((c) => c.id)).toEqual(["a", "b"]);
    });

    it("flattens nested groups depth-first, preserving order", () => {
        const columns: ColumnDef<Row>[] = [
            {
                id: "g1",
                header: "G1",
                children: [
                    { id: "b", header: "B", width: 100 },
                    {
                        id: "g2",
                        header: "G2",
                        children: [
                            { id: "d", header: "D", width: 100 },
                            { id: "e", header: "E", width: 100 },
                        ],
                    },
                    { id: "c", header: "C", width: 100 },
                ],
            },
            { id: "a", header: "A", width: 100 },
        ];
        expect(flattenColumns(columns).map((c) => c.id)).toEqual(["b", "d", "e", "c", "a"]);
    });

    it("drops empty groups and keeps hidden leaves", () => {
        const columns: ColumnDef<Row>[] = [
            { id: "empty", header: "Empty", children: [] },
            { id: "a", header: "A", hidden: true },
        ];
        expect(flattenColumns(columns).map((c) => c.id)).toEqual(["a"]);
    });
});

describe("column group narrowing", () => {
    it("narrows group vs leaf definitions", () => {
        const group: ColumnDef<Row> = { id: "g", header: "G", children: [{ id: "a", header: "A" }] };
        const leaf: ColumnDef<Row> = { id: "b", header: "B" };
        expect(isColumnGroup(group)).toBe(true);
        expect(isColumnGroup(leaf)).toBe(false);
        expect(isColumnLeaf(group)).toBe(false);
        expect(isColumnLeaf(leaf)).toBe(true);
    });
});

describe("getColumnGroups", () => {
    it("reports pre-ordered group spans over the flat visible layout", () => {
        const columns: ColumnDef<Row>[] = [
            {
                id: "g1",
                header: "G1",
                children: [
                    { id: "a", header: "A" },
                    {
                        id: "g2",
                        header: "G2",
                        children: [{ id: "b", header: "B" }, { id: "c", header: "C" }],
                    },
                    { id: "d", header: "D" },
                ],
            },
            { id: "e", header: "E" },
        ];

        expect(getColumnGroups(columns)).toEqual([
            { group: columns[0], startIndex: 0, endIndex: 4, depth: 0 },
            { group: (columns[0] as { children: ColumnDef<Row>[] }).children[1], startIndex: 1, endIndex: 3, depth: 1 },
        ]);
    });

    it("respects the visibility filter and omits groups with no visible leaves", () => {
        const columns: ColumnDef<Row>[] = [
            {
                id: "g1",
                header: "G1",
                children: [
                    { id: "a", header: "A", hidden: true },
                    { id: "b", header: "B" },
                ],
            },
            { id: "empty", header: "Empty", children: [{ id: "c", header: "C", hidden: true }] },
        ];
        const visibleOnly = getColumnGroups(columns, (leaf) => !leaf.hidden);
        expect(visibleOnly).toEqual([{ group: columns[0], startIndex: 0, endIndex: 1, depth: 0 }]);
    });
});

describe("resolveColSpan", () => {
    const getRowId = (_row: Row, index: number): number => index;
    const row: Row = { name: "Alice" };

    it("returns 1 when no colSpan is declared", () => {
        const column: ColumnDef<Row> = { id: "a", header: "A" };
        expect(resolveColSpan(row, 0, getRowId, column as ColumnLeafDef<Row>, 0, 3)).toBe(1);
    });

    it("uses static spans and clips them to the remaining columns", () => {
        const column: ColumnDef<Row> = { id: "a", header: "A", colSpan: 5 };
        expect(resolveColSpan(row, 0, getRowId, column as ColumnLeafDef<Row>, 0, 3)).toBe(3);
        expect(resolveColSpan(row, 0, getRowId, column as ColumnLeafDef<Row>, 2, 3)).toBe(1);
    });

    it("floors fractional spans and rejects non-finite values", () => {
        expect(resolveColSpan(row, 0, getRowId, { id: "a", colSpan: 2.9 } as ColumnLeafDef<Row>, 0, 4)).toBe(2);
        expect(resolveColSpan(row, 0, getRowId, { id: "a", colSpan: Number.NaN } as ColumnLeafDef<Row>, 0, 4)).toBe(1);
        expect(resolveColSpan(row, 0, getRowId, { id: "a", colSpan: 0 } as ColumnLeafDef<Row>, 0, 4)).toBe(1);
    });

    it("evaluates function spans with CellSpanningParams and survives resolver errors", () => {
        const seen: CellSpanningParams<Row>[] = [];
        const column: ColumnDef<Row> = {
            id: "a",
            colSpan: (params) => {
                seen.push(params);
                return params.data.name === "Alice" ? 2 : 1;
            },
        };
        expect(resolveColSpan(row, 4, getRowId, column as ColumnLeafDef<Row>, 0, 4)).toBe(2);
        expect(seen[0]).toMatchObject({ data: row, column, node: { id: 4, index: 4, data: row } });
        const throwing: ColumnDef<Row> = {
            id: "b",
            colSpan: () => {
                throw new Error("boom");
            },
        };
        expect(resolveColSpan(row, 0, getRowId, throwing as ColumnLeafDef<Row>, 0, 4)).toBe(1);
    });
});

describe("getRowSpans", () => {
    const getRowId = (_row: Row, index: number): number => index;

    it("returns the identity layout when no column declares colSpan (no resolver runs)", () => {
        const columns: ColumnLeafDef<Row>[] = [
            { id: "a", width: 100 },
            { id: "b", width: 120 },
        ];
        const offsets = [
            { offset: 0, size: 100 },
            { offset: 100, size: 120 },
        ];
        const layout = getRowSpans({ name: "r" }, 0, getRowId, columns, offsets);
        expect(layout.spans).toEqual([
            { span: 1, covered: false },
            { span: 1, covered: false },
        ]);
        expect(layout.widths).toEqual([100, 120]);
        expect(layout.offsets).toEqual([0, 100]);
    });

    it("merges consecutive columns: origin carries summed width, covered cells are skipped", () => {
        const columns: ColumnLeafDef<Row>[] = [
            { id: "a", width: 100, colSpan: 3 },
            { id: "b", width: 120 },
            { id: "c", width: 80 },
            { id: "d", width: 50 },
        ];
        const offsets = [
            { offset: 0, size: 100 },
            { offset: 100, size: 120 },
            { offset: 220, size: 80 },
            { offset: 300, size: 50 },
        ];
        const layout = getRowSpans({ name: "r" }, 0, getRowId, columns, offsets);
        expect(layout.spans[0]).toEqual({ span: 3, covered: false });
        expect(layout.widths[0]).toBe(300);
        expect(layout.offsets[0]).toBe(0);
        expect(layout.spans[1]).toEqual({ span: 1, covered: true });
        expect(layout.spans[2]).toEqual({ span: 1, covered: true });
        expect(layout.widths[1]).toBe(0);
        expect(layout.spans[3]).toEqual({ span: 1, covered: false });
        expect(layout.widths[3]).toBe(50);
    });

    it("evaluates per-row function spans independently", () => {
        const columns: ColumnLeafDef<Row>[] = [
            {
                id: "a",
                width: 100,
                colSpan: (params) => (params.data.name === "merge" ? 2 : 1),
            },
            { id: "b", width: 120 },
        ];
        const offsets = [
            { offset: 0, size: 100 },
            { offset: 100, size: 120 },
        ];
        const merged = getRowSpans({ name: "merge" }, 0, getRowId, columns, offsets);
        expect(merged.spans[0]).toEqual({ span: 2, covered: false });
        expect(merged.widths[0]).toBe(220);
        const plain = getRowSpans({ name: "solo" }, 1, getRowId, columns, offsets);
        expect(plain.spans[0]).toEqual({ span: 1, covered: false });
        expect(plain.widths[0]).toBe(100);
    });

    it("builds the documented CellSpanningParams shape", () => {
        const column: ColumnLeafDef<Row> = { id: "a", width: 100 };
        expect(getCellSpanningParams({ name: "r" }, 3, getRowId, column)).toMatchObject({
            data: { name: "r" },
            column,
            node: { id: 3, index: 3, data: { name: "r" } },
        });
    });
});