import { createElement } from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { UseGridResult } from "./types.js";
import { useGrid } from "./useGrid.js";

interface Row {
    id: string;
    displayName: string;
}

function InferredHeaders(): ReactElement {
    const { grid }: UseGridResult<Row> = useGrid<Row>({
        data: [{ id: "1", displayName: "Ada" }],
        autoColumnHeaderMode: "title-case",
    });

    return createElement("div", null, grid.getState().columns.map((column) => column.header).join("|"));
}

describe("useGrid automatic columns", () => {
    it("initializes the grid with columns inferred from data", () => {
        const html: string = renderToStaticMarkup(createElement(InferredHeaders));

        expect(html).toContain("Id|Display Name");
    });
});
