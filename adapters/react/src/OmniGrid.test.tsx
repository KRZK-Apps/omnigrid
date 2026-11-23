import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ColumnDef } from "@omnigrid/core";

import { OmniGrid } from "./OmniGrid.js";
import type { GridProps } from "./types.js";

interface Row {
    id: string;
}

const columns: ColumnDef<Row>[] = [];
const data: Row[] = [];

function renderGrid(props: GridProps<Row>): string {
    return renderToStaticMarkup(createElement(OmniGrid<Row>, props));
}

describe("OmniGrid sizing", () => {
    it("fills the parent by default", () => {
        const html: string = renderGrid({ columns, data });

        expect(html).toContain('class="omnigrid-layout" style="height:100%;flex:1 1 0;min-height:0;position:relative"');
        expect(html).toContain('class="omnigrid"');
    });

    it("uses the height prop for fixed sizing", () => {
        const html: string = renderGrid({ columns, data, height: 480 });

        expect(html).toContain('class="omnigrid-layout" style="height:480px;position:relative"');
    });

    it("uses content height in auto mode instead of style.height", () => {
        const html: string = renderGrid({ columns, data, sizingMode: "auto", style: { height: 480 } });

        expect(html).not.toContain('class="omnigrid-layout" style="height:480px');
        expect(html).toContain("min-height:128px");
    });
});
