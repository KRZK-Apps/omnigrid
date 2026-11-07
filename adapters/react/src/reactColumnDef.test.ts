import type { ReactNode } from "react";

import type { CellRenderParams } from "@omnigrid/core";
import { describe, expectTypeOf, it } from "vitest";

import type { CellTooltipRenderContext, CellTooltipRenderer, ColumnDef, ReactColumnLeafDef, ReactGridOptions } from "./index";

interface Row {
    name: string;
}

describe("React column types", () => {
    it("requires cell renderers to return ReactNode", () => {
        type Renderer = NonNullable<ReactColumnLeafDef<Row>["cellRenderer"]>;

        expectTypeOf<ReturnType<Renderer>>().toEqualTypeOf<ReactNode>();

        const unknownRenderer = (_params: CellRenderParams<Row>): unknown => ({});
        const invalidColumn: ColumnDef<Row> = {
            id: "name",
            header: "Name",
            field: "name",
            // @ts-expect-error React adapter renderers must return ReactNode.
            cellRenderer: unknownRenderer,
        };
        void invalidColumn;
    });

    it("requires default cell renderers to return ReactNode", () => {
        const validRenderer = (_params: CellRenderParams<Row>): ReactNode => null;
        const options: ReactGridOptions<Row> = {
            columns: [],
            defaultColumnDef: { cellRenderer: validRenderer },
        };
        const unknownRenderer = (_params: CellRenderParams<Row>): unknown => ({});
        const invalidOptions: ReactGridOptions<Row> = {
            columns: [],
            defaultColumnDef: {
                // @ts-expect-error React adapter renderers must return ReactNode.
                cellRenderer: unknownRenderer,
            },
        };
        void options;
        void invalidOptions;
    });

    it("allows column tooltip overrides and default tooltip options", () => {
        const tooltipRenderer = (text: string): ReactNode => text;
        const column: ColumnDef<Row> = {
            id: "name",
            header: "Name",
            field: "name",
            cellTooltipRenderer: tooltipRenderer,
            cellTooltipClassName: "name-tooltip",
        };
        const options: ReactGridOptions<Row> = {
            columns: [column],
            defaultColumnDef: {
                cellTooltipRenderer: tooltipRenderer,
                cellTooltipClassName: "default-tooltip",
            },
        };

        expectTypeOf(column.cellTooltipRenderer).toEqualTypeOf<typeof tooltipRenderer | undefined>();
        expectTypeOf(options.defaultColumnDef?.cellTooltipClassName).toEqualTypeOf<string | undefined>();
    });

    it("keeps tooltip context optional for renderers", () => {
        const textOnlyRenderer: CellTooltipRenderer = (text) => text;
        const contextualRenderer: CellTooltipRenderer = (text, context?: CellTooltipRenderContext) =>
            context ? `${text}: ${context.source}` : text;

        expectTypeOf<Parameters<CellTooltipRenderer>[1]>().toEqualTypeOf<CellTooltipRenderContext | undefined>();
        void textOnlyRenderer;
        void contextualRenderer;
    });

    it("allows headerAlign with the same values as align", () => {
        const column: ColumnDef<Row> = {
            id: "name",
            header: "Name",
            field: "name",
            align: "center",
            headerAlign: "right",
        };
        const options: ReactGridOptions<Row> = {
            columns: [column],
            defaultColumnDef: {
                align: "left",
                headerAlign: "center",
            },
        };

        expectTypeOf(column.headerAlign).toEqualTypeOf<"left" | "center" | "right" | undefined>();
        expectTypeOf(options.defaultColumnDef?.headerAlign).toEqualTypeOf<"left" | "center" | "right" | undefined>();
        void options;

        const invalid: ColumnDef<Row> = {
            id: "name",
            header: "Name",
            // @ts-expect-error headerAlign only accepts CellAlign values.
            headerAlign: "justify",
        };
        void invalid;
    });
});
