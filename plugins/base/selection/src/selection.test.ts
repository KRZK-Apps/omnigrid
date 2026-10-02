import type { ColumnDef } from "@omnigrid/core";
import { Grid } from "@omnigrid/core";
import { describe, expect, it } from "vitest";

import { SelectionPlugin } from "./index";

interface Row {
    id: string;
    name: string;
    age: number;
}

const ROWS: Row[] = [
    { id: "a", name: "Ada", age: 36 },
    { id: "b", name: "Bo", age: 28 },
];

describe("SelectionPlugin column pinning", () => {
    it("inserts the checkbox column as the first pinned-left column when the table has pinned-left columns", () => {
        const columns: ColumnDef<Row>[] = [
            { id: "id", field: "id", header: "ID", width: 100, pinned: "left" },
            { id: "name", field: "name", header: "Name", flex: 1 },
        ];
        const plugin = new SelectionPlugin<Row>({ mode: "multiple", showRowCheckboxes: true, showHeaderCheckbox: true });
        const grid = new Grid<Row>({ columns, data: ROWS, plugins: [plugin] });

        const state = grid.getState().columns;
        // Checkbox column is the very first column and is pinned to the left.
        expect(state[0].id).toBe("__omnigrid_selection__");
        expect(state[0].pinned).toBe("left");
        // The previously pinned-left column remains pinned after the checkbox.
        expect(state[1].pinned).toBe("left");
        expect(state[1].id).toBe("id");
        // Scrollable columns are unchanged.
        expect(state[2].pinned).toBeUndefined();
        expect(state[2].id).toBe("name");
    });

    it("leaves the checkbox column as the first scrollable column when there are no pinned-left columns", () => {
        const columns: ColumnDef<Row>[] = [
            { id: "name", field: "name", header: "Name", flex: 1 },
            { id: "age", field: "age", header: "Age", width: 100 },
        ];
        const plugin = new SelectionPlugin<Row>({ mode: "multiple", showRowCheckboxes: true, showHeaderCheckbox: true });
        const grid = new Grid<Row>({ columns, data: ROWS, plugins: [plugin] });

        const state = grid.getState().columns;
        expect(state[0].id).toBe("__omnigrid_selection__");
        expect(state[0].pinned).toBeUndefined();
        expect(state.map((c) => c.id)).toEqual(["__omnigrid_selection__", "name", "age"]);
    });

    it("does not inject a checkbox column when checkboxes are disabled", () => {
        const columns: ColumnDef<Row>[] = [
            { id: "id", field: "id", header: "ID", width: 100, pinned: "left" },
            { id: "name", field: "name", header: "Name", flex: 1 },
        ];
        const plugin = new SelectionPlugin<Row>({ mode: "multiple" });
        const grid = new Grid<Row>({ columns, data: ROWS, plugins: [plugin] });

        const state = grid.getState().columns;
        expect(state.find((c) => c.id === "__omnigrid_selection__")).toBeUndefined();
        expect(state).toHaveLength(columns.length);
    });
});

describe("SelectionPlugin row presentation", () => {
    it("marks selected rows with the selected-row class and clears it after deselection", () => {
        const columns: ColumnDef<Row>[] = [
            { id: "name", field: "name", header: "Name", flex: 1 },
            { id: "age", field: "age", header: "Age", width: 100 },
        ];
        const plugin = new SelectionPlugin<Row>({ mode: "multiple" });
        const grid = new Grid<Row>({ columns, data: ROWS, plugins: [plugin] });

        plugin.setSelectedRowIds(["a"]);
        expect(plugin.getRowClass({ id: "a", index: 0, data: ROWS[0] })).toBe("omnigrid-row-selected");
        expect(plugin.getRowClass({ id: "b", index: 1, data: ROWS[1] })).toBeUndefined();

        plugin.toggleRow("a", 0, {});
        expect(plugin.getRowClass({ id: "a", index: 0, data: ROWS[0] })).toBeUndefined();
    });

    it("does not set inline colors — the theme owns the selected-row color", () => {
        const plugin = new SelectionPlugin<Row>({ mode: "single" });
        expect((plugin as any).getRowStyle).toBeUndefined();
    });
});
