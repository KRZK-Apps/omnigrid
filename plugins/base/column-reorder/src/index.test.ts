import { Grid } from "@omnigrid/core";
import type { ColumnDef } from "@omnigrid/core";
import { describe, expect, it, vi } from "vitest";

import { ColumnReorderPlugin } from "./index";

interface Row {
    value: string;
}

function getLeafIds(columns: ColumnDef<Row>[]): string[] {
    const ids: string[] = [];
    for (const column of columns) {
        if ("children" in column) {
            ids.push(...getLeafIds(column.children));
        } else {
            ids.push(column.id);
        }
    }
    return ids;
}

describe("ColumnReorderPlugin", () => {
    it("reorders movable columns before or after a target column", () => {
        const columns: ColumnDef<Row>[] = [
            { id: "first", header: "First", movable: true },
            { id: "second", header: "Second", movable: true },
            { id: "third", header: "Third", movable: true },
        ];
        const plugin: ColumnReorderPlugin<Row> = new ColumnReorderPlugin<Row>();
        const grid: Grid<Row> = new Grid<Row>({ columns, plugins: [plugin] });

        grid.emit("columnDrop", { sourceColumnId: "first", targetColumnId: "third", position: "after" });
        expect(getLeafIds(grid.getState().columns)).toEqual(["second", "third", "first"]);

        grid.emit("columnDrop", { sourceColumnId: "first", targetColumnId: "second", position: "before" });
        expect(getLeafIds(grid.getState().columns)).toEqual(["first", "second", "third"]);

        grid.destroy();
    });

    it("moves columns between groups and removes groups left empty", () => {
        const columns: ColumnDef<Row>[] = [
            {
                id: "left",
                header: "Left",
                children: [{ id: "first", header: "First", movable: true }],
            },
            {
                id: "right",
                header: "Right",
                children: [{ id: "second", header: "Second" }],
            },
        ];
        const plugin: ColumnReorderPlugin<Row> = new ColumnReorderPlugin<Row>();
        const grid: Grid<Row> = new Grid<Row>({ columns, plugins: [plugin] });

        grid.emit("columnDrop", { sourceColumnId: "first", targetColumnId: "second", position: "before" });

        expect(grid.getState().columns).toEqual([
            {
                id: "right",
                header: "Right",
                children: [
                    { id: "first", header: "First", movable: true },
                    { id: "second", header: "Second" },
                ],
            },
        ]);
        grid.destroy();
    });

    it("reorders movable groups without changing their children", () => {
        const columns: ColumnDef<Row>[] = [
            {
                id: "first-group",
                header: "First group",
                movable: true,
                children: [{ id: "first", header: "First" }],
            },
            {
                id: "second-group",
                header: "Second group",
                movable: true,
                children: [{ id: "second", header: "Second" }],
            },
        ];
        const plugin: ColumnReorderPlugin<Row> = new ColumnReorderPlugin<Row>();
        const grid: Grid<Row> = new Grid<Row>({ columns, plugins: [plugin] });

        grid.emit("columnDrop", {
            sourceColumnId: "first-group",
            targetColumnId: "second-group",
            position: "after",
        });

        expect(grid.getState().columns).toEqual([
            {
                id: "second-group",
                header: "Second group",
                movable: true,
                children: [{ id: "second", header: "Second" }],
            },
            {
                id: "first-group",
                header: "First group",
                movable: true,
                children: [{ id: "first", header: "First" }],
            },
        ]);
        grid.destroy();
    });

    it("does not move a group into one of its descendants", () => {
        const columns: ColumnDef<Row>[] = [
            {
                id: "group",
                header: "Group",
                movable: true,
                children: [{ id: "child", header: "Child" }],
            },
        ];
        const plugin: ColumnReorderPlugin<Row> = new ColumnReorderPlugin<Row>();
        const grid: Grid<Row> = new Grid<Row>({ columns, plugins: [plugin] });
        const revision: number = grid.getRevision();

        expect(plugin.moveColumn("group", "child", "after")).toBe(false);
        expect(grid.getState().columns).toEqual(columns);
        expect(grid.getRevision()).toBe(revision);
        grid.destroy();
    });

    it("drops after the trailing group instead of nesting into it", () => {
        const columns: ColumnDef<Row>[] = [
            { id: "source", header: "Source", movable: true },
            {
                id: "trailing-group",
                header: "Trailing group",
                children: [
                    { id: "first", header: "First" },
                    { id: "last", header: "Last" },
                ],
            },
        ];
        const plugin: ColumnReorderPlugin<Row> = new ColumnReorderPlugin<Row>();
        const grid: Grid<Row> = new Grid<Row>({ columns, plugins: [plugin] });

        grid.emit("columnDrop", { sourceColumnId: "source", targetColumnId: "last", position: "after" });

        expect(grid.getState().columns).toEqual([
            {
                id: "trailing-group",
                header: "Trailing group",
                children: [
                    { id: "first", header: "First" },
                    { id: "last", header: "Last" },
                ],
            },
            { id: "source", header: "Source", movable: true },
        ]);
        grid.destroy();
    });

    it("does not move columns that are not marked movable or cross pinned regions", () => {
        const columns: ColumnDef<Row>[] = [
            { id: "locked", header: "Locked" },
            { id: "pinned", header: "Pinned", movable: true, pinned: "left" },
            { id: "regular", header: "Regular", movable: true },
        ];
        const plugin: ColumnReorderPlugin<Row> = new ColumnReorderPlugin<Row>();
        const grid: Grid<Row> = new Grid<Row>({ columns, plugins: [plugin] });

        expect(plugin.moveColumn("locked", "regular", "after")).toBe(false);
        expect(plugin.moveColumn("pinned", "regular", "after")).toBe(false);
        expect(getLeafIds(grid.getState().columns)).toEqual(["locked", "pinned", "regular"]);

        grid.destroy();
    });

    it("keeps locked start columns before movable pinned columns and groups", () => {
        const columns: ColumnDef<Row>[] = [
            { id: "selection", header: "", pinned: "left", movable: false, lockPosition: "start" },
            { id: "pinned", header: "Pinned", movable: true, pinned: "left" },
            {
                id: "group",
                header: "Group",
                movable: true,
                children: [{ id: "group-child", header: "Group child" }],
            },
        ];
        const onChange: ReturnType<typeof vi.fn> = vi.fn();
        const plugin: ColumnReorderPlugin<Row> = new ColumnReorderPlugin<Row>({ onChange });
        const grid: Grid<Row> = new Grid<Row>({ columns, plugins: [plugin] });

        expect(plugin.moveColumn("pinned", "selection", "before")).toBe(false);
        expect(plugin.moveColumn("group", "selection", "before")).toBe(false);
        expect(grid.getState().columns).toEqual(columns);
        expect(onChange).not.toHaveBeenCalled();

        grid.destroy();
    });

    it("ignores no-op and unknown column moves", () => {
        const plugin: ColumnReorderPlugin<Row> = new ColumnReorderPlugin<Row>();
        const grid: Grid<Row> = new Grid<Row>({
            columns: [
                { id: "first", header: "First", movable: true },
                { id: "second", header: "Second", movable: true },
            ],
            plugins: [plugin],
        });
        const revision: number = grid.getRevision();

        expect(plugin.moveColumn("first", "first", "before")).toBe(false);
        expect(plugin.moveColumn("missing", "second", "after")).toBe(false);
        expect(plugin.moveColumn("first", "second", "before")).toBe(false);
        expect(grid.getRevision()).toBe(revision);

        grid.destroy();
    });

    it("calls onChange only after a successful reorder", () => {
        const onChange: ReturnType<typeof vi.fn> = vi.fn();
        const plugin: ColumnReorderPlugin<Row> = new ColumnReorderPlugin<Row>({ onChange });
        const grid: Grid<Row> = new Grid<Row>({
            columns: [
                { id: "first", header: "First", movable: true },
                { id: "second", header: "Second", movable: true },
            ],
            plugins: [plugin],
        });

        grid.emit("columnDrop", { sourceColumnId: "first", targetColumnId: "second", position: "after" });

        expect(onChange).toHaveBeenCalledOnce();
        expect(getLeafIds(onChange.mock.calls[0][0])).toEqual(["second", "first"]);
        grid.destroy();
    });
});
