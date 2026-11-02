import { expect, describe, it } from "vitest";
import { Grid } from "@omnigrid/core";
import type { DataRowNode, RowHierarchy, TreeRowNode } from "@omnigrid/core";

import type { GroupingRow } from "./types";
import { GroupingPlugin } from "./index";
import { groupingColumns, groupingData } from "./mockData";

describe("GroupingPlugin", () => {
    it("applies initial groupBy through the grid and exposes it", () => {
        const plugin = new GroupingPlugin<GroupingRow>({ groupBy: ["region", "department"] });
        const grid = new Grid<GroupingRow>({ columns: groupingColumns, data: groupingData, rowHeight: 32, plugins: [plugin] });

        expect(grid.getState().groupBy).toEqual(["region", "department"]);
        expect(plugin.getGroupBy()).toEqual(["region", "department"]);

        const rows = grid.getViewportData().rows;
        expect(rows.some((r) => r.type === "group")).toBe(true);
        expect(rows.some((r) => r.type === "leaf")).toBe(true);
    });

    it("setGroupBy disables grouping", () => {
        const plugin = new GroupingPlugin<GroupingRow>({ groupBy: ["region"] });
        const grid = new Grid<GroupingRow>({ columns: groupingColumns, data: groupingData, rowHeight: 32, plugins: [plugin] });

        plugin.setGroupBy([]);
        expect(grid.getState().groupBy).toEqual([]);
        expect(grid.getRowHierarchy()).toBeUndefined();
        expect(plugin.getGroupBy()).toEqual([]);
        expect(grid.getViewportData().rows.every((r) => r.type === "leaf")).toBe(true);
        expect(grid.getViewportData().rows.length).toBe(groupingData.length);
    });

    it("toggleGroup / expandAll / collapseAll", () => {
        const plugin = new GroupingPlugin<GroupingRow>({ groupBy: ["region"] });
        const grid = new Grid<GroupingRow>({ columns: groupingColumns, data: groupingData, rowHeight: 32, plugins: [plugin] });

        const before = grid.getViewportData().rows.length;
        plugin.collapseAll();
        expect(grid.getViewportData().rows.length).toBe(2); // only two region groups

        plugin.expandAll();
        expect(grid.getViewportData().rows.length).toBe(before);
    });

    it("setExpandedGroups restores initial collapse state", () => {
        const plugin = new GroupingPlugin<GroupingRow>({
            groupBy: ["region"],
            expandedGroups: { "__root__/region:Europe": false },
        });
        const grid = new Grid<GroupingRow>({ columns: groupingColumns, data: groupingData, rowHeight: 32, plugins: [plugin] });

        const rows = grid.getViewportData().rows;
        const europe = rows.find((r) => r.type === "group" && r.group?.key === "Europe");
        expect(europe).toBeDefined();
        expect(europe!.group!.expanded).toBe(false);
        // Europe collapsed: only itself; Asia expanded with its 2 leaves.
        expect(rows.length).toBe(4);
    });

    it("provides all and filtered descendant IDs through the generic row hierarchy capability", () => {
        const plugin: GroupingPlugin<GroupingRow> = new GroupingPlugin<GroupingRow>({ groupBy: ["region"] });
        const grid: Grid<GroupingRow> = new Grid<GroupingRow>({
            columns: groupingColumns,
            data: groupingData,
            quickFilter: "Sales",
            getRowId: (row) => row.id,
            plugins: [plugin],
        });
        const hierarchy: RowHierarchy<GroupingRow> | undefined = grid.getRowHierarchy();

        expect(hierarchy?.getLeafRowIds("__root__/region:Europe", "all")).toEqual([1, 2, 3]);
        expect(hierarchy?.getLeafRowIds("__root__/region:Europe", "filtered")).toEqual([1, 2]);
        expect(hierarchy?.getLeafRowIds(1, "all")).toBeUndefined();

        grid.destroy();
    });

    it("preserves the level of a collapsed single-child group on its leaf row", () => {
        const plugin: GroupingPlugin<GroupingRow> = new GroupingPlugin<GroupingRow>({
            groupBy: ["region", "department"],
            collapseSingleChildGroups: true,
        });
        const grid: Grid<GroupingRow> = new Grid<GroupingRow>({
            columns: groupingColumns,
            data: groupingData,
            plugins: [plugin],
        });
        const rows: TreeRowNode<GroupingRow>[] = plugin.getGroupedRows();
        const collapsedRow: DataRowNode<GroupingRow> | undefined = rows.find(
            (row): row is DataRowNode<GroupingRow> => row.type === "leaf" && row.collapsedGroup !== undefined,
        );

        expect(collapsedRow?.collapsedGroup).toEqual({ field: "department", key: "Engineering", level: 1 });
        grid.destroy();
    });

    it("constructor creates a GroupingPlugin", () => {
        const plugin = new GroupingPlugin<GroupingRow>({ groupBy: ["region"] });
        expect(plugin.name).toBe("@omnigrid/grouping-plugin");
        expect(plugin.getGroupBy()).toEqual(["region"]);
    });
});
