import { describe, expect, it } from "vitest";

import { buildGroupTree, computeAggregations, flattenTree } from "./groupingPipeline";
import type { AggregationFunc, ColumnLeafDef, GroupRowNode, TreeRowNode } from "@omnigrid/core";
import { groupingData } from "./mockData";
import { GroupingRow } from "./types";

interface Row {
    region: string;
    department: string;
    sales: number;
}

function getRowId(row: Row, index: number): string {
    return `row-${index}`;
}

function asGroup(node: TreeRowNode<GroupingRow>): GroupRowNode<GroupingRow> {
    if (node.type !== "group") throw new Error("expected group node");
    return node as GroupRowNode<GroupingRow>;
}

describe("groupingPipeline", () => {
    it("builds a multi-level group tree", () => {
        const root = buildGroupTree(groupingData, ["region", "department"], {}, getRowId);
        expect(root).not.toBeNull();

        const europe = asGroup(root!.children[0]);
        expect(europe.type).toBe("group");
        expect(europe.key).toBe("Europe");
        expect(europe.level).toBe(0);

        const sales = asGroup(europe.children[0]);
        expect(sales.type).toBe("group");
        expect(sales.key).toBe("Sales");
        expect(sales.level).toBe(1);
        expect(europe.children.length).toBe(2);
    });

    it("flattens all rows when every group is expanded", () => {
        const root = buildGroupTree(groupingData, ["region", "department"], {}, getRowId);
        const flat = flattenTree(root, {});
        expect(flat.length).toBe(11); // 2 regions + 4 departments + 5 leaves

        const groups = flat.filter((r) => r.type === "group");
        expect(groups.length).toBe(6);
        const leaves = flat.filter((r) => r.type === "leaf");
        expect(leaves.length).toBe(5);
    });

    it("hides descendants of collapsed groups", () => {
        const root = buildGroupTree(groupingData, ["region", "department"], { "__root__/region:Europe": false }, getRowId);
        const flat = flattenTree(root, { "__root__/region:Europe": false });

        // Europe itself stays, its 2 departments and 3 leaves hidden.
        // Asia remains expanded: Asia + 2 departments + 2 leaves = 5 rows.
        // Total = 1 (Europe) + 5 (Asia) = 6 rows.
        expect(flat.length).toBe(6);
        expect(flat.some((r) => r.type === "leaf" && r.data.region === "Europe")).toBe(false);
    });

    it("computes aggregations bottom-up", () => {
        const root = buildGroupTree(groupingData, ["region", "department"], {}, getRowId);
        computeAggregations(root, { sales: "sum" });

        const europe = asGroup(root!.children.find((c): c is GroupRowNode<GroupingRow> => c.type === "group" && c.key === "Europe")!);
        expect(europe.aggregations["sales"]).toBe(600);
        expect(europe.childrenCount).toBe(3);

        const sales = asGroup(europe.children.find((c): c is GroupRowNode<GroupingRow> => c.type === "group" && c.key === "Sales")!);
        expect(sales.aggregations["sales"]).toBe(300);
        expect(sales.childrenCount).toBe(2);

        const eng = asGroup(europe.children.find((c): c is GroupRowNode<GroupingRow> => c.type === "group" && c.key === "Engineering")!);
        expect(eng.aggregations["sales"]).toBe(300);
        expect(eng.childrenCount).toBe(1);

        const asia = asGroup(root!.children.find((c): c is GroupRowNode<GroupingRow> => c.type === "group" && c.key === "Asia")!);
        expect(asia.aggregations["sales"]).toBe(450);
        expect(asia.childrenCount).toBe(2);
    });

    it("supports custom aggregation functions", () => {
        const root = buildGroupTree(groupingData, ["region"], {}, getRowId);
        const customAvg: AggregationFunc<Row> = (values) => {
            const nums = values as number[];
            return nums.reduce((a, b) => a + b, 0) / nums.length;
        };
        computeAggregations(root, { sales: customAvg });

        const europe = asGroup(root!.children.find((c): c is GroupRowNode<GroupingRow> => c.type === "group" && c.key === "Europe")!);
        expect(europe.aggregations["sales"]).toBe(200); // (100 + 200 + 300) / 3
    });

    it("flattenTree keeps group rows when collapseSingleChildGroups is false", () => {
        const root = buildGroupTree(groupingData, ["region", "department"], {}, getRowId);
        const flat = flattenTree(root, {}, false);

        // 2 region groups + 4 department groups + 5 leaves = 11 rows
        expect(flat.length).toBe(11);
        expect(flat.filter((r) => r.type === "group").length).toBe(6);
        expect(flat.filter((r) => r.type === "leaf").length).toBe(5);
    });

    it("flattenTree collapses single-child groups when enabled", () => {
        const root = buildGroupTree(groupingData, ["region", "department"], {}, getRowId);
        const flat = flattenTree(root, {}, true);

        // Europe/Engineering (1 leaf), Asia/Sales (1 leaf), Asia/Engineering (1 leaf) collapse
        // Europe/Sales (2 leaves) stays as group
        // Europe + Asia + Europe/Sales stay as groups (upper levels never collapse)
        // 3 groups + 5 leaves = 8 rows
        expect(flat.length).toBe(8);
        expect(flat.filter((r) => r.type === "group").length).toBe(3); // Europe, Asia, Europe/Sales
        expect(flat.filter((r) => r.type === "leaf").length).toBe(5);
    });

    it("upper-level groups are never collapsed even with single child", () => {
        const singleLeafData: GroupingRow[] = [
            { id: 1, region: "Europe", department: "Sales", sales: 100 },
        ];
        const root = buildGroupTree(singleLeafData, ["region", "department"], {}, getRowId);
        const flat = flattenTree(root, {}, true);

        // Europe (level 0) has a child group → never collapsed
        // Europe/Sales (level 1) has 1 leaf → collapsed
        expect(flat.length).toBe(2);
        expect(flat.filter((r) => r.type === "group").length).toBe(1); // Europe
        expect(flat.filter((r) => r.type === "leaf").length).toBe(1);
    });

    it("flattenTree collapses nested single-child groups recursively at lowest level", () => {
        const multiLevelSingle: GroupingRow[] = [
            { id: 1, region: "Europe", department: "Sales", sales: 100 },
            { id: 2, region: "Europe", department: "Engineering", sales: 200 },
            { id: 3, region: "Asia", department: "Sales", sales: 300 },
        ];
        const root = buildGroupTree(multiLevelSingle, ["region", "department"], {}, getRowId);
        const flat = flattenTree(root, {}, true);

        // Europe (level 0) → 2 child groups → stays as group
        // Asia (level 0) → 1 child group → stays as group (upper levels never collapse)
        // Europe/Sales, Europe/Engineering, Asia/Sales → 1 leaf each → collapsed
        expect(flat.length).toBe(5);
        expect(flat.filter((r) => r.type === "group").length).toBe(2); // Europe, Asia
        expect(flat.filter((r) => r.type === "leaf").length).toBe(3);
    });
});
