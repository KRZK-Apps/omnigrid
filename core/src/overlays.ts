/**
 * @file Core overlay management types and evaluation logic.
 *
 * Overlays communicate transient states to the user: data fetching, empty
 * results, errors, and arbitrary custom content.
 */

/**
 * Supported overlay types shown over the grid body viewport.
 *
 * @api
 */
export type OverlayType = "loading" | "noRows" | "noMatchingRows" | "error" | "custom";

/**
 * Portion of the grid covered by an overlay.
 *
 * @api
 */
export type OverlayScope = "full" | "bodyOnly";

/**
 * Configuration for a manually displayed overlay.
 *
 * @api
 */
export interface OverlayOptions {
    /** Overlay state to display. */
    type: OverlayType;
    /** Whether the overlay covers the complete grid or only its data body. Defaults to "full" for errors and "bodyOnly" otherwise. */
    scope?: OverlayScope;
    /** Whether horizontal scrolling is locked. Vertical scrolling is locked for every active overlay. */
    blockScroll?: boolean;
    /** Optional text displayed by the default overlay or passed to a custom component. */
    message?: string;
    /** Custom renderer or adapter-specific renderer identifier. */
    component?: unknown;
    /** Optional data passed to a custom overlay or used to derive the default message. */
    payload?: unknown;
}

/**
 * Active overlay type, placement, scroll policy, and optional renderer payload.
 *
 * @api
 */
export interface OverlayState extends Omit<OverlayOptions, "type"> {
    /** Active overlay type, or null when no overlay is shown. */
    type: OverlayType | null;
}

interface EvaluateAutoOverlayParams<T> {
    /** Whether the grid is currently fetching / loading data. */
    loading: boolean;
    /** Error raised by the most recent data load, if any. */
    error?: unknown;
    /** The raw data array held by the grid (before pipeline processors). */
    rawData: T[];
    /** The data array after all pipeline processors (sorting, filtering, pagination). */
    processedData: T[];
}

/**
 * Evaluates which overlay should be automatically shown based on Data Pipeline state.
 *
 * Priority order is loading, load error, no rows, no matching rows, then no overlay.
 *
 * @param params - The current pipeline state.
 * @returns The overlay type to show, or null when no overlay is needed.
 * @internal
 */
export function evaluateAutoOverlay<T>(params: EvaluateAutoOverlayParams<T>): OverlayType | null {
    if (params.loading) return "loading";
    if (params.error !== undefined) return "error";
    if (params.processedData.length === 0) {
        return params.rawData.length === 0 ? "noRows" : "noMatchingRows";
    }
    return null;
}
