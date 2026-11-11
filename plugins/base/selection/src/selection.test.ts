import type { CheckboxControl, ColumnDef, ColumnLeafDef, RowId } from "@omnigrid/core";
import { Grid } from "@omnigrid/core";
import { describe, expect, it, vi } from "vitest";

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
        expect(state[0].movable).toBe(false);
        expect(state[0].lockPosition).toBe("start");
        // The previously pinned-left column remains pinned after the checkbox.
        expect(state[1].pinned).toBe("left");
        expect(state[1].id).toBe("id");
        // Scrollable columns are unchanged.
        expect(state[2].pinned).toBeUndefined();
        expect(state[2].id).toBe("name");
    });

    it("pins the checkbox column to the left when there are no configured pinned-left columns", () => {
        const columns: ColumnDef<Row>[] = [
            { id: "name", field: "name", header: "Name", flex: 1 },
            { id: "age", field: "age", header: "Age", width: 100 },
        ];
        const plugin = new SelectionPlugin<Row>({ mode: "multiple", showRowCheckboxes: true, showHeaderCheckbox: true });
        const grid = new Grid<Row>({ columns, data: ROWS, plugins: [plugin] });

        const state = grid.getState().columns;
        expect(state[0].id).toBe("__omnigrid_selection__");
        expect(state[0].pinned).toBe("left");
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
        expect(plugin.getRowClass({ id: "a", index: 0, rowType: "leaf", data: ROWS[0] })).toBe("omnigrid-row-selected");
        expect(plugin.getRowClass({ id: "b", index: 1, rowType: "leaf", data: ROWS[1] })).toBeUndefined();

        plugin.toggleRow("a", 0, {});
        expect(plugin.getRowClass({ id: "a", index: 0, rowType: "leaf", data: ROWS[0] })).toBeUndefined();
    });

    it("does not set inline colors — the theme owns the selected-row color", () => {
        const plugin = new SelectionPlugin<Row>({ mode: "single" });
        expect((plugin as any).getRowStyle).toBeUndefined();
    });

    it("marks rows rejected by isRowSelectable with the unselectable-row class", () => {
        const plugin: SelectionPlugin<Row> = new SelectionPlugin<Row>({
            isRowSelectable: (row) => row.age >= 30,
        });

        expect(plugin.getRowClass({ id: "a", index: 0, rowType: "leaf", data: ROWS[0] })).toBeUndefined();
        expect(plugin.getRowClass({ id: "b", index: 1, rowType: "leaf", data: ROWS[1] })).toBe("omnigrid-row-unselectable");
    });

    it("keeps the unselectable class when a row is also selected programmatically", () => {
        const plugin: SelectionPlugin<Row> = new SelectionPlugin<Row>({
            isRowSelectable: (row) => row.age >= 30,
        });
        plugin.setSelectedRowIds(["b"]);

        expect(plugin.getRowClass({ id: "b", index: 1, rowType: "leaf", data: ROWS[1] })).toBe(
            "omnigrid-row-selected omnigrid-row-unselectable",
        );
    });

    it("notifies listeners with the current selected rows whenever selection changes", () => {
        const onSelectionChange = vi.fn();
        const plugin = new SelectionPlugin<Row>({ mode: "multiple", onSelectionChange });
        const grid: Grid<Row> = new Grid<Row>({
            columns: [],
            data: ROWS,
            getRowId: (row) => row.id,
            plugins: [plugin],
        });

        plugin.toggleRow("b", 1);

        expect(onSelectionChange).toHaveBeenCalledWith({
            selectedRowIds: ["b"],
            selectedRows: [ROWS[1]],
        });
        grid.destroy();
    });

    it("keeps selected row identity when processed data is reordered", () => {
        const plugin = new SelectionPlugin<Row>({ mode: "multiple" });
        const grid: Grid<Row> = new Grid<Row>({ columns: [], data: ROWS, getRowId: (row) => row.id, plugins: [plugin] });
        let sortByAgeAscending: boolean = false;

        grid.registerDataProcessor((data) => {
            if (!sortByAgeAscending) return data;
            return [...data].sort((left, right) => left.age - right.age);
        });
        plugin.toggleRow("a", 0);

        sortByAgeAscending = true;
        grid.setData(ROWS);

        expect(grid.getProcessedData().map((row) => row.id)).toEqual(["b", "a"]);
        expect(plugin.getSelectionState()).toEqual({
            selectedRowIds: ["a"],
            selectedRows: [ROWS[0]],
        });

        grid.destroy();
    });
});

