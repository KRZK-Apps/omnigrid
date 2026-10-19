import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Grid } from "@omnigrid/core";
import type { ColumnDef, GridState, UIInputControl, UISelectControl } from "@omnigrid/core";
import { FilteringPlugin } from "@omnigrid/filtering-plugin";

import { PopupHost } from "../popup";

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

const columns: ColumnDef<ItemRow>[] = [
    { id: "id", field: "id", header: "ID", width: 60 },
    { id: "name", field: "name", header: "Name", width: 120 },
    { id: "active", field: "active", header: "Active", width: 100 },
    { id: "createdAt", field: "createdAt", header: "Date", width: 120 },
    { id: "category", field: "category", header: "Category", width: 120 },
];

function control<T>(grid: Grid<T>, id: string): { value: unknown; onChange: (value: string) => void } {
    const popup = grid.getPopup();
    const found = popup?.controls.find((item) => item.id === id);
    return found as { value: unknown; onChange: (value: string) => void };
}

describe("FilteringPlugin React integration", () => {
    it("renders text filter popup controls via PopupHost", () => {
        const plugin = new FilteringPlugin<ItemRow>();
        const grid = new Grid<ItemRow>({ columns, data: sampleRows, plugins: [plugin] });

        plugin.openColumnFilter("name", { x: 1, y: 2 });

        const html: string = renderToStaticMarkup(createElement(PopupHost<ItemRow>, { grid }));

        expect(html).toContain("omnigrid-popup");
        expect(html).toContain('class="omnigrid-control-input" type="text"');
        expect(html).toContain('class="omnigrid-select-button"');

        const input = control(grid, "value") as UIInputControl;
        input.onChange("Al");
        expect(grid.getFilterModel().name.conditions[0]).toEqual({ operator: "contains", value: "Al" });
        expect(grid.getProcessedData()).toHaveLength(1);
    });

    it("renders number filter popup with range inputs", () => {
        const itemColumns: ColumnDef<ItemRow>[] = [{ id: "id", field: "id", header: "ID", width: 100 }];
        const plugin = new FilteringPlugin<ItemRow>();
        const grid = new Grid<ItemRow>({ columns: itemColumns, data: sampleRows, plugins: [plugin] });

        plugin.openColumnFilter("id");

        const html: string = renderToStaticMarkup(createElement(PopupHost<ItemRow>, { grid }));

        expect(html).toContain('type="number"');
        expect(html).toContain("omnigrid-popup");

        const opSelect = control(grid, "operator") as UISelectControl;
        opSelect.onChange("inRange");

        const html2: string = renderToStaticMarkup(createElement(PopupHost<ItemRow>, { grid }));
        expect(html2).toContain("From");
        expect(html2).toContain("To");
    });

    it("renders boolean filter popup with All/Yes/No", () => {
        const itemColumns: ColumnDef<ItemRow>[] = [{ id: "active", field: "active", header: "Active", width: 100 }];
        const plugin = new FilteringPlugin<ItemRow>();
        const grid = new Grid<ItemRow>({ columns: itemColumns, data: sampleRows, plugins: [plugin] });

        plugin.openColumnFilter("active");

        const html: string = renderToStaticMarkup(createElement(PopupHost<ItemRow>, { grid }));

        expect(html).toContain("omnigrid-popup");

        const boolSelect = control(grid, "boolean-select") as UISelectControl;
        boolSelect.onChange("true");
        expect(grid.getFilterModel().active.conditions[0]).toEqual({ operator: "equals", value: true });
        expect(grid.getProcessedData()).toHaveLength(2);
    });

    it("renders select filter popup with multi-select", () => {
        const itemColumns: ColumnDef<ItemRow>[] = [{ id: "category", field: "category", header: "Category", dataType: "select", width: 100 }];
        const plugin = new FilteringPlugin<ItemRow>();
        const grid = new Grid<ItemRow>({ columns: itemColumns, data: sampleRows, plugins: [plugin] });

        plugin.openColumnFilter("category");

        const html: string = renderToStaticMarkup(createElement(PopupHost<ItemRow>, { grid }));

        expect(html).toContain("omnigrid-popup");

        const multi = control(grid, "multi-select") as { value: unknown; onChange: (value: string[]) => void };
        multi.onChange(["Food"]);
        expect(grid.getFilterModel().category.conditions[0]).toEqual({ operator: "in", value: ["Food"] });
        expect(grid.getProcessedData()).toHaveLength(2);
    });

    it("closes popup when grid state changes", () => {
        const plugin = new FilteringPlugin<ItemRow>();
        const grid = new Grid<ItemRow>({ columns, data: sampleRows, plugins: [plugin] });

        plugin.openColumnFilter("name");
        expect(grid.getPopup()).not.toBeNull();

        grid.closePopup();
        expect(grid.getPopup()).toBeNull();

        const html: string = renderToStaticMarkup(createElement(PopupHost<ItemRow>, { grid }));
        expect(html).not.toContain("omnigrid-popup");
    });
});
