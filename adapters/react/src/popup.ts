import type { CSSProperties, ReactNode } from "react";
import { createElement, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { GridApi, SlotRenderContext, UIPopupDescriptor } from "@omnigrid/core";

import type { ContentBridge } from "./content";
import { contentToReactNode } from "./content";
import type { PopupHostProps } from "./types";

const VIEWPORT_MARGIN: number = 8;

export function clampPopupLeft(desiredLeft: number, popupWidth: number, minLeft: number, maxRight: number): number {
    const maxLeft: number = Math.max(minLeft, maxRight - popupWidth);
    return Math.min(Math.max(desiredLeft, minLeft), maxLeft);
}

function anchorStyle(popup: UIPopupDescriptor): CSSProperties {
    const base: CSSProperties = { position: "absolute", zIndex: 1000 };
    const anchor = popup.anchor;
    if (!anchor) return { ...base, left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
    const top: number = anchor.y + (anchor.height ?? 0);
    if (popup.placement === "bottom-end") return { ...base, left: anchor.x + (anchor.width ?? 0), top, transform: "translateX(-100%)" };
    return { ...base, left: anchor.x, top };
}

/**
 * Renders the grid's active `UIPopupDescriptor`. Popup state lives here, so
 * opening or updating a popup never re-renders the grid body. The popup is
 * `position: fixed`, which keeps it out of the grid's layout and scroll flow.
 */
export function PopupHost<T>({ grid }: PopupHostProps<T>): ReactNode {
    const [popup, setPopup] = useState<UIPopupDescriptor | null>(() => grid.getPopup());
    const elementRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        setPopup(grid.getPopup());
        return grid.on("popupChange", setPopup);
    }, [grid]);

    const closeOnOutside: boolean = popup?.closeOnOutsideClick ?? true;
    const closeOnEscape: boolean = popup?.closeOnEscape ?? true;
    const isOpen: boolean = popup !== null;

    useEffect(() => {
        if (!isOpen) return undefined;
        const handlePointerDown = (event: PointerEvent): void => {
            if (!closeOnOutside) return;
            if (event.target instanceof Element && event.target.closest("[data-omnigrid-filter-trigger]")) return;
            const element = elementRef.current;
            if (element && event.target instanceof Node && !element.contains(event.target)) grid.closePopup();
        };
        const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
            if (closeOnEscape && event.key === "Escape") grid.closePopup();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown, true);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [grid, isOpen, closeOnOutside, closeOnEscape]);

    // Keep an anchored popup inside both the grid and the visible window.
    useLayoutEffect(() => {
        const element = elementRef.current;
        if (!element || !popup?.anchor) return;
        const parent = element.parentElement;
        const parentRect: DOMRect | null = parent?.getBoundingClientRect() ?? null;
        const parentLeft: number = parentRect?.left ?? 0;
        const minLeft: number = Math.max(VIEWPORT_MARGIN, parentLeft + VIEWPORT_MARGIN);
        const maxRight: number = Math.min(
            window.innerWidth - VIEWPORT_MARGIN,
            (parentRect?.right ?? window.innerWidth) - VIEWPORT_MARGIN,
        );
        const availableWidth: number = Math.max(0, maxRight - minLeft);
        element.style.maxWidth = `${availableWidth}px`;
        element.style.minWidth = `${Math.min(200, availableWidth)}px`;

        const rect: DOMRect = element.getBoundingClientRect();
        const anchorLeft: number = parentLeft + popup.anchor.x;
        const desiredLeft: number =
            popup.placement === "bottom-end" ? anchorLeft + (popup.anchor.width ?? 0) - rect.width : anchorLeft;
        const left: number = clampPopupLeft(desiredLeft, rect.width, minLeft, maxRight);
        element.style.transform = "none";
        element.style.left = `${left - parentLeft}px`;
    }, [popup]);

    if (!popup) return null;
    const bridge: ContentBridge<T> = {
        registry: {},
        context: (): SlotRenderContext<T> => ({ api: grid, state: grid.getState() }),
    };
    return createElement(
        "div",
        {
            key: popup.id,
            ref: elementRef,
            role: "dialog",
            "aria-label": popup.title ?? popup.id,
            className: ["omnigrid-popup", popup.className].filter(Boolean).join(" "),
            style: anchorStyle(popup),
        },
        popup.title ? createElement("div", { className: "omnigrid-popup-title" }, popup.title) : null,
        popup.controls.map((control) => contentToReactNode(control, bridge)),
    );
}
