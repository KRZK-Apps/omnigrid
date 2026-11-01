import type { ColumnDef } from "@omnigrid/core";
import type { GroupingRow } from "./types";

export const groupingData: GroupingRow[] = [
    { id: 1, region: "Europe", department: "Sales", sales: 100 },
    { id: 2, region: "Europe", department: "Sales", sales: 200 },
    { id: 3, region: "Europe", department: "Engineering", sales: 300 },
    { id: 4, region: "Asia", department: "Sales", sales: 50 },
    { id: 5, region: "Asia", department: "Engineering", sales: 400 },
];

export const groupingColumns: ColumnDef<GroupingRow>[] = [
    { id: "region", field: "region", header: "Region", width: 140 },
    { id: "department", field: "department", header: "Department", width: 160 },
    { id: "sales", field: "sales", header: "Sales", width: 120 },
];
