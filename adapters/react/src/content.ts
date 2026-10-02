import type { ReactNode } from "react";
import { cloneElement, createElement, Fragment, isValidElement } from "react";

import type { CheckboxControl, SlotNodeContent, SlotRenderContext } from "@omnigrid/core";

/**
 * Bridge between the core's headless content and native adapter values.
 * `registry` — registry of React components for `SlotComponentContent`;
 * `context()` — factory for the current render context so providers see
 * up-to-date grid state at render time.
 */
export interface ContentBridge<T> {
    registry: Record<string, (payload: unknown, context: SlotRenderContext<T>) => ReactNode>;
    context: () => SlotRenderContext<T>;
}

export function isCheckboxControl(value: unknown): value is CheckboxControl {
    return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "@omnigrid/checkbox";
}

export function isSlotHtmlContent(value: unknown): value is { type: "html"; html: string } {
    return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "html";
}

export function isSlotNodeContent<T>(value: unknown): value is SlotNodeContent<T> {
    return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "node";
}

export function isSlotComponentContent(value: unknown): value is { type: "component"; kind: string; payload?: unknown } {
    return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "component";
}

function renderCheckboxControl(value: CheckboxControl): ReactNode {
    return createElement(
        "input",
        {
            type: "checkbox",
            className: "omnigrid-checkbox",
            checked: value.checked,
            disabled: value.disabled,
            "aria-label": value.ariaLabel,
            ref: (element: HTMLInputElement | null) => {
                if (element) element.indeterminate = value.indeterminate;
            },
            onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
            onChange: (event: { stopPropagation: () => void; nativeEvent: MouseEvent }) => {
                event.stopPropagation();
                value.onChange({ shiftKey: event.nativeEvent.shiftKey, ctrlKey: event.nativeEvent.ctrlKey });
            },
        },
        // NOTE: `input` is a void element — passing children (even an empty
        // array) throws in React 19 ("input is a void element tag and must
        // neither have `children` nor use `dangerouslySetInnerHTML`").
    );
}

const SLOT_NODE_EVENTS: Record<string, string> = {
    click: "onClick",
    change: "onChange",
    keydown: "onKeyDown",
};

const SLOT_NODE_ATTRS: Record<string, string> = {
    class: "className",
    for: "htmlFor",
    readonly: "readOnly",
};

function slotNodeToReact<T>(node: SlotNodeContent<T>, bridge: ContentBridge<T>): ReactNode {
    const context = bridge.context();
    const props: Record<string, unknown> = {};

    for (const [name, rawValue] of Object.entries(node.attrs ?? {})) {
        const key = SLOT_NODE_ATTRS[name] ?? name;
        if (typeof rawValue === "boolean") {
            if (rawValue) props[key] = true;
        } else if (rawValue !== undefined) {
            props[key] = String(rawValue);
        }
    }

    for (const [eventName, handler] of Object.entries(node.on ?? {})) {
        const reactEvent = SLOT_NODE_EVENTS[eventName];
        if (!reactEvent || !handler) continue;
        props[reactEvent] = (nativeEvent: { preventDefault: () => void; stopPropagation: () => void }) => {
            nativeEvent.preventDefault();
            nativeEvent.stopPropagation();
            handler(context);
        };
    }

    const children = (node.children ?? []).map((child, index) => {
        const rendered = contentToReactNode(child, bridge);
        return isValidElement(rendered) ? cloneElement(rendered, { key: index }) : createElement(Fragment, { key: index }, rendered);
    });
    return createElement(node.tag, props, children);
}

/**
 * Materialises the core's headless content into a ReactNode:
 *   - `string | number | boolean` → scalar;
 *   - CheckboxControl              → `<input type="checkbox">`;
 *   - `SlotNodeContent`            → declarative node (buttons etc.);
 *   - `SlotComponentContent`       → component from the adapter registry;
 *   - `SlotHtmlContent`            → `<div dangerouslySetInnerHTML>`;
 *   - anything else               → passthrough (ReactNode from cellRenderer).
 */
export function contentToReactNode<T>(content: unknown, bridge: ContentBridge<T>): ReactNode {
    if (content == null) return null;
    if (typeof content === "string" || typeof content === "number" || typeof content === "boolean") return content;
    if (isCheckboxControl(content)) return renderCheckboxControl(content);
    if (isSlotNodeContent<T>(content)) return slotNodeToReact(content, bridge);
    if (isSlotComponentContent(content)) {
        const renderer = bridge.registry[content.kind];
        if (renderer) return renderer(content.payload, bridge.context());
        return content.payload as ReactNode;
    }
    if (isSlotHtmlContent(content)) {
        return createElement("div", { dangerouslySetInnerHTML: { __html: content.html } });
    }
    return content as ReactNode;
}
