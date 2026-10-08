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
    const rendered = column.headerRenderer?.(column);
    expect(rendered).toMatchObject({ type: "node", tag: "span" });
    expect((rendered as any).children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "node", tag: "span" }),
      ]),
    );

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
