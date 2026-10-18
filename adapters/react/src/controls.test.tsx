import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { UIControlDescriptor } from "@omnigrid/core";

import { contentToReactNode } from "./content";
import { isUIControlDescriptor, renderControl } from "./controls";

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
});
