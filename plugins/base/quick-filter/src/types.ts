import type { SlotPosition } from "@omnigrid/core";

/**
 * Slots where the quick filter control can be mounted.
 *
 * @api
 */
export type QuickFilterSlotName = "top" | "bottom" | "down";

/**
 * Configuration options for the QuickFilterPlugin.
 *
 * @api
 */
export interface QuickFilterPluginOptions {
    /**
     * Debounce duration in milliseconds before input changes are submitted to the grid.
     * @default 150
     * @api
     */
    debounceMs?: number;

    /**
     * Target slot to mount the quick filter input.
     * Supports "top", "bottom", "down", "bodyTop", and "bodyBottom".
     * @default "top"
     * @api
     */
    slot?: QuickFilterSlotName;

    /**
     * Alignment position of the control within the target slot.
     * @default "start"
     * @api
     */
    position?: SlotPosition;

    /**
     * Render priority within the slot (lower values render first).
     * @default 0
     * @api
     */
    priority?: number;

    /**
     * Placeholder text displayed inside the search input.
     * @default "Search..."
     * @api
     */
    placeholder?: string;

    /**
     * Accessible label for the input element.
     * @default "Quick filter"
     * @api
     */
    ariaLabel?: string;

    /**
     * Initial quick filter query string applied when the plugin is registered.
     * @default ""
     * @api
     */
    initialValue?: string;
}
