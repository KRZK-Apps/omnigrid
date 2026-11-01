import { describe, expect, it } from "vitest";

import { buildGroupTree, computeAggregations, flattenTree } from "./groupingPipeline";
import type { AggregationFunc, ColumnLeafDef, TreeRowNode } from "./types";

interface Row {
    region: string;
    department: string;
    sales: number;
}

const data: Row[] = [
    { region: "Europe", department: "Sales", sales: 100 },
    { region: "Europe", department: "Sales", sales: 200 },
    { region: "Europe", department: "Engineering", sales: 300 },
    { region: "Asia", department: "Sales", sales: 50 },
    { region: "Asia", department: "Engineering", sales: 400 },
];

const columns: ColumnLeafDef<Row>[] = [
    { id: "region", field: "region", header: "Region" },
    { id: "department", field: "department", header: "Department" },
    { id: "sales", field: "sales", header: "Sales", aggFunc: "sum" },
];

function getRowId(row: Row, index: number): string {
    return `row-${index}`;
}

describe("groupingPipeline", () => {
    it("builds a multi-level group tree", () => {
        const root = buildGroupTree(data, ["region", "department"], {}, getRowId);
        expect(root).not.toBeNull();

        const europe = root!.children[0];
        expect(europe.type).toBe("group");
        expect(europe.key).toBe("Europe");
        expect(europe.level).toBe(0);

        const sales = europe.children[0];
        expect(sales.type).toBe("group");
        expect(sales.key).toBe("Sales");
        expect(sales.level).toBe(1);
        expect(europe.children.length).toBe(2);
    });

    it("flattens all rows when every group is expanded", () => {
        const root = buildGroupTree(data, ["region", "department"], {}, getRowId);
        const flat = flattenTree(root, {});
        expect(flat.length).toBe(11); // 2 regions + 4 departments + 5 leaves

        const groups = flat.filter((r) => r.type === "group");
        expect(groups.length).toBe(6);
        const leaves = flat.filter((r) => r.type === "leaf");
        expect(leaves.length).toBe(5);
    });

    it("hides descendants of collapsed groups", () => {
        const root = buildGroupTree(data, ["region", "department"], { "__root__/region:Europe": false }, getRowId);
        const flat = flattenTree(root, { "__root__/region:Europe": false });

        const europe = flat.find((r) => r.type === "group" && r.key === "Europe");
        expect(europe).toBeDefined();
        const europeLeaves = flat.filter((r) => r.type === "leaf");
        expect(europeLeaves.length).toBe(2);
        const asiaLeaves = flat.filter((r) => r.type === "leaf" && r.parent?.parent?.key === "Asia");
        expect(asiaLeaves.length).toBe(2);
    });

    it("computes sum aggregates bottom-up", () => {
        const root = buildGroupTree(data, ["region", "department"], {}, getRowId);
        const aggregations: Record<string, AggregationFunc<Row>> = { sales: "sum" };
        computeAggregations(root, aggregations);

        const europeSales = root.children[0].children[0];
        expect(europeSales.type).toBe("group");
        expect(europeSales.aggregations["sales"]).toBe(300); // 100 + 200

        const europe = root.children[0];
        expect(europe.aggregations["sales"]).toBe(600); // 100 + 200 + 300

        const asiaEngineering = root.children[1].children[1];
        expect(asiaEngineering.aggregations["sales"]).toBe(400);
    });

    it("computes childrenCount as total descendant leaves", () => {
        const root = buildGroupTree(data, ["region", "department"], {}, getRowId);
        computeAggregations(root, columns);

        const europe = root.children[0];
        expect(europe.childrenCount).toBe(3);
        const europeSales = europe.children[0];
        expect(europeSales.childrenCount).toBe(2);
    });

    it("returns empty when groupBy is empty", () => {
        const root = buildGroupTree(data, [], {}, getRowId);
        expect(root).toBeNull();
        expect(flattenTree(root, {})).toEqual([]);
    });

    it("re-flatten respects toggled expanded state without rebuilding", () => {
        const root = buildGroupTree(data, ["region"], {}, getRowId);
        const allExpanded = flattenTree(root, {});
        expect(allExpanded.length).toBe(7); // 2 groups + 5 leaves

        const europeCollapsed = flattenTree(root, { "__root__/region:Europe": false });
        expect(europeCollapsed.length).toBe(4); // Europe group + Asia group + 2 Asia leaves
    });
});
