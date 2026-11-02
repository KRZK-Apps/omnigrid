import { describe, expect, it } from "vitest";

import type { ColumnLeafDef } from "@omnigrid/core";

import { getCollapsedGroupDisplay } from "./groupCell";

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

        expect(getCollapsedGroupDisplay(collapsedRow, groupColumn, groupBy, "single")).toEqual({ value: "Licensed", level: 2 });
        expect(getCollapsedGroupDisplay(collapsedRow, nestedColumn, groupBy, "single")).toBeUndefined();
    });

    it("uses the matching group-level column in perLevel mode", () => {
        const groupColumn: ColumnLeafDef<Row> = { id: "licenseStatus", field: "licenseStatus" };
        const otherGroupColumn: ColumnLeafDef<Row> = { id: "sector", field: "sector" };

        expect(getCollapsedGroupDisplay(collapsedRow, groupColumn, groupBy, "perLevel")).toEqual({ value: "Licensed", level: 2 });
        expect(getCollapsedGroupDisplay(collapsedRow, otherGroupColumn, groupBy, "perLevel")).toBeUndefined();
    });

    it("leaves regular rows to normal cell rendering", () => {
        const groupColumn: ColumnLeafDef<Row> = { id: "sector", field: "sector" };

        expect(getCollapsedGroupDisplay({ sector: "Europe" }, groupColumn, groupBy, "single")).toBeUndefined();
    });
});
