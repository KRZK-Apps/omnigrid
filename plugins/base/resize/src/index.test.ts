import { describe, expect, it } from "vitest";
import { Grid } from "@omnigrid/core";
import { ColumnResizePlugin } from "./index";

describe("ColumnResizePlugin", () => {
  it("clamps widths inside minWidth and maxWidth", () => {
    const grid = new Grid({
      columns: [
        { id: "name", header: "Name", width: 120, minWidth: 80, maxWidth: 180 },
      ],
      data: [{ name: "Alice" }],
    });

    const plugin = new ColumnResizePlugin();
    plugin.register(grid);

    expect(plugin.setColumnWidth("name", 50)).toBe(80);
    expect(plugin.setColumnWidth("name", 250)).toBe(180);
    expect(plugin.getColumnWidth("name")).toBe(180);

    grid.destroy();
  });

  it("updates width while dragging and exposes the guide line", () => {
    const grid = new Grid({
      columns: [
        { id: "name", header: "Name", width: 120, minWidth: 80, maxWidth: 220 },
      ],
      data: [{ name: "Alice" }],
    });

    const plugin = new ColumnResizePlugin();
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
    const grid = new Grid({
      columns: [
        { id: "first", header: "First", flex: 1, minWidth: 80 },
        { id: "second", header: "Second", flex: 1, minWidth: 80 },
      ],
      data: [{ first: "a", second: "b" }],
    });
    grid.setViewport({ width: 600, height: 400 });

    const plugin = new ColumnResizePlugin();
    plugin.register(grid);

    expect(plugin.getColumnWidth("first")).toBe(300);
    plugin.beginResize("first", 200);
    expect(plugin.resizeTo(220)).toBe(320);
    expect(grid.getViewportData().columns.map((item) => item.width)).toEqual([320, 280]);

    grid.destroy();
  });

  it("freezes flex columns to the left and redistributes width only to the right", () => {
    const grid = new Grid({
      columns: [
        { id: "first", header: "First", flex: 1 },
        { id: "resized", header: "Resized", flex: 1 },
        { id: "last", header: "Last", flex: 1 },
      ],
      data: [{ first: "a", resized: "b", last: "c" }],
    });
    grid.setViewport({ width: 600, height: 400 });

    const plugin = new ColumnResizePlugin();
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
    const grid = new Grid({
      columns: [{ id: "pinned", header: "Pinned", width: 120, pinned: "right" }],
      data: [{ pinned: "value" }],
    });
    grid.setViewport({ width: 600, height: 400 });

    const plugin = new ColumnResizePlugin();
    plugin.register(grid);

    plugin.beginResize("pinned", 200);
    expect(plugin.resizeTo(180)).toBe(140);
    expect(grid.getViewportData().pinnedRightColumns[0].width).toBe(140);

    expect(plugin.resizeTo(220)).toBe(100);
    expect(grid.getViewportData().pinnedRightColumns[0].width).toBe(100);

    plugin.endResize();
    grid.destroy();
  });

  it("injects a resize handle into the header renderer without adapter-specific resize hooks", () => {
    const grid = new Grid({
      columns: [
        { id: "status", header: "Status", width: 80, minWidth: 60, maxWidth: 220 },
      ],
      data: [{ status: "approved" }, { status: "pending review" }],
    });

    const plugin = new ColumnResizePlugin();
    plugin.register(grid);

    const column = grid.getState().columns[0];
    expect(typeof column.headerRenderer).toBe("function");
    const rendered = column.headerRenderer?.(column) as any;
    expect(rendered).toMatchObject({ type: "node", tag: "span" });
    expect(rendered.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "node", tag: "span" }),
      ]),
    );
    expect(rendered.children[1].on.click).toEqual(expect.any(Function));

    grid.destroy();
  });

  it("keeps the sort direction and priority visible in the resized header", () => {
    const grid = new Grid({
      columns: [{ id: "status", header: "Status", width: 120, sortState: "desc", sortIndex: 2 }],
      data: [{ status: "pending" }],
    });

    const plugin = new ColumnResizePlugin();
    plugin.register(grid);

    const column = grid.getState().columns[0];
    const rendered = column.headerRenderer?.(column) as any;
    const sortIndicator = rendered.children[1].children[0];

    expect(sortIndicator.attrs.class).toBe("omnigrid-sort-indicator");
    expect(sortIndicator.children[0].attrs.class).toContain("omnigrid-icon-arrow-down");
    expect(sortIndicator.children[1]).toMatchObject({
      tag: "span",
      attrs: { class: "omnigrid-sort-priority" },
      children: ["2"],
    });

    grid.destroy();
  });

  it("places the resize handle on the left edge of right-pinned columns", () => {
    const grid = new Grid({
      columns: [{ id: "pinned", header: "Pinned", width: 120, pinned: "right" }],
      data: [{ pinned: "value" }],
    });

    const plugin = new ColumnResizePlugin();
    plugin.register(grid);

    const column = grid.getState().columns[0];
    const rendered = column.headerRenderer?.(column) as any;
    const handle = rendered.children[1];
    expect(handle.attrs.class).toContain("omnigrid-column-resize-handle-left");

    grid.destroy();
  });

  it("supports opting a column out of resizing via resizable: false", () => {
    const grid = new Grid({
      columns: [
        { id: "locked", header: "Locked", width: 120, resizable: false },
      ],
      data: [{ locked: "x" }],
    });

    const plugin = new ColumnResizePlugin();
    plugin.register(grid);

    const column = grid.getState().columns[0] as any;
    expect(column.resizable).toBe(false);
    expect(column.headerRenderer).toBeUndefined();
    expect(plugin.setColumnWidth("locked", 200)).toBe(120);

    grid.destroy();
  });

  it("auto-fits column width from content", () => {
    const grid = new Grid({
      columns: [
        { id: "status", header: "Status", width: 80, minWidth: 60, maxWidth: 220 },
      ],
      data: [{ status: "approved" }, { status: "pending review" }],
    });

    const plugin = new ColumnResizePlugin();
    plugin.register(grid);

    const width = plugin.autoSizeColumn("status");
    expect(width).toBeGreaterThanOrEqual(60);
    expect(width).toBeLessThanOrEqual(220);
    expect(plugin.getColumnWidth("status")).toBe(width);

    grid.destroy();
  });
});
