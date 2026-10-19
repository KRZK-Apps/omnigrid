import { Grid } from "@omnigrid/core";
import type { ColumnDef, UIControlDescriptor, UIInputControl, UIMultiSelectControl, UISelectControl } from "@omnigrid/core";
import { FilteringPlugin, inferColumnDataType } from "./index";
import {describe, it, expect} from "vitest";

interface ItemRow {
    id: number;
    name: string;
    active: boolean;
    createdAt: string;
    category: string;
}

const sampleRows: ItemRow[] = [
    { id: 1, name: "Alpha", active: true, createdAt: "2026-01-15", category: "Food" },
    { id: 2, name: "Beta", active: false, createdAt: "2026-02-20", category: "Tech" },
    { id: 3, name: "Gamma", active: true, createdAt: "2026-03-25", category: "Food" },
];

describe("inferColumnDataType", () => {
    it("detects number, boolean, date, select and text correctly", () => {
        expect(inferColumnDataType<ItemRow>({ id: "id", field: "id", header: "ID" }, sampleRows)).toBe("number");
        expect(inferColumnDataType<ItemRow>({ id: "active", field: "active", header: "Active" }, sampleRows)).toBe("boolean");
        expect(inferColumnDataType<ItemRow>({ id: "createdAt", field: "createdAt", header: "Date" }, sampleRows)).toBe("date");
        expect(inferColumnDataType<ItemRow>({ id: "name", field: "name", header: "Name" }, sampleRows)).toBe("text");
        expect(
            inferColumnDataType<ItemRow>(
                { id: "cat", field: "category", header: "Category", filterOptions: [{ value: "Food", label: "Food" }] },
                sampleRows,
            ),
        ).toBe("select");
        expect(
            inferColumnDataType<ItemRow>({ id: "id", field: "id", header: "ID", dataType: "text" }, sampleRows),
        ).toBe("text");
    });
});

interface Row {
    name: string;
}

const columns: ColumnDef<Row>[] = [{ id: "name", field: "name", header: "Name", width: 100 }];
const rows: Row[] = [{ name: "Alice" }, { name: "Bob" }];

function control(grid: Grid<any>, id: string): UIControlDescriptor {
    return grid.getPopup()!.controls.find((item) => item.id === id)!;
}

describe("FilteringPlugin", () => {
    it("opens a popup whose controls drive the core filter model", () => {
        const plugin = new FilteringPlugin<Row>();
        const grid = new Grid<Row>({ columns, data: rows, plugins: [plugin] });
        plugin.openColumnFilter("name", { x: 1, y: 2 });
        expect(grid.getPopup()?.title).toBeUndefined();

        (control(grid, "value") as UIInputControl).onChange("bo");
        expect(grid.getFilterModel()).toEqual({ name: { conditions: [{ operator: "contains", value: "bo" }] } });
        expect(grid.getProcessedData()).toEqual([{ name: "Bob" }]);
        expect((control(grid, "value") as UIInputControl).value).toBe("bo");

        (control(grid, "operator") as UISelectControl).onChange("startsWith");
        expect(grid.getFilterModel().name.conditions[0].operator).toBe("startsWith");

        (control(grid, "value") as UIInputControl).onChange("");
        expect(grid.getFilterModel()).toEqual({});
    });

    it("keeps an operator chosen before any value is typed", () => {
        const plugin = new FilteringPlugin<Row>();
        const grid = new Grid<Row>({ columns, data: rows, plugins: [plugin] });
        plugin.openColumnFilter("name");
        (control(grid, "operator") as UISelectControl).onChange("equals");
        expect(grid.getFilterModel()).toEqual({});
        expect((control(grid, "operator") as UISelectControl).value).toBe("equals");
    });

    it("closes its popup on unregister", () => {
        const plugin = new FilteringPlugin<Row>();
        const grid = new Grid<Row>({ columns, data: rows });
        const unregister = grid.registerPlugin(plugin);
        plugin.openColumnFilter("name");
        unregister();
        expect(grid.getPopup()).toBeNull();
    });

    it("handles number column with range", () => {
        const itemColumns: ColumnDef<ItemRow>[] = [{ id: "id", field: "id", header: "ID", width: 100 }];
        const plugin = new FilteringPlugin<ItemRow>();
        const grid = new Grid<ItemRow>({ columns: itemColumns, data: sampleRows, plugins: [plugin] });

        plugin.openColumnFilter("id");
        expect(grid.getPopup()?.controls.length).toBeGreaterThan(0);

        const opSelect = control(grid, "operator") as UISelectControl;
        expect(opSelect.value).toBe("equals");

        opSelect.onChange("inRange");
        const fromInput = control(grid, "value") as UIInputControl;
        const toInput = control(grid, "valueTo") as UIInputControl;
        expect(fromInput.type).toBe("number");
        expect(toInput.type).toBe("number");

        fromInput.onChange("1");
        toInput.onChange("2");
        expect(grid.getProcessedData()).toHaveLength(2);
    });

    it("handles boolean column with All/Yes/No", () => {
        const itemColumns: ColumnDef<ItemRow>[] = [{ id: "active", field: "active", header: "Active", width: 100 }];
        const plugin = new FilteringPlugin<ItemRow>();
        const grid = new Grid<ItemRow>({ columns: itemColumns, data: sampleRows, plugins: [plugin] });

        plugin.openColumnFilter("active");
        const boolSelect = control(grid, "boolean-select") as UISelectControl;
        expect(boolSelect.value).toBe("all");

        boolSelect.onChange("true");
        expect(grid.getFilterModel().active.conditions[0]).toEqual({ operator: "equals", value: true });
        expect(grid.getProcessedData()).toHaveLength(2);

        boolSelect.onChange("all");
        expect(grid.getFilterModel().active).toBeUndefined();
        expect(grid.getProcessedData()).toHaveLength(3);
    });

    it("handles select/set column with multi-select", () => {
        const itemColumns: ColumnDef<ItemRow>[] = [
            { id: "category", field: "category", header: "Category", dataType: "select", width: 100 },
        ];
        const plugin = new FilteringPlugin<ItemRow>();
        const grid = new Grid<ItemRow>({ columns: itemColumns, data: sampleRows, plugins: [plugin] });

        plugin.openColumnFilter("category");
        const multi = control(grid, "multi-select") as UIMultiSelectControl;
        expect(multi.options.length).toBe(2);

        multi.onChange(["Food"]);
        expect(grid.getFilterModel().category.conditions[0]).toEqual({ operator: "in", value: ["Food"] });
        expect(grid.getProcessedData()).toHaveLength(2);
    });
});

