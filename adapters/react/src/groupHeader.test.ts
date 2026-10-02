import type { ColumnGroupDef, ColumnGroupViewport } from "@omnigrid/core";
import { describe, expect, it } from "vitest";

import { type VirtualColumn, computeGroupSegments } from "./groupHeader";

interface Row {
    id: string;
}

function groupView(id: string, startIndex: number, endIndex: number, depth: number): ColumnGroupViewport<Row> {
    const group: ColumnGroupDef<Row> = { id, header: id, children: [] };
    return { group, startIndex, endIndex, depth };
}

function col(id: string, index: number, offset: number, width: number): VirtualColumn<Row> {
    return { column: { id, header: id }, index, offset, width };
}

describe("computeGroupSegments", () => {
    it("emits one cell spanning the group's leaves within the pane", () => {
        const columns = [col("a", 0, 0, 100), col("b", 1, 100, 100), col("c", 2, 200, 100)];
        const segments = computeGroupSegments([groupView("g", 0, 3, 0)], columns, 0, 0);

        expect(segments).toEqual([{ group: { id: "g", header: "g", children: [] }, left: 0, width: 300, columnCount: 3 }]);
    });

    it("translates absolute table offsets into the pane's local space via originX", () => {
        const columns = [col("a", 0, 100, 100), col("b", 1, 200, 100)];
        const segments = computeGroupSegments([groupView("g", 0, 2, 0)], columns, 0, 100);

        expect(segments[0].left).toBe(0);
        expect(segments[0].width).toBe(200);
    });

    it("renders only the part of the group that overlaps the pane", () => {
        // Group spans visible leaves 0..4; the pane owns leaves 2..3.
        const columns = [col("c", 2, 200, 100), col("d", 3, 300, 100)];
        const segments = computeGroupSegments([groupView("g", 0, 4, 0)], columns, 0, 200);

        expect(segments).toEqual([{ group: groupView("g", 0, 4, 0).group, left: 0, width: 200, columnCount: 2 }]);
    });

    it("splits a group into separate cells when its leaves are not consecutive in the pane", () => {
        // Leaf b (index 1) lives in another pane — the group's leaves in this
        // pane (a and c) are NOT adjacent, so they must not be merged.
        const columns = [col("a", 0, 0, 100), col("c", 2, 200, 100)];
        const segments = computeGroupSegments([groupView("g", 0, 3, 0)], columns, 0, 0);

        expect(segments).toEqual([
            { group: groupView("g", 0, 3, 0).group, left: 0, width: 100, columnCount: 1 },
            { group: groupView("g", 0, 3, 0).group, left: 200, width: 100, columnCount: 1 },
        ]);
    });

    it("filters by the requested depth level", () => {
        const columns = [col("a", 0, 0, 100), col("b", 1, 100, 100)];
        const groups = [groupView("outer", 0, 2, 0), groupView("inner", 1, 2, 1)];

        expect(computeGroupSegments(groups, columns, 0, 0)).toHaveLength(1);
        expect(computeGroupSegments(groups, columns, 0, 0)[0].group.id).toBe("outer");
        expect(computeGroupSegments(groups, columns, 1, 0)[0].group.id).toBe("inner");
        expect(computeGroupSegments(groups, columns, 2, 0)).toEqual([]);
    });

    it("returns no cells for a group that does not overlap the pane", () => {
        const columns = [col("a", 0, 0, 100), col("b", 1, 100, 100)];
        expect(computeGroupSegments([groupView("g", 5, 7, 0)], columns, 0, 0)).toEqual([]);
        expect(computeGroupSegments([], columns, 0, 0)).toEqual([]);
    });
});
