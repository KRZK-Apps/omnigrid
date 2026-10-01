import { flattenColumns, getColumnGroups, isColumnGroup, isColumnLeaf } from "./columns";
import type { ColumnDef } from "./types";

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