/**
 * @file Core overlay management types and evaluation logic.
 *
 * Overlays are full-body UI states shown over the grid's data viewport
 * (below the sticky header). They communicate transient states to the user:
 * data fetching, empty results, errors, and arbitrary custom content.
 */

/**
 * Supported overlay types shown over the grid body viewport.
 *
 * @api
 */
export type OverlayType = "loading" | "noRows" | "noMatchingRows" | "error" | "custom";

/**
 * Ephemeral overlay state — which overlay (if any) is active and its payload.
 *
 * @api
 */
export interface OverlayState {
    /** Active overlay type, or null when no overlay is shown. */
    type: OverlayType | null;
    /** Optional payload (e.g. error details, or data for a custom overlay). */
    payload?: unknown;
}

interface EvaluateAutoOverlayParams<T> {
    /** Whether the grid is currently fetching / loading data. */
    loading: boolean;
    /** The raw data array held by the grid (before pipeline processors). */
    rawData: T[];
    /** The data array after all pipeline processors (sorting, filtering, pagination). */
    processedData: T[];
}

/**
 * Evaluates which overlay should be automatically shown based on Data Pipeline state.
 *
 * Priority order:
 * 1. `loading` → `"loading"` (fetch in progress, shown regardless of data)
 * 2. `processedData` empty + `rawData` empty → `"noRows"` (no data at all)
 * 3. `processedData` empty + `rawData` non-empty → `"noMatchingRows"` (filters excluded everything)
 * 4. otherwise → `null` (no overlay)
 *
 * @param params - The current pipeline state.
 * @returns The overlay type to show, or null when no overlay is needed.
 * @internal
 */
export function evaluateAutoOverlay<T>(params: EvaluateAutoOverlayParams<T>): OverlayType | null {
    if (params.loading) return "loading";
    if (params.processedData.length === 0) {
        return params.rawData.length === 0 ? "noRows" : "noMatchingRows";
    }
    return null;
}
