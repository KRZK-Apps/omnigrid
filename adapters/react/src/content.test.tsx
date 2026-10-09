import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ContentBridge } from "./content";
import { contentToReactNode } from "./content";

interface Row {
    id: string;
}

function bridge(): ContentBridge<Row> {
    return { registry: {}, context: () => ({}) as never };
}

function render(content: unknown): string {
    return renderToStaticMarkup(createElement(Fragment, null, contentToReactNode<Row>(content, bridge())));
}

describe("contentToReactNode", () => {
    it("renders slot nodes and html children without prop conflicts", () => {
        const html = render({
            type: "node",
            tag: "div",
            attrs: { class: "omnigrid-control-bar" },
            children: [
                { type: "node", tag: "button", attrs: { class: "omnigrid-icon-button" }, on: { click: () => {} }, children: ["Previous"] },
                { type: "html", html: "Page <b>1</b> of 3" },
                { type: "node", tag: "button", attrs: { class: "omnigrid-icon-button" }, on: { click: () => {} }, children: ["Next"] },
            ],
        });

        expect(html).toContain("omnigrid-control-bar");
        expect(html).toContain("Previous");
        expect(html).toContain("Next");
        expect(html).toContain("<b>1</b>");
    });

    it("renders html content without a `children` prop (no dangerouslySetInnerHTML conflict)", () => {
        const element = contentToReactNode<Row>({ type: "html", html: "hi" }, bridge()) as {
            props: { dangerouslySetInnerHTML?: unknown; children?: unknown };
        };

        expect(element.props.dangerouslySetInnerHTML).toEqual({ __html: "hi" });
        expect(element.props.children).toBeUndefined();
    });

    it("keys every child of a slot node so lists render without React key warnings", () => {
        const element = contentToReactNode<Row>(
            {
                type: "node",
                tag: "div",
                children: [
                    { type: "node", tag: "span", children: ["x"] },
                    { type: "node", tag: "span", children: ["y"] },
                ],
            },
            bridge(),
        ) as { props: { children: { key: string | null }[] } };

        expect(element.props.children.every((child) => child.key !== null)).toBe(true);
    });

    it("converts inline style strings into a React style object", () => {
        const element = contentToReactNode<Row>(
            {
                type: "node",
                tag: "span",
                attrs: { style: "display: block; width: 8px; background: rgba(0,0,0,0.5);" },
                children: ["x"],
            },
            bridge(),
        ) as { props: { style: Record<string, string> } };

        expect(element.props.style).toMatchObject({
            display: "block",
            width: "8px",
            background: "rgba(0,0,0,0.5)",
        });
    });

    it("renders checkbox controls", () => {
        const html = render({
            type: "@omnigrid/checkbox",
            checked: true,
            indeterminate: false,
            disabled: false,
            ariaLabel: "Select row",
            header: false,
            onChange: () => {},
        });

        expect(html).toContain('type="checkbox"');
        expect(html).toContain('class="omnigrid-checkbox"');
    });

    it("forwards values and keyboard keys to slot node handlers", () => {
        const onChange = vi.fn();
        const element = contentToReactNode<Row>(
            { type: "node", tag: "select", on: { change: onChange } },
            bridge(),
        ) as { props: { onChange: (event: unknown) => void } };

        element.props.onChange({
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            key: "Enter",
            currentTarget: { value: "100" },
        });

        expect(onChange).toHaveBeenCalledWith(expect.anything(), { value: "100", key: "Enter" });
    });

    it("prevents slot-node clicks from bubbling to parent handlers", () => {
        const onClick = vi.fn();
        const element = contentToReactNode<Row>(
            { type: "node", tag: "span", on: { click: onClick } },
            bridge(),
        ) as { props: { onClick: (event: unknown) => void } };
        const preventDefault = vi.fn();
        const stopPropagation = vi.fn();

        element.props.onClick({
            preventDefault,
            stopPropagation,
            currentTarget: {},
        });

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(stopPropagation).toHaveBeenCalledOnce();
        expect(onClick).toHaveBeenCalledOnce();
    });

    it("renders void slot nodes without passing children", () => {
        expect(() =>
            render({
                type: "node",
                tag: "input",
                attrs: { type: "number", value: 2 },
                children: ["must not be rendered"],
            }),
        ).not.toThrow();
        expect(render({ type: "node", tag: "input", attrs: { type: "number", value: 2 } })).toContain('<input type="number"');
    });
});
