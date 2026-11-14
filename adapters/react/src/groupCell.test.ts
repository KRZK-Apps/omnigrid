import { type ReactNode, isValidElement } from "react";

import {
    type ColumnLeafDef,
    type GridApi,
    type GroupRowNode,
    IconRegistry,
    type SlotRenderContext,
} from "@omnigrid/core";
import { describe, expect, it } from "vitest";

import { getCollapsedGroupDisplay, getTreeDataLeafIndent, renderGroupCellContent, renderGroupCellPlaceholder } from "./groupCell";
import type { ContentBridge, PooledCellRenderInfo } from "./types";

interface Row {
    sector: string;
    cargoCategory: string;
    licenseStatus: string;
}

const groupBy: string[] = ["sector", "cargoCategory", "licenseStatus"];
const collapsedRow: { collapsedGroup: { field: string; key: string; level: number } } = {
    collapsedGroup: { field: "licenseStatus", key: "Licensed", level: 2 },
};

describe("getCollapsedGroupDisplay", () => {
    it("uses the single group column regardless of showGroupValues", () => {
        const groupColumn: ColumnLeafDef<Row> = { id: "sector", field: "sector" };
        const nestedColumn: ColumnLeafDef<Row> = { id: "licenseStatus", field: "licenseStatus" };

        expect(getCollapsedGroupDisplay(collapsedRow, groupColumn, groupBy, "single")).toEqual({
            value: "Licensed",
            level: 2,
        });

        expect(getCollapsedGroupDisplay(collapsedRow, nestedColumn, groupBy, "single")).toBeUndefined();
    });

    it("uses the matching group-level column in perLevel mode", () => {
        const groupColumn: ColumnLeafDef<Row> = { id: "licenseStatus", field: "licenseStatus" };
        const otherGroupColumn: ColumnLeafDef<Row> = { id: "sector", field: "sector" };

        expect(getCollapsedGroupDisplay(collapsedRow, groupColumn, groupBy, "perLevel")).toEqual({
            value: "Licensed",
            level: 2,
        });
        expect(getCollapsedGroupDisplay(collapsedRow, otherGroupColumn, groupBy, "perLevel")).toBeUndefined();
    });

    it("leaves regular rows to normal cell rendering", () => {
        const groupColumn: ColumnLeafDef<Row> = { id: "sector", field: "sector" };

        expect(getCollapsedGroupDisplay({ sector: "Europe" }, groupColumn, groupBy, "single")).toBeUndefined();
    });

    it("toggles a group from its accessible chevron button", () => {
        const toggleGroup: (groupId: string) => void = vi.fn();
        const icons: IconRegistry<Row> = new IconRegistry<Row>();
        const grid: GridApi<Row> = {
            getState: () => ({ groupBy: ["sector"], groupColumnMode: "single", showChildCount: false }),
            methods: { toggleGroup },
            icons,
        } as unknown as GridApi<Row>;
        const bridge: ContentBridge<Row> = {
            registry: {},
            context: () => ({ api: { icons } }) as unknown as SlotRenderContext<Row>,
        };
        const group: GroupRowNode<Row> = {
            type: "group",
            id: "__root__/sector:Europe",
            field: "sector",
            key: "Europe",
            level: 0,
            expanded: true,
            childrenCount: 1,
            aggregations: {},
            children: [],
        };
        const info: PooledCellRenderInfo<Row> = {
            data: group as unknown as Row,
            column: { id: "sector", field: "sector" },
            columnIndex: 0,
            rowId: group.id,
            rowIndex: 0,
            colSpan: 1,
        };
        const content: ReactNode | undefined = renderGroupCellContent(info, bridge, grid);

        expect(isValidElement(content)).toBe(true);
        if (!isValidElement(content)) return;
        const children: ReactNode[] = (content.props as { children: ReactNode[] }).children;
        const toggleButton: ReactNode = children[0];
        const groupLabel: ReactNode = children[1];

        expect(isValidElement(toggleButton)).toBe(true);
        if (!isValidElement(toggleButton)) return;
        expect(isValidElement(groupLabel)).toBe(true);
        if (!isValidElement(groupLabel)) return;
        expect((groupLabel.props as { className: string }).className).toContain("omnigrid-cell-truncated");
        const onClick = (toggleButton.props as { onClick: (event: { stopPropagation: () => void }) => void }).onClick;
        const stopPropagation = vi.fn();

        onClick({ stopPropagation });

        expect(stopPropagation).toHaveBeenCalledOnce();
        expect(toggleGroup).toHaveBeenCalledWith(group.id);
    });
});

describe("tree data leaf cells", () => {
    it("preserves the tree column value for leaves while retaining grouping suppression", () => {
        const leaf: {
            type: "leaf";
            id: string;
            data: Row;
            level: number;
            parent: GroupRowNode<Row>;
        } = {
            type: "leaf",
            id: "leaf",
            data: { sector: "Europe", cargoCategory: "Chemicals", licenseStatus: "Licensed" },
            level: 1,
            parent: {
                type: "group",
                id: "parent",
                field: "sector",
                key: "Europe",
                level: 0,
                expanded: true,
                childrenCount: 1,
                aggregations: {},
                children: [],
            },
        };
        const column: ColumnLeafDef<Row> = { id: "sector", field: "sector" };
        const treeGrid: GridApi<Row> = {
            getState: () => ({ groupBy: ["sector"], groupColumnMode: "single" }),
            methods: { getTreeRows: () => [] },
        } as unknown as GridApi<Row>;
        const groupingGrid: GridApi<Row> = {
            getState: () => ({ groupBy: ["sector"], groupColumnMode: "single" }),
            methods: {},
        } as unknown as GridApi<Row>;
        const info: PooledCellRenderInfo<Row> = {
            data: leaf as unknown as Row,
            column,
            columnIndex: 0,
            rowId: leaf.id,
            rowIndex: 1,
            colSpan: 1,
        };
        const bridge: ContentBridge<Row> = { registry: {}, context: () => ({}) as SlotRenderContext<Row> };

        expect(renderGroupCellContent(info, bridge, treeGrid)).toBeUndefined();
        expect(renderGroupCellPlaceholder(info, treeGrid)).toBeUndefined();
        expect(renderGroupCellContent(info, bridge, groupingGrid)).toBeDefined();
        expect(renderGroupCellPlaceholder(info, groupingGrid)).toBe("");
        expect(getTreeDataLeafIndent(leaf, column, treeGrid)).toBe(50);
        expect(getTreeDataLeafIndent({ ...leaf, level: 3 }, column, treeGrid)).toBe(90);
        expect(getTreeDataLeafIndent(leaf, { id: "cargoCategory", field: "cargoCategory" }, treeGrid)).toBeUndefined();
        expect(getTreeDataLeafIndent(leaf, column, groupingGrid)).toBeUndefined();
    });
});
