import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import type { CellTooltipRenderContext, CellTooltipRenderer } from "./reactColumnDef";
import type { CellTooltipOptions } from "./types";

interface TooltipData {
    text: string;
    anchorRect: DOMRectReadOnly;
    pointer: { clientX: number; clientY: number } | null;
    source: CellTooltipRenderContext["source"];
    columnId?: string;
    placement: CellTooltipRenderContext["placement"];
    renderer?: CellTooltipRenderer;
    className?: string;
}

function isOverflowed(element: HTMLElement): boolean {
    if (element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight) return true;
    if (getComputedStyle(element).textOverflow !== "ellipsis") return false;

    const range: Range = document.createRange();
    range.selectNodeContents(element);
    return isTextOverflowed(range.getBoundingClientRect().width, element.getBoundingClientRect().width);
}

export function isTextOverflowed(textWidth: number, containerWidth: number): boolean {
    return textWidth - containerWidth > 1;
}

/** Props for the delegated tooltip layer mounted by the grid. */
export interface CellTooltipLayerProps {
    /** Viewport whose cell and header descendants are checked on pointer entry. */
    viewportRef: RefObject<HTMLDivElement | null>;
    /** Optional renderer for the truncated cell or header's full text. */
    renderer?: CellTooltipRenderer;
    /** Additional CSS class applied to the tooltip element. */
    className?: string;
    /** Resolves per-column tooltip overrides for hovered data cells. */
    resolveCellTooltip?: (columnId: string) => CellTooltipOptions | undefined;
}

/** Displays a tooltip only when hovered cell or header content exceeds its visible bounds. */
export function CellTooltipLayer({ viewportRef, renderer, className, resolveCellTooltip }: CellTooltipLayerProps): ReactNode {
    const [tooltip, setTooltip] = useState<TooltipData | null>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef(renderer);
    const classNameRef = useRef(className);
    const resolveCellTooltipRef = useRef(resolveCellTooltip);
    rendererRef.current = renderer;
    classNameRef.current = className;
    resolveCellTooltipRef.current = resolveCellTooltip;

    useEffect(() => {
        const viewport: HTMLDivElement | null = viewportRef.current;
        if (!viewport) return;

        let activeContainer: HTMLElement | null = null;
        let activeHoverTarget: HTMLElement | null = null;
        const dismiss = (): void => {
            activeContainer = null;
            activeHoverTarget = null;
            setTooltip(null);
        };
        const handlePointerOver = (event: PointerEvent): void => {
            if (!(event.target instanceof Element)) return;
            const container: HTMLElement | null = event.target.closest<HTMLElement>('[role="cell"], [role="columnheader"]');
            if (!container || !viewport.contains(container)) {
                dismiss();
                return;
            }
            if (activeContainer === container) {
                if (!activeHoverTarget?.contains(event.target)) dismiss();
                return;
            }

            const isCell: boolean = container.getAttribute("role") === "cell";
            const content: HTMLElement | null = isCell
                ? container.querySelector<HTMLElement>(".omnigrid-cell-content")
                : container.querySelector<HTMLElement>(".omnigrid-header-label") ?? container;
            if (!content) {
                dismiss();
                return;
            }
            if (!isCell && !content.contains(event.target)) {
                dismiss();
                return;
            }
            const nestedTruncation: HTMLElement | null = isCell ? content.querySelector<HTMLElement>(".omnigrid-cell-truncated") : null;
            const overflowTarget: HTMLElement | null = nestedTruncation && isOverflowed(nestedTruncation) ? nestedTruncation : isOverflowed(content) ? content : null;
            if (!overflowTarget) {
                dismiss();
                return;
            }
            const text: string = content.textContent ?? "";
            if (!text) {
                dismiss();
                return;
            }

            const rect: DOMRect = overflowTarget.getBoundingClientRect();
            activeContainer = container;
            activeHoverTarget = overflowTarget;
            const columnTooltip: CellTooltipOptions | undefined =
                isCell && container.dataset.columnId ? resolveCellTooltipRef.current?.(container.dataset.columnId) : undefined;
            setTooltip({
                text,
                anchorRect: rect,
                pointer: { clientX: event.clientX, clientY: event.clientY },
                source: isCell ? "cell" : "header",
                columnId: isCell ? container.dataset.columnId : undefined,
                placement: "bottom",
                renderer: columnTooltip?.renderer ?? rendererRef.current,
                className: columnTooltip?.className ?? classNameRef.current,
            });
        };
        const handlePointerOut = (event: PointerEvent): void => {
            if (!activeContainer || !(event.target instanceof Node) || !activeContainer.contains(event.target)) return;
            if (event.relatedTarget instanceof Node && activeContainer.contains(event.relatedTarget)) return;
            dismiss();
        };

        viewport.addEventListener("pointerover", handlePointerOver);
        viewport.addEventListener("pointerout", handlePointerOut);
        viewport.addEventListener("scroll", dismiss, { passive: true });
        window.addEventListener("scroll", dismiss, true);
        window.addEventListener("resize", dismiss);
        return () => {
            viewport.removeEventListener("pointerover", handlePointerOver);
            viewport.removeEventListener("pointerout", handlePointerOut);
            viewport.removeEventListener("scroll", dismiss);
            window.removeEventListener("scroll", dismiss, true);
            window.removeEventListener("resize", dismiss);
        };
    }, [viewportRef]);

    useLayoutEffect(() => {
        const element: HTMLDivElement | null = tooltipRef.current;
        if (!element || !tooltip) return;

        const rect: DOMRect = element.getBoundingClientRect();
        const left: number = Math.max(8, Math.min(tooltip.anchorRect.left, window.innerWidth - rect.width - 8));
        const belowTop: number = tooltip.anchorRect.bottom + 6;
        const placement: CellTooltipRenderContext["placement"] = belowTop + rect.height <= window.innerHeight - 8 ? "bottom" : "top";
        const top: number = placement === "bottom" ? belowTop : Math.max(8, tooltip.anchorRect.top - rect.height - 6);
        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
        element.dataset.placement = placement;
        const arrowX: number = tooltip.pointer?.clientX ?? tooltip.anchorRect.left + tooltip.anchorRect.width / 2;
        element.style.setProperty("--omnigrid-tooltip-arrow-x", `${Math.max(8, Math.min(arrowX - left, rect.width - 8))}px`);
        element.style.setProperty("--omnigrid-tooltip-arrow-y", placement === "bottom" ? "0px" : `${rect.height}px`);
        if (tooltip.placement !== placement) {
            setTooltip((current) => (current === tooltip ? { ...current, placement } : current));
        }
    }, [tooltip]);

    if (!tooltip) return null;

    const renderContext: CellTooltipRenderContext = {
        anchorRect: tooltip.anchorRect,
        pointer: tooltip.pointer,
        source: tooltip.source,
        columnId: tooltip.columnId,
        placement: tooltip.placement,
    };
    const content: ReactNode = tooltip.renderer ? tooltip.renderer(tooltip.text, renderContext) : tooltip.text;
    const tooltipClassName: string = ["omnigrid-cell-tooltip", tooltip.className].filter(Boolean).join(" ");
    return createPortal(
        <div ref={tooltipRef} className={tooltipClassName} role="tooltip" style={{ left: 0, top: 0 }}>
            {content}
        </div>,
        document.body,
    );
}
