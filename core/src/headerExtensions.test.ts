import { describe, expect, it, vi } from "vitest";

import { Grid } from "./grid";
import type { ColumnHeaderExtension, ColumnLeafDef } from "./types";

interface Row {
    id: string;
}

describe("Grid column header extensions", () => {
    it("renders registered extensions by position and priority and notifies subscribers", () => {
        const grid: Grid<Row> = new Grid<Row>({
            columns: [{ id: "id", header: "ID" }],
            data: [{ id: "row-1" }],
        });
        const start: ColumnHeaderExtension<Row> = {
            id: "start",
            position: "start",
            priority: 2,
            render: ({ column }) => column.id,
        };
        const earlyEnd: ColumnHeaderExtension<Row> = {
            id: "early-end",
            position: "end",
            priority: -1,
            render: ({ column }) => column.id,
        };
        const lateEnd: ColumnHeaderExtension<Row> = {
            id: "late-end",
            position: "end",
            render: ({ column }) => column.id,
        };
        const listener: ReturnType<typeof vi.fn> = vi.fn();

        grid.subscribe(listener);
        const unregisterStart: () => void = grid.registerHeaderExtension(start);
        grid.registerHeaderExtension(lateEnd);
        grid.registerHeaderExtension(earlyEnd);

        expect(grid.getHeaderExtensions("start")).toEqual([start]);
        expect(grid.getHeaderExtensions("end")).toEqual([earlyEnd, lateEnd]);
        expect(grid.getHeaderExtensions("overlay")).toEqual([]);
        expect(listener).toHaveBeenCalledTimes(3);

        const column: ColumnLeafDef<Row> = { id: "id", header: "ID" };
        expect(grid.getHeaderExtensions("end")[0].render({ column, index: 0 })).toBe("id");

        unregisterStart();
        expect(grid.getHeaderExtensions("start")).toEqual([]);
        expect(listener).toHaveBeenCalledTimes(4);
        grid.destroy();
    });

    it("does not let stale cleanup remove a replacement with the same id", () => {
        const grid: Grid<Row> = new Grid<Row>({ columns: [], data: [] });
        const original: ColumnHeaderExtension<Row> = {
            id: "shared",
            render: () => "original",
        };
        const replacement: ColumnHeaderExtension<Row> = {
            id: "shared",
            render: () => "replacement",
        };

        const unregisterOriginal: () => void = grid.registerHeaderExtension(original);
        grid.registerHeaderExtension(replacement);
        unregisterOriginal();

        expect(grid.getHeaderExtensions()).toHaveLength(1);
        expect(grid.getHeaderExtensions()[0].render({ column: { id: "id", header: "ID" } })).toBe("replacement");
        grid.destroy();
    });
});
