import type { ReactNode } from "react";

import type { OverlayType, OverlayState } from "@omnigrid/core";

export interface OverlayProps {
    /** Active overlay state (type + optional payload). */
    overlay: OverlayState;
}

function extractMessage(payload: unknown, fallback: string): string {
    if (typeof payload === "string") return payload;
    if (payload instanceof Error) return payload.message;
    if (payload && typeof payload === "object" && "message" in payload) {
        return String((payload as { message: unknown }).message);
    }
    return fallback;
}

function LoadingOverlay(): ReactNode {
    return (
        <div className="omnigrid-overlay-content">
            <div className="omnigrid-overlay-spinner" aria-label="Loading" />
            <span className="omnigrid-overlay-text">Loading…</span>
        </div>
    );
}

function NoRowsOverlay(payload?: unknown): ReactNode {
    return (
        <div className="omnigrid-overlay-content">
            <NoRowsIcon />
            <span className="omnigrid-overlay-text">{extractMessage(payload, "No data to display")}</span>
        </div>
    );
}

function NoMatchingRowsOverlay(payload?: unknown): ReactNode {
    return (
        <div className="omnigrid-overlay-content">
            <NoMatchingRowsIcon />
            <span className="omnigrid-overlay-text">{extractMessage(payload, "No matching rows found")}</span>
        </div>
    );
}

function ErrorOverlay(payload?: unknown): ReactNode {
    return (
        <div className="omnigrid-overlay-content">
            <ErrorIcon />
            <span className="omnigrid-overlay-text" role="alert">
                {extractMessage(payload, "An error occurred")}
            </span>
        </div>
    );
}

type OverlayFactory = (payload?: unknown) => ReactNode;

const DEFAULT_OVERLAYS: Record<Exclude<OverlayType, "custom">, OverlayFactory> = {
    loading: LoadingOverlay,
    noRows: NoRowsOverlay,
    noMatchingRows: NoMatchingRowsOverlay,
    error: ErrorOverlay,
};

/**
 * Builds the default overlay content for a given overlay state.
 *
 * For `custom` overlays, this returns null — the payload is rendered
 * directly by `OmniGrid.renderOverlayContent` via `contentToReactNode`.
 */
export function renderDefaultOverlay(overlay: OverlayState): ReactNode {
    const { type, payload } = overlay;
    if (!type) return null;
    if (type === "custom") return null;

    const factory = DEFAULT_OVERLAYS[type];
    if (!factory) return null;
    return factory(payload);
}

/** Inline SVG: empty / document icon. */
function NoRowsIcon(): ReactNode {
    return (
        <svg
            className="omnigrid-overlay-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="8" y1="13" x2="16" y2="13" />
            <line x1="8" y1="17" x2="16" y2="17" />
        </svg>
    );
}

/** Inline SVG: no results / search icon. */
function NoMatchingRowsIcon(): ReactNode {
    return (
        <svg
            className="omnigrid-overlay-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="15.657" y2="15.657" />
            <circle cx="11" cy="11" r="1" />
            <line x1="8" y1="8" x2="8.5" y2="8.5" />
        </svg>
    );
}

/** Inline SVG: error / warning icon. */
function ErrorIcon(): ReactNode {
    return (
        <svg
            className="omnigrid-overlay-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
    );
}
