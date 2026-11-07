import { Grid, flattenColumns } from "@omnigrid/core";
import type { ColumnHeaderExtension, ColumnLeafDef } from "@omnigrid/core";
import { describe, expect, it } from "vitest";

import { ColumnResizePlugin } from "./index";

interface ResizeRow {
    name?: string;
    first?: string;
    second?: string;
    pinned?: string;
    status?: string;
    locked?: string;
    [key: string]: unknown;
}

function renderResizeHandle(grid: Grid<ResizeRow>, columnId: string): unknown {
    const column: ColumnLeafDef<ResizeRow> | undefined = flattenColumns(grid.getState().columns).find(
        (candidate: ColumnLeafDef<ResizeRow>) => candidate.id === columnId,
    );
    if (!column) throw new Error(`Column "${columnId}" was not found`);

    const extension: ColumnHeaderExtension<ResizeRow> | undefined = grid.getHeaderExtensions("overlay")[0];
    if (!extension) throw new Error("Resize header extension was not registered");

    return extension.render({ column, index: 0 });
}

describe("ColumnResizePlugin", () => {
    it("clamps widths inside minWidth and maxWidth", () => {
        const grid = new Grid<ResizeRow>({
            columns: [{ id: "name", header: "Name", width: 120, minWidth: 80, maxWidth: 180 }],
            data: [{ name: "Alice" }],
        });

        const plugin = new ColumnResizePlugin<ResizeRow>();
        plugin.register(grid);

        expect(plugin.setColumnWidth("name", 50)).toBe(80);
        expect(plugin.setColumnWidth("name", 250)).toBe(180);
        expect(plugin.getColumnWidth("name")).toBe(180);

        grid.destroy();
    });

    it("updates width while dragging and exposes the guide line", () => {
        const grid = new Grid<ResizeRow>({
            columns: [{ id: "name", header: "Name", width: 120, minWidth: 80, maxWidth: 220 }],
            data: [{ name: "Alice" }],
        });

        const plugin = new ColumnResizePlugin<ResizeRow>();
        plugin.register(grid);

        plugin.beginResize("name", 200);
        plugin.resizeBy(40);

        expect(plugin.getColumnWidth("name")).toBe(160);
        expect(plugin.getResizeGuide()).toMatchObject({ columnId: "name", visible: true });

        plugin.endResize();
        expect(plugin.getResizeGuide().visible).toBe(false);
        grid.destroy();
    });

    it("starts flex resizing from the current calculated width", () => {
        const grid = new Grid<ResizeRow>({
            columns: [
                { id: "first", header: "First", flex: 1, minWidth: 80 },
                { id: "second", header: "Second", flex: 1, minWidth: 80 },
            ],
            data: [{ first: "a", second: "b" }],
        });
        grid.setViewport({ width: 600, height: 400 });

        const plugin = new ColumnResizePlugin<ResizeRow>();
        plugin.register(grid);

        expect(plugin.getColumnWidth("first")).toBe(300);
        plugin.beginResize("first", 200);
        expect(plugin.resizeTo(220)).toBe(320);
        expect(grid.getViewportData().columns.map((item) => item.width)).toEqual([320, 280]);

        grid.destroy();
    });

    it("freezes flex columns to the left and redistributes width only to the right", () => {
        const grid = new Grid<ResizeRow>({
            columns: [
                { id: "first", header: "First", flex: 1 },
                { id: "resized", header: "Resized", flex: 1 },
                { id: "last", header: "Last", flex: 1 },
            ],
            data: [{ first: "a", resized: "b", last: "c" }],
        });
        grid.setViewport({ width: 600, height: 400 });

        const plugin = new ColumnResizePlugin<ResizeRow>();
        plugin.register(grid);

        plugin.beginResize("resized", 200);
        expect(plugin.resizeTo(240)).toBe(240);
        expect(grid.getViewportData().columns.map((item) => item.width)).toEqual([200, 240, 160]);
        const [first, resized, last] = grid.getState().columns;
        expect(first).toMatchObject({ id: "first", width: 200 });
        expect(first).not.toHaveProperty("flex");
        expect(resized).toMatchObject({ id: "resized", width: 240 });
        expect(resized).not.toHaveProperty("flex");
        expect(last).toMatchObject({ id: "last", flex: 1 });
        expect(last).not.toHaveProperty("width");

        grid.destroy();
    });

    it("resizes right-pinned columns in the direction of their left-edge handle", () => {
        const grid = new Grid<ResizeRow>({
            columns: [{ id: "pinned", header: "Pinned", width: 120, pinned: "right" }],
            data: [{ pinned: "value" }],
        });
        grid.setViewport({ width: 600, height: 400 });

        const plugin = new ColumnResizePlugin<ResizeRow>();
        plugin.register(grid);

        plugin.beginResize("pinned", 200);
        expect(plugin.resizeTo(180)).toBe(140);
        expect(grid.getViewportData().pinnedRightColumns[0].width).toBe(140);

        expect(plugin.resizeTo(220)).toBe(100);
        expect(grid.getViewportData().pinnedRightColumns[0].width).toBe(100);

        plugin.endResize();
        grid.destroy();
    });

    it("registers a resize handle without replacing column header renderers", () => {
        const customHeaderRenderer: NonNullable<ColumnLeafDef<ResizeRow>["headerRenderer"]> = () => "Custom";
        const grid = new Grid<ResizeRow>({
            columns: [
                { id: "status", header: "Status", width: 80, minWidth: 60, maxWidth: 220 },
                { id: "custom", header: "Custom", width: 80, headerRenderer: customHeaderRenderer },
            ],
            data: [{ status: "approved" }, { status: "pending review" }],
        });

        const plugin = new ColumnResizePlugin<ResizeRow>();
        plugin.register(grid);

        expect(grid.getState().columns[0].headerRenderer).toBeUndefined();
        expect(grid.getState().columns[1].headerRenderer).toBe(customHeaderRenderer);
        expect(grid.getHeaderExtensions("overlay")).toHaveLength(1);
        expect(renderResizeHandle(grid, "status")).toMatchObject({
            type: "node",
            tag: "span",
            attrs: {
                class: "omnigrid-column-resize-handle",
                title: "Resize column",
            },
        });

        grid.destroy();
    });

    it("contributes only the resize handle and leaves header tools to the adapter", () => {
        const grid = new Grid<ResizeRow>({
            columns: [{ id: "status", header: "Status", width: 120, sortState: "desc", sortIndex: 2 }],
            data: [{ status: "approved" }],
        });

        const plugin = new ColumnResizePlugin<ResizeRow>();
        plugin.register(grid);

        const rendered: unknown = renderResizeHandle(grid, "status");
        expect(rendered).toMatchObject({
            attrs: { class: "omnigrid-column-resize-handle" },
        });
        expect(rendered).not.toHaveProperty("children");

        grid.destroy();
    });

    it("places the resize handle on the left edge of right-pinned columns", () => {
        const grid = new Grid<ResizeRow>({
            columns: [{ id: "pinned", header: "Pinned", width: 120, pinned: "right" }],
            data: [{ pinned: "value" }],
        });

        const plugin = new ColumnResizePlugin<ResizeRow>();
        plugin.register(grid);

        expect(renderResizeHandle(grid, "pinned")).toMatchObject({
            attrs: { class: "omnigrid-column-resize-handle omnigrid-column-resize-handle-left" },
        });

        grid.destroy();
    });

    it("supports opting a column out of resizing via resizable: false", () => {
        const grid = new Grid<ResizeRow>({
            columns: [{ id: "locked", header: "Locked", width: 120, resizable: false }],
            data: [{ locked: "x" }],
        });

        const plugin = new ColumnResizePlugin<ResizeRow>();
        plugin.register(grid);

        expect(grid.getState().columns[0].resizable).toBe(false);
        expect(renderResizeHandle(grid, "locked")).toBeNull();
        expect(plugin.setColumnWidth("locked", 200)).toBe(120);

        grid.destroy();
    });

    it("auto-fits column width from content", () => {
        const grid = new Grid<ResizeRow>({
            columns: [{ id: "status", header: "Status", width: 80, minWidth: 60, maxWidth: 220 }],
            data: [{ status: "approved" }, { status: "pending review" }],
        });

        const plugin = new ColumnResizePlugin<ResizeRow>();
        plugin.register(grid);

        const width = plugin.autoSizeColumn("status");
        expect(width).toBeGreaterThanOrEqual(60);
        expect(width).toBeLessThanOrEqual(220);
        expect(plugin.getColumnWidth("status")).toBe(width);

        grid.destroy();
    });
});

describe("ColumnResizePlugin removal", () => {
    it("unregisters its header extension without mutating column renderers", () => {
        const original: NonNullable<ColumnLeafDef<ResizeRow>["headerRenderer"]> = () => "Custom";
        const grid = new Grid<ResizeRow>({
            columns: [
                { id: "name", header: "Name", width: 120, headerRenderer: original },
                { id: "age", header: "Age", width: 80 },
            ],
            data: [{ name: "Alice", age: 1 }],
        });
        const plugin = new ColumnResizePlugin<ResizeRow>();

        grid.setPlugins([plugin]);
        expect(grid.getState().columns[0].headerRenderer).toBe(original);
        expect(grid.getState().columns[1].headerRenderer).toBeUndefined();
        expect(grid.getHeaderExtensions("overlay")).toHaveLength(1);

        grid.setPlugins([]);
        expect(grid.getState().columns[0].headerRenderer).toBe(original);
        expect(grid.getState().columns[1].headerRenderer).toBeUndefined();
        expect(grid.getHeaderExtensions("overlay")).toHaveLength(0);
    });
});
