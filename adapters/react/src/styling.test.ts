import { describe, expect, it } from "vitest";

import type {
    CellRenderParams,
    ColumnGroupDef,
    ColumnLeafDef,
    ColumnStyle,
    ColumnStyleParams,
    GridApi,
    GridState,
    HeaderGroupRenderParams,
    HeaderRenderParams,
    HeaderStyle,
    ResolvedColumnPresentation,
    RowStyle,
} from "../src";
import {
    resolveCellClasses,
    resolveCellStyle,
    resolveColumnPresentation,
    resolveGroupHeaderClasses,
    resolveGroupHeaderStyle,
    resolveHeaderClasses,
    resolveHeaderStyle,
} from "./styling";

interface TestRow {
    id: string;
    department: string;
    revenue: number;
    expenses: number;
}

describe("Styling architecture", () => {
    describe("1. Column Data Body (ColumnLeafDef)", () => {
        const dummyApi: GridApi<TestRow> = {} as GridApi<TestRow>;
        const dummyState: GridState<TestRow> = {} as GridState<TestRow>;

        const testRows: TestRow[] = [
            { id: "1", department: "Engineering", revenue: 500000, expenses: 600000 },
            { id: "2", department: "Sales", revenue: 800000, expenses: 550000 },
        ];

        it("evaluates column presentation once across the column dataset via ColumnStyleParams", () => {
            let calculationCount: number = 0;

            const column: ColumnLeafDef<TestRow> = {
                id: "expenses",
                header: "Expenses",
                field: "expenses",
                getColumnStyle: (params: ColumnStyleParams<TestRow>): ColumnStyle | undefined => {
                    calculationCount += 1;
                    const total: number = params.values.reduce(
                        (sum: number, val: unknown): number => sum + Number(val || 0),
                        0,
                    );

                    if (total > 1000000) {
                        return {
                            backgroundColor: "#FEF2F2",
                            borderLeft: "2px dashed #EF4444",
                        };
                    }
                    return {
                        backgroundColor: "#F9FAFB",
                    };
                },
                getColumnClass: (params: ColumnStyleParams<TestRow>): string => `col-count-${params.values.length}`,
                columnClassRules: {
                    "is-expensive-column": (params: ColumnStyleParams<TestRow>): boolean => {
                        const sum: number = params.values.reduce((acc: number, v: unknown): number => acc + Number(v || 0), 0);
                        return sum > 1000000;
                    },
                },
            };

            const columnValues: number[] = testRows.map((r: TestRow): number => r.expenses); // [600000, 550000] sum = 1150000
            const columnParams: ColumnStyleParams<TestRow> = {
                column,
                values: columnValues,
                api: dummyApi,
                state: dummyState,
            };

            const presentation: ResolvedColumnPresentation = resolveColumnPresentation(column, columnParams);

            expect(calculationCount).toBe(1);
            expect(presentation.style).toEqual({
                backgroundColor: "#FEF2F2",
                borderLeft: "2px dashed #EF4444",
            });
            expect(presentation.classes).toBe("is-expensive-column col-count-2");
        });

        it("applies precomputed column presentation to cells and allows cell-level overrides", () => {
            const column: ColumnLeafDef<TestRow> = {
                id: "expenses",
                header: "Expenses",
                field: "expenses",
                cellStyle: { borderLeft: "2px solid #000000" }, // cellStyle overrides the precomputed column style
                getCellStyle: (params: CellRenderParams<TestRow>): RowStyle => ({
                    color: params.data.expenses > 580000 ? "red" : "green",
                }),
                cellClass: "cell-custom",
                cellClassRules: {
                    "cell-high": (params: CellRenderParams<TestRow>): boolean => params.data.expenses > 580000,
                },
            };

            const precomputedStyle: ColumnStyle = {
                backgroundColor: "#FEF2F2",
                borderLeft: "2px dashed #EF4444",
            };
            const precomputedClasses: string = "col-expenses-base is-expensive-column";

            const cellParams1: CellRenderParams<TestRow> = {
                id: testRows[0].id,
                index: 0,
                data: testRows[0],
                column,
                value: testRows[0].expenses,
            };

            const resolvedStyle1: RowStyle = resolveCellStyle(column, cellParams1, precomputedStyle);
            const resolvedClasses1: string = resolveCellClasses(column, cellParams1, precomputedClasses);

            expect(resolvedStyle1).toEqual({
                backgroundColor: "#FEF2F2",
                borderLeft: "2px solid #000000", // cell-level override wins
                color: "red",
            });
            expect(resolvedClasses1).toBe("col-expenses-base is-expensive-column cell-custom cell-high");

            const cellParams2: CellRenderParams<TestRow> = {
                id: testRows[1].id,
                index: 1,
                data: testRows[1],
                column,
                value: testRows[1].expenses,
            };

            const resolvedStyle2: RowStyle = resolveCellStyle(column, cellParams2, precomputedStyle);
            const resolvedClasses2: string = resolveCellClasses(column, cellParams2, precomputedClasses);

            expect(resolvedStyle2).toEqual({
                backgroundColor: "#FEF2F2",
                borderLeft: "2px solid #000000",
                color: "green",
            });
            expect(resolvedClasses2).toBe("col-expenses-base is-expensive-column cell-custom");
        });
    });

    describe("2. Leaf Header (ColumnLeafDef)", () => {
        it("resolves static and dynamic headerStyle", () => {
            const column: ColumnLeafDef<TestRow> = {
                id: "revenue",
                header: "Revenue",
                field: "revenue",
                headerStyle: { color: "blue", textTransform: "uppercase" },
                getHeaderStyle: ({ column: col }: HeaderRenderParams<TestRow>): HeaderStyle => ({
                    letterSpacing: col.id === "revenue" ? "1px" : "0px",
                }),
            };

            const params: HeaderRenderParams<TestRow> = { column, index: 1 };
            const style: HeaderStyle = resolveHeaderStyle(column, params);

            expect(style).toEqual({
                color: "blue",
                textTransform: "uppercase",
                letterSpacing: "1px",
            });
        });

        it("resolves headerClass, getHeaderClass, and headerClassRules with fullHeight handling", () => {
            const column: ColumnLeafDef<TestRow> = {
                id: "revenue",
                header: "Revenue",
                field: "revenue",
                sortable: true,
                headerClass: ({ column: col }: HeaderRenderParams<TestRow>): string => `hdr-leaf-${col.id}`,
                getHeaderClass: (): string => "hdr-dynamic-leaf",
                headerClassRules: {
                    "is-sortable": ({ column: col }: HeaderRenderParams<TestRow>): boolean => Boolean(col.sortable),
                    "is-hidden": ({ column: col }: HeaderRenderParams<TestRow>): boolean => Boolean(col.hidden),
                },
            };

            const params: HeaderRenderParams<TestRow> = { column, index: 0 };
            const regularClasses: string = resolveHeaderClasses(column, params, false);
            expect(regularClasses).toBe("omnigrid-header-cell hdr-leaf-revenue is-sortable hdr-dynamic-leaf");

            const fullHeightClasses: string = resolveHeaderClasses(column, params, true);
            expect(fullHeightClasses).toBe("omnigrid-header-cell omnigrid-header-cell-full-height hdr-leaf-revenue is-sortable hdr-dynamic-leaf");
        });
    });

    describe("3. Column Group Headers (ColumnGroupDef)", () => {
        it("resolves group headerStyle and getHeaderStyle with context", () => {
            const group: ColumnGroupDef<TestRow> = {
                id: "finance",
                header: "Finance",
                headerStyle: { backgroundColor: "#1e293b", color: "#f8fafc" },
                getHeaderStyle: ({ group: grp, depth }: HeaderGroupRenderParams<TestRow>): HeaderStyle => ({
                    borderTop: depth === 0 ? "2px solid #3b82f6" : "none",
                    opacity: grp.id === "finance" ? 1 : 0.8,
                }),
                children: [],
            };

            const params: HeaderGroupRenderParams<TestRow> = {
                group,
                column: group,
                depth: 0,
                columnCount: 2,
            };

            const style: HeaderStyle = resolveGroupHeaderStyle(group, params);
            expect(style).toEqual({
                backgroundColor: "#1e293b",
                color: "#f8fafc",
                borderTop: "2px solid #3b82f6",
                opacity: 1,
            });
        });

        it("resolves group headerClass, getHeaderClass, and headerClassRules", () => {
            const group: ColumnGroupDef<TestRow> = {
                id: "finance",
                header: "Finance",
                headerClass: ({ depth }: HeaderGroupRenderParams<TestRow>): string => `group-level-${depth}`,
                getHeaderClass: ({ column }: HeaderGroupRenderParams<TestRow>): string => `group-${column.id}`,
                headerClassRules: {
                    "wide-group": ({ columnCount }: HeaderGroupRenderParams<TestRow>): boolean => (columnCount ?? 0) >= 2,
                    "single-col-group": ({ columnCount }: HeaderGroupRenderParams<TestRow>): boolean => (columnCount ?? 0) === 1,
                },
                children: [],
            };

            const params: HeaderGroupRenderParams<TestRow> = {
                group,
                column: group,
                depth: 1,
                columnCount: 3,
            };

            const classes: string = resolveGroupHeaderClasses(group, params);
            expect(classes).toBe("omnigrid-header-cell omnigrid-header-group-cell group-level-1 wide-group group-finance");
        });
    });
});
