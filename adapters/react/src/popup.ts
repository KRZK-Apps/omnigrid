import type { CSSProperties, ReactNode } from "react";
import { createElement, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { GridApi, SlotRenderContext, UIPopupDescriptor } from "@omnigrid/core";

import type { ContentBridge } from "./content";
import { contentToReactNode } from "./content";

export interface PopupHostProps<T> {
    grid: GridApi<T>;
}

const VIEWPORT_MARGIN: number = 8;

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

    // Keep an anchored popup inside the window: a single measurement per popup change.
    useLayoutEffect(() => {
        const element = elementRef.current;
        if (!element || !popup?.anchor) return;
        const rect = element.getBoundingClientRect();
        const parent = element.parentElement;
        const parentRect = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };
        const maxLeft: number = Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - rect.width);
        const left: number = Math.min(Math.max(rect.left, VIEWPORT_MARGIN), maxLeft);
        if (left !== rect.left) {
            element.style.transform = "none";
            element.style.left = `${left - parentRect.left}px`;
        }
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
