import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Grid } from "@omnigrid/core";
import type { ColumnDef, UIControlDescriptor } from "@omnigrid/core";

import { contentToReactNode } from "./content";
import { isUIControlDescriptor, renderControl } from "./controls";
import { PopupHost } from "./popup";

describe("renderControl", () => {
    it("renders every control type with native elements", () => {
        const controls: UIControlDescriptor[] = [
            { id: "t", type: "text", label: "Name", value: "abc", placeholder: "Type", onChange: () => undefined },
            { id: "d", type: "date", label: "Date", value: "2026-01-01", onChange: () => undefined },
            { id: "s", type: "select", value: "b", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], onChange: () => undefined },
            { id: "ms", type: "multi-select", options: [{ value: "x", label: "Item X", checked: true }], onChange: () => undefined },
            { id: "c", type: "checkbox", label: "Match case", checked: true, onChange: () => undefined },
            { id: "b", type: "button", text: "Apply", variant: "primary", onClick: () => undefined },
            { id: "g", type: "group", direction: "row", children: [{ id: "l", type: "label", text: "Hello" }] },
        ];
        const html: string = renderToStaticMarkup(createElement(Fragment, null, controls.map(renderControl)));
        expect(html).toContain('class="omnigrid-control-input" type="text"');
        expect(html).toContain('class="omnigrid-control-input" type="date"');
        expect(html).toContain('value="abc"');
        expect(html).toContain('class="omnigrid-select-button"');
        expect(html).toContain('aria-haspopup="listbox"');
        expect(html).toContain('class="omnigrid-select-value">B</span>');
        expect(html).toContain('class="omnigrid-multi-select-container"');
        expect(html).toContain("Item X");
        expect(html).toContain('type="checkbox"');
        expect(html).toContain("omnigrid-control-button-primary");
        expect(html).toContain("omnigrid-control-group-row");
        expect(html).toContain("Hello");
    });

    it("is recognised by contentToReactNode", () => {
        const descriptor: UIControlDescriptor = { id: "b", type: "button", text: "Go", onClick: () => undefined };
        expect(isUIControlDescriptor(descriptor)).toBe(true);
        expect(isUIControlDescriptor({ type: "node", tag: "div" })).toBe(false);
        const html: string = renderToStaticMarkup(createElement(Fragment, null, contentToReactNode(descriptor, { registry: {}, context: () => ({}) as never })));
        expect(html).toContain(">Go</button>");
    });

    it("renders the descriptor icon before the control body when a resolver is provided", () => {
        const descriptor: UIControlDescriptor = { id: "t", type: "text", value: "", icon: "filter", onChange: () => undefined };
        const resolveIcon = (name: string): ReturnType<typeof createElement> => createElement("span", { className: `icon-${name}` }, "icon");
        const html: string = renderToStaticMarkup(createElement(Fragment, null, renderControl(descriptor, resolveIcon)));
        expect(html).toContain("omnigrid-control-body");
        expect(html.indexOf("icon-filter")).toBeLessThan(html.indexOf("omnigrid-control-input"));
    });

    it("renders the multi-select select-all checkbox checked when all options are selected", () => {
        const descriptor: UIControlDescriptor = {
            id: "ms",
            type: "multi-select",
            options: [
                { value: "a", label: "A", checked: true },
                { value: "b", label: "B", checked: true },
            ],
            onChange: () => undefined,
        };
        const html: string = renderToStaticMarkup(createElement(Fragment, null, renderControl(descriptor)));
        const actionsIndex: number = html.indexOf("omnigrid-multi-select-actions");
        const listIndex: number = html.indexOf("omnigrid-multi-select-list");
        const actionsHtml: string = html.slice(actionsIndex, listIndex);
        expect(actionsHtml).toContain("checked");
    });

    it("renders the multi-select select-all checkbox unchecked when only some options are selected", () => {
        const descriptor: UIControlDescriptor = {
            id: "ms",
            type: "multi-select",
            options: [
                { value: "a", label: "A", checked: true },
                { value: "b", label: "B", checked: false },
            ],
            onChange: () => undefined,
        };
        const html: string = renderToStaticMarkup(createElement(Fragment, null, renderControl(descriptor)));
        const actionsIndex: number = html.indexOf("omnigrid-multi-select-actions");
        const listIndex: number = html.indexOf("omnigrid-multi-select-list");
        const actionsHtml: string = html.slice(actionsIndex, listIndex);
        expect(actionsHtml).not.toContain("checked");
    });
});

describe("PopupHost", () => {
    interface Row {
        id: number;
    }

    const columns: ColumnDef<Row>[] = [{ id: "id", field: "id", header: "ID", width: 60 }];

    it("resolves control icons through the grid icon registry", () => {
        const grid = new Grid<Row>({ columns, data: [{ id: 1 }] });
        grid.openPopup({
            id: "test-popup",
            controls: [{ id: "f", type: "text", value: "", icon: "filter", onChange: () => undefined }],
        });

        const html: string = renderToStaticMarkup(createElement(PopupHost<Row>, { grid }));
        expect(html).toContain("omnigrid-popup");
        expect(html).toContain('class="omnigrid-icon omnigrid-icon-filter"');
        expect(html.indexOf("omnigrid-icon-filter")).toBeLessThan(html.indexOf("omnigrid-control-input"));
    });
});
