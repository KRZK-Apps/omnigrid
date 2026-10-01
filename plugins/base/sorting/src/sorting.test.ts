import type { ColumnDef } from "@omnigrid/core";
import { Grid } from "@omnigrid/core";

import { SortingPlugin } from "./index";

interface Row {
    id: string;
    value: number;
    label: string;
}

const RAW: Row[] = [
    { id: "a", value: 2, label: "z" },
    { id: "b", value: 1, label: "a" },
    { id: "c", value: 1, label: "b" },
];

const COLUMNS: ColumnDef<Row>[] = [
    { id: "value", field: "value", header: "Value", width: 100 },
    { id: "label", field: "label", header: "Label", width: 140 },
    { id: "unsortable", field: "label", header: "Unsortable", width: 140, sortable: false },
];

describe("SortingPlugin column toggling", () => {
    it("cycles asc -> desc -> none on repeated header clicks", () => {
        const plugin = new SortingPlugin<Row>();
        const grid = new Grid<Row>({ columns: COLUMNS, data: RAW, plugins: [plugin] });

        grid.headerClick("value");
        expect(plugin.getSortModel()).toEqual([{ columnId: "value", direction: "asc" }]);
        expect(grid.getProcessedData().map((r) => r.value)).toEqual([1, 1, 2]);

        grid.headerClick("value");
        expect(plugin.getSortModel()).toEqual([{ columnId: "value", direction: "desc" }]);
        expect(grid.getProcessedData().map((r) => r.value)).toEqual([2, 1, 1]);

        grid.headerClick("value");
        expect(plugin.getSortModel()).toEqual([]);
    });

    it("accumulates multiple sort columns when multiSort is requested", () => {
        const plugin = new SortingPlugin<Row>();
        const grid = new Grid<Row>({ columns: COLUMNS, data: RAW, plugins: [plugin] });

        grid.headerClick("value", true);
        grid.headerClick("label", true);

        expect(plugin.getSortModel()).toEqual([
            { columnId: "value", direction: "asc" },
            { columnId: "label", direction: "asc" },
        ]);
        // value asc (1,1,2), then label asc (a,b) within the value=1 tie.
        expect(grid.getProcessedData().map((r) => r.id)).toEqual(["b", "c", "a"]);
    });

    it("ignores clicks on columns marked sortable: false", () => {
        const plugin = new SortingPlugin<Row>();
        const grid = new Grid<Row>({ columns: COLUMNS, data: RAW, plugins: [plugin] });

        grid.headerClick("unsortable");
        expect(plugin.getSortModel()).toEqual([]);
        expect(grid.getState().columns.find((c) => c.id === "unsortable")?.sortable).toBe(false);
    });
});

describe("SortingPlugin initial sort state", () => {
    it("honours `sortState` declared on a column at register time", () => {
        const columns: ColumnDef<Row>[] = [
            { id: "value", field: "value", header: "Value", width: 100 },
            { id: "label", field: "label", header: "Label", width: 140, sortState: "desc" },
        ];
        const plugin = new SortingPlugin<Row>();
        const grid = new Grid<Row>({ columns, data: RAW, plugins: [plugin] });

        expect(plugin.getSortModel()).toEqual([{ columnId: "label", direction: "desc" }]);
        expect(grid.getProcessedData().map((r) => r.label)).toEqual(["z", "b", "a"]);
    });
});
