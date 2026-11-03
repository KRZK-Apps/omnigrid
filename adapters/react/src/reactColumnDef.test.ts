import type { ReactNode } from "react";

import type { CellRenderParams } from "@omnigrid/core";
import { describe, expectTypeOf, it } from "vitest";

import type { ColumnDef, ReactColumnLeafDef } from "./index";

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
});