describe("SelectionPlugin removal", () => {
    it("removes the checkbox column and clears selection when the plugin is dropped from the grid", () => {
        const columns: ColumnDef<Row>[] = [{ id: "name", field: "name", header: "Name", flex: 1 }];
        const plugin = new SelectionPlugin<Row>({ mode: "multiple", showRowCheckboxes: true });
        const grid = new Grid<Row>({ columns, data: ROWS, plugins: [plugin] });
        expect(grid.getState().columns[0].id).toBe("__omnigrid_selection__");

        grid.setPlugins([]);
        expect(grid.getState().columns.map((c) => c.id)).toEqual(["name"]);
        expect(plugin.getSelectedRowIds()).toEqual([]);
    });
});

describe("SelectionPlugin group selection", () => {
    function getSelectionColumn(grid: Grid<Row>): ColumnLeafDef<Row> | undefined {
        const viewport = grid.getViewportData();
        return (
            viewport.pinnedLeftLeafColumns.find((candidate) => candidate.id === "__omnigrid_selection__") ??
            viewport.leafColumns.find((candidate) => candidate.id === "__omnigrid_selection__")
        );
    }

    function renderCheckbox(
        grid: Grid<Row>,
        rowId: RowId,
        index: number,
        data: Row,
    ): CheckboxControl & { group?: boolean } {
        const column: ColumnLeafDef<Row> | undefined = getSelectionColumn(grid);
        if (!column?.cellRenderer) throw new Error("Selection checkbox renderer was not registered");
        const rendered: unknown = column.cellRenderer({ id: rowId, index, data, column });
        if (typeof rendered !== "object" || rendered === null || !("type" in rendered)) {
            throw new Error("Selection checkbox renderer did not return a checkbox control");
        }
        return rendered as CheckboxControl & { group?: boolean };
    }

    function registerGroupHierarchy(grid: Grid<Row>): void {
        grid.registerRowHierarchy({
            getLeafRowIds: (rowId, scope) => {
                if (rowId !== "group") return undefined;
                return scope === "all" ? ["a", "b"] : ["a"];
            },
        });
    }

    it("renders unchecked, indeterminate, and checked group states and toggles descendants", () => {
        const plugin: SelectionPlugin<Row> = new SelectionPlugin<Row>({ mode: "multiple", groupSelection: "descendants", showRowCheckboxes: true });
        const grid: Grid<Row> = new Grid<Row>({
            columns: [],
            data: ROWS,
            quickFilter: "Ada",
            getRowId: (row) => row.id,
            plugins: [plugin],
        });
        registerGroupHierarchy(grid);

        expect(renderCheckbox(grid, "group", 0, ROWS[0])).toMatchObject({ checked: false, indeterminate: false, group: true });

        plugin.setSelectedRowIds(["a"]);
        expect(renderCheckbox(grid, "group", 0, ROWS[0])).toMatchObject({ checked: false, indeterminate: true, group: true });

        renderCheckbox(grid, "group", 0, ROWS[0]).onChange({ shiftKey: false, ctrlKey: false });
        expect(plugin.getSelectedRowIds()).toEqual(["a", "b"]);
        expect(plugin.getSelectionState().selectedRows).toEqual(ROWS);
        expect(renderCheckbox(grid, "group", 0, ROWS[0])).toMatchObject({ checked: true, indeterminate: false });

        renderCheckbox(grid, "group", 0, ROWS[0]).onChange({ shiftKey: false, ctrlKey: false });
        expect(plugin.getSelectedRowIds()).toEqual([]);
        grid.destroy();
    });

    it("limits filteredDescendants to the filtered hierarchy scope", () => {
        const plugin: SelectionPlugin<Row> = new SelectionPlugin<Row>({
            mode: "multiple",
            groupSelection: "filteredDescendants",
            showRowCheckboxes: true,
        });
        const grid: Grid<Row> = new Grid<Row>({
            columns: [{ id: "name", field: "name", header: "Name" }],
            data: ROWS,
            quickFilter: "Ada",
            getRowId: (row) => row.id,
            plugins: [plugin],
        });
        registerGroupHierarchy(grid);

        renderCheckbox(grid, "group", 0, ROWS[0]).onChange({ shiftKey: false, ctrlKey: false });
        expect(plugin.getSelectedRowIds()).toEqual(["a"]);
        expect(plugin.getSelectionState().selectedRows).toEqual([ROWS[0]]);
        grid.destroy();
    });

    it("keeps header selection IDs stable against filtering when a hierarchy is active", () => {
        const plugin: SelectionPlugin<Row> = new SelectionPlugin<Row>({
            mode: "multiple",
            groupSelection: "descendants",
            showHeaderCheckbox: true,
        });
        const grid: Grid<Row> = new Grid<Row>({
            columns: [{ id: "name", field: "name", header: "Name" }],
            data: ROWS,
            quickFilter: "Ada",
            plugins: [plugin],
        });
        grid.registerRowHierarchy({ getLeafRowIds: () => undefined });
        const selectionColumn: ColumnLeafDef<Row> | undefined = getSelectionColumn(grid);
        const header: CheckboxControl | undefined = selectionColumn?.headerRenderer?.() as CheckboxControl | undefined;

        header?.onChange({ shiftKey: false, ctrlKey: false });

        expect(plugin.getSelectedRowIds()).toEqual([0]);
        expect(plugin.getSelectionState().selectedRows).toEqual([ROWS[0]]);
        grid.destroy();
    });

    it("applies isRowSelectable to group descendants", () => {
        const plugin: SelectionPlugin<Row> = new SelectionPlugin<Row>({
            mode: "multiple",
            groupSelection: "descendants",
            showRowCheckboxes: true,
            isRowSelectable: (row) => row.age >= 30,
        });
        const grid: Grid<Row> = new Grid<Row>({ columns: [], data: ROWS, getRowId: (row) => row.id, plugins: [plugin] });
        registerGroupHierarchy(grid);
        plugin.setSelectedRowIds(["b"]);

        expect(renderCheckbox(grid, "group", 0, ROWS[0])).toMatchObject({ checked: false, disabled: false });
        renderCheckbox(grid, "group", 0, ROWS[0]).onChange({ shiftKey: false, ctrlKey: false });

        expect(plugin.getSelectedRowIds()).toEqual(["b", "a"]);
        expect(renderCheckbox(grid, "group", 0, ROWS[0])).toMatchObject({ checked: true, disabled: false });
        grid.destroy();
    });

    it("does not render a group checkbox by default", () => {
        const plugin: SelectionPlugin<Row> = new SelectionPlugin<Row>({ mode: "multiple", showRowCheckboxes: true });
        const grid: Grid<Row> = new Grid<Row>({ columns: [], data: ROWS, getRowId: (row) => row.id, plugins: [plugin] });
        registerGroupHierarchy(grid);
        const column: ColumnLeafDef<Row> | undefined = getSelectionColumn(grid);

        expect(column?.cellRenderer?.({ id: "group", index: 0, data: ROWS[0], column: column! })).toBe("");
        grid.destroy();
    });
});
