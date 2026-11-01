import type { BlockConfig, IconDefinition, SlotPosition } from "@omnigrid/core";

/**
 * Current pagination values, including the computed number of pages.
 */
export interface PaginationState {
    /** The active page number, starting at 1. */
    page: number;
    /** The configured page size, or 0 when automatic sizing is enabled. */
    pageSize: number;
    /** Total number of rows in the dataset. */
    totalRows: number;
    /** Total number of pages, with a minimum of 1. */
    totalPages: number;
}

declare module "@omnigrid/core" {
    interface PluginStateExtensions<T> {
        /** Active pagination state. */
        pagination?: PaginationState;
    }

    interface PluginApiExtensions<T> {
        /** Sets the active page number (1-based). */
        setPage?: (page: number) => void;
        /** Sets the number of rows per page. */
        setPageSize?: (pageSize: number) => void;
        /** Returns current pagination state. */
        getPaginationState?: () => PaginationState;
    }
}


/**
 * Labels and formatter callbacks used by pagination controls.
 */
export interface PaginationLabels {
    /** Accessible label for the first-page control. */
    firstAriaLabel?: string;
    /** Accessible label for the previous-page control. */
    prevAriaLabel?: string;
    /** Accessible label for the next-page control. */
    nextAriaLabel?: string;
    /** Accessible label for the last-page control. */
    lastAriaLabel?: string;
    /** Formats the current page and total page count when quick jump is disabled. */
    pageInfo?: (page: number, totalPages: number) => string;
    /** Formats the visible row range and total row count. */
    rowInfo?: (from: number, to: number, totalRows: number) => string;
    /** Visible label for the page-size selector. */
    pageSizeLabel?: string;
    /** Accessible label for the page-size options menu. */
    pageSizesLabel?: string;
    /** Formats the total page count shown next to the quick-jump input. */
    pageCount?: (totalPages: number) => string;
}

/** Name of one of the four page-navigation icons. */
export type PaginationIconName = "first" | "prev" | "next" | "last";
/** Name of a pagination control block. */
export type PaginationBlockName = "rowInfo" | "pageSize" | "navigation";

/** Grid slot where pagination controls can be rendered. */
export type PaginationSlotName = "top" | "bottom";

/**
 * Placement of a pagination block in the grid's top or bottom slot.
 */
export type PaginationBlockConfig = Omit<BlockConfig<PaginationBlockName>, "slot"> & {
    slot?: PaginationSlotName;
};

/** A pagination block name or its placement configuration. */
export type PaginationBlockOption = PaginationBlockName | PaginationBlockConfig;

/**
 * Configuration for the pagination plugin.
 */
export interface PaginationPluginOptions<T> {
    /**
     * Number of rows per page. Set to 0 to fit whole rows into the grid viewport.
     * @default 50
     */
    pageSize?: number;
    /**
     * Numeric page-size choices shown in the selector. A custom positive pageSize is added automatically.
     * When automatic sizing is enabled, an Auto choice is prepended.
     * @default [20, 50, 100]
     */
    pageSizes?: number[];
    /**
     * Client mode slices data locally; server mode leaves fetching to the host.
     * @default "client"
     */
    mode?: "client" | "server";
    /**
     * Total dataset size, primarily used to calculate pages in server mode.
     */
    totalRows?: number;
    /**
     * Called in server mode when the requested page or page size changes.
     */
    onChange?: (params: { page: number; pageSize: number }) => void;
    /**
     * Page to show initially. Page numbers start at 1.
     * @default 1
     */
    initialPage?: number;
    /**
     * Default slot for blocks that do not specify their own slot.
     * @default "bottom"
     */
    slot?: PaginationSlotName;
    /**
     * Default alignment for blocks that do not specify their own position.
     * @default "end"
     */
    position?: SlotPosition;
    /**
     * Default render priority for blocks that do not specify their own priority. Lower values render first.
     * @default 0
     */
    priority?: number;
    /**
     * Visible blocks and their order or individual placement. Available names are rowInfo, pageSize, and navigation.
     * @default ["navigation"]
     */
    blocks?: PaginationBlockOption[];
    /**
     * Show an input for entering a page number in the navigation block.
     * @default false
     */
    quickJump?: boolean;
    /**
     * Width of the page-number input in characters when quickJump is enabled.
     * @default 2
     */
    pageInputCharacters?: number;
    /** Custom accessible labels and pagination text formatters. */
    labels?: PaginationLabels;
    /** Custom icon definitions for the first, previous, next, and last controls. */
    icons?: Partial<Record<PaginationIconName, IconDefinition<T>>>;
}
