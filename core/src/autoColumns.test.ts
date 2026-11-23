import { describe, expect, it } from "vitest";

import { Grid } from "./grid.js";

interface Row {
    id: string;
    name?: string;
    location?: string;
    salaryGold?: number;
}

describe("automatic columns", () => {
    it("uses the field key as the default header", () => {
        const grid: Grid<Row> = new Grid<Row>({ data: [{ id: "1", name: "Ada" }] });

        expect(grid.getState().columns.map((column) => column.header)).toEqual(["id", "name"]);
    });

    it("infers columns from the first row and formats headers in the core", () => {
        const grid: Grid<Row> = new Grid<Row>({
            data: [{ id: "1", name: "Ada" }, { id: "2", location: "London" }],
            getColumnHeader: (field) => field.toUpperCase(),
        });

        expect(grid.getState().columns).toEqual([
            { id: "id", field: "id", header: "ID" },
            { id: "name", field: "name", header: "NAME" },
        ]);
    });

    it("formats inferred headers with the built-in title-case mode", () => {
        const grid: Grid<Row> = new Grid<Row>({
            data: [{ id: "1", name: "Ada", location: "New York", salaryGold: 1500 }],
            autoColumnHeaderMode: "title-case",
        });

        expect(grid.getState().columns.map((column) => column.header)).toEqual(["Id", "Name", "Location", "Salary Gold"]);
    });

    it("applies the selected formatting mode when the first row arrives later", () => {
        const grid: Grid<Row> = new Grid<Row>({ data: [], autoColumnHeaderMode: "title-case" });

        grid.setData([{ id: "1", salaryGold: 1500 }]);

        expect(grid.getState().columns.map((column) => column.header)).toEqual(["Id", "Salary Gold"]);
    });

    it("uses a custom header formatter when both formatting options are provided", () => {
        const grid: Grid<Row> = new Grid<Row>({
            data: [{ id: "1", name: "Ada" }],
            autoColumnHeaderMode: "title-case",
            getColumnHeader: (field) => field.toUpperCase(),
        });

        expect(grid.getState().columns.map((column) => column.header)).toEqual(["ID", "NAME"]);
    });

    it("waits for the first non-empty dataset and keeps that schema afterward", () => {
        const grid: Grid<Row> = new Grid<Row>({ data: null });
        expect(grid.getState().columns).toEqual([]);

        grid.setData([{ id: "1", name: "Ada" }]);
        expect(grid.getState().columns.map((column) => column.id)).toEqual(["id", "name"]);

        grid.setData([{ id: "2", location: "London" }]);
        expect(grid.getState().columns.map((column) => column.id)).toEqual(["id", "name"]);
    });

    it("keeps explicitly supplied empty columns instead of inferring", () => {
        const grid: Grid<Row> = new Grid<Row>({
            columns: [],
            data: [{ id: "1", name: "Ada" }],
        });

        expect(grid.getState().columns).toEqual([]);
    });

    it("infers columns after appendData and preserves columns added while data was pending", () => {
        const grid: Grid<Row> = new Grid<Row>({ data: [] });
        grid.setColumns([{ id: "selection", header: "Select" }]);

        grid.appendData([{ id: "1", name: "Ada" }]);

        expect(grid.getState().columns.map((column) => column.id)).toEqual(["selection", "id", "name"]);
    });
});
