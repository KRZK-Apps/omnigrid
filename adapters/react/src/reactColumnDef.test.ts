import type { ReactNode } from "react";

import type { CellRenderParams } from "@omnigrid/core";
import { describe, expectTypeOf, it } from "vitest";

import type { ColumnDef, ReactColumnLeafDef, ReactGridOptions } from "./index";

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
});
