import { describe, expect, it } from "vitest";

import type { DataRowNode, GroupRowNode, PooledRow, RowGroupContext, RowRenderParams } from "@omnigrid/core";
import { getRowRenderParams } from "./rowRenderParams";

interface Item {
    id: number;
    value: number | null;
}

describe("getRowRenderParams", () => {
    it("unwraps grouped leaf data and exposes its collapsed-group and parent context", () => {
        const data: Item = { id: 1, value: null };
        const parent: GroupRowNode<Item> = {
            type: "group",
            id: "region:West/department:Engineering",
            field: "department",
            key: "Engineering",
            level: 1,
            expanded: true,
            childrenCount: 1,
            aggregations: {},
            children: [],
        };
        const parentGroup: RowGroupContext<Item> = {
            ...parent,
            children: [{ type: "leaf", id: 1, data, level: 2 }],
        };
        const node: DataRowNode<Item> = {
            type: "leaf",
            id: 1,
            data,
            level: 2,
            parent,
            parentGroup,
            collapsedGroup: { field: "department", key: "Engineering", level: 1 },
        };
        const row: Pick<PooledRow<Item>, "type" | "rowId" | "index" | "data"> = {
            type: "leaf",
            rowId: node.id,
            index: 0,
            data: node,
        };

        const params: RowRenderParams<Item> = getRowRenderParams(row);

        expect(params).toMatchObject({
            rowType: "leaf",
            data,
            isCollapsedGroup: true,
            parentGroup,
        });
    });

    it("reports ordinary rows as non-collapsed and preserves raw data", () => {
        const data: Item = { id: 2, value: 0 };
        const row: Pick<PooledRow<Item>, "type" | "rowId" | "index" | "data"> = {
            type: "leaf",
            rowId: data.id,
            index: 1,
            data,
        };

        const params: RowRenderParams<Item> = getRowRenderParams(row);

        expect(params).toMatchObject({
            rowType: "leaf",
            data,
            isCollapsedGroup: false,
        });
        expect(params.parentGroup).toBeUndefined();
    });
});
