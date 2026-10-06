import type {
    BlockConfig,
    ColumnDef,
    GridApi,
    GridPlugin,
    IconDefinition,
    SlotContent,
    SlotMount,
    SlotNodeContent,
    SlotNodeEvent,
    SlotPosition,
    SlotRenderContext,
} from "@omnigrid/core";

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

/**
 * Placement of a pagination block in the grid's top or bottom slot.
 */
export type PaginationBlockConfig = Omit<BlockConfig<PaginationBlockName>, "slot"> & {
    slot?: PaginationSlotName;
};

/** A pagination block name or its placement configuration. */
export type PaginationBlockOption = PaginationBlockName | PaginationBlockConfig;
/** Grid slot where pagination controls can be rendered. */
export type PaginationSlotName = "top" | "bottom";

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

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZES = [20, 50, 100];
const ALL_BLOCKS: PaginationBlockName[] = ["rowInfo", "pageSize", "navigation"];
const DEFAULT_BLOCKS: PaginationBlockName[] = ["navigation"];
const SLOT_ID = "@omnigrid/pagination";

const DEFAULT_LABELS: Required<PaginationLabels> = {
    firstAriaLabel: "First page",
    prevAriaLabel: "Previous page",
    nextAriaLabel: "Next page",
    lastAriaLabel: "Last page",
    pageInfo: (page, totalPages) => `Page <b>${page}</b> of ${totalPages}`,
    rowInfo: (from, to, totalRows) => `Rows ${from}–${to} of ${totalRows}`,
    pageSizeLabel: "Page Size:",
    pageSizesLabel: "Select rows per page",
    pageCount: (totalPages) => `of ${totalPages}`,
};

const DEFAULT_ICONS: Record<PaginationIconName, string> = {
    first: "chevron-first",
    prev: "chevron-left",
    next: "chevron-right",
    last: "chevron-last",
};

function clampPage(page: number, totalPages: number): number {
    return Math.min(Math.max(1, page), Math.max(1, totalPages));
}

function getGroupHeaderRowCount<T>(columns: ColumnDef<T>[]): number {
    let deepestGroup = -1;

    const visit = (definitions: ColumnDef<T>[], depth: number): boolean => {
        let hasVisibleLeaf = false;
        for (const definition of definitions) {
            if ("children" in definition) {
                if (visit(definition.children, depth + 1)) {
                    deepestGroup = Math.max(deepestGroup, depth);
                    hasVisibleLeaf = true;
                }
            } else if (!definition.hidden) {
                hasVisibleLeaf = true;
            }
        }
        return hasVisibleLeaf;
    };

    visit(columns, 0);
    return deepestGroup + 1;
}

/**
 * Adds client- or server-side pagination and navigation controls to a grid.
 */
export class PaginationPlugin<T> implements GridPlugin<T> {
    public readonly name = "@omnigrid/pagination-plugin";
    private api: GridApi<T> | undefined;
    private page: number;
    private pageSize: number;
    private readonly pageSizes: number[];
    private readonly autoPageSizeEnabled: boolean;
    private totalRows = 0;
    private pageSizesOpen = false;
    private pageInputValue: string | undefined;
    private unregisterProcessor: (() => void) | undefined;
    private slotMounts: SlotMount<T>[] = [];
    private labels: Required<PaginationLabels>;
    private readonly icons: PaginationPluginOptions<T>["icons"];
    private readonly blockConfigs: PaginationBlockConfig[];
    private readonly quickJump: boolean;
    private readonly pageInputCharacters: number;
    private readonly mode: "client" | "server";
    private readonly onChange: PaginationPluginOptions<T>["onChange"];
    private unsubscribeViewport: (() => void) | undefined;
    private unsubscribeState: (() => void) | undefined;
    private lastAutoPageSize: number | undefined;

    public constructor(options: PaginationPluginOptions<T> = {}) {
        this.pageSizes = [...(options.pageSizes ?? DEFAULT_PAGE_SIZES)];
        if (this.pageSizes.length === 0 || this.pageSizes.some((size) => !Number.isInteger(size) || size <= 0)) {
            throw new Error("Pagination pageSizes must contain positive integers");
        }
        if (new Set(this.pageSizes).size !== this.pageSizes.length) {
            throw new Error("Pagination pageSizes must not contain duplicates");
        }
        this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
        if (!Number.isInteger(this.pageSize) || this.pageSize < 0) {
            throw new Error("Pagination pageSize must be a non-negative integer");
        }
        this.autoPageSizeEnabled = this.pageSize === 0;
        if (this.pageSize > 0 && !this.pageSizes.includes(this.pageSize)) {
            this.pageSizes.push(this.pageSize);
            this.pageSizes.sort((left, right) => left - right);
        }
        this.mode = options.mode ?? "client";
        this.onChange = options.onChange;
        if (this.mode === "server" && !this.onChange) {
            throw new Error("Pagination server mode requires an onChange callback");
        }
        if (options.totalRows !== undefined && (!Number.isInteger(options.totalRows) || options.totalRows < 0)) {
            throw new Error("Pagination totalRows must be a non-negative integer");
        }
        this.totalRows = options.totalRows ?? 0;
        this.page = Math.max(1, options.initialPage ?? 1);
        this.labels = {
            ...DEFAULT_LABELS,
            ...(options.labels ?? {}),
            pageInfo: options.labels?.pageInfo ?? DEFAULT_LABELS.pageInfo,
            pageCount: options.labels?.pageCount ?? DEFAULT_LABELS.pageCount,
        };
        this.icons = options.icons;
        this.quickJump = options.quickJump ?? false;
        this.pageInputCharacters = options.pageInputCharacters ?? 2;
        if (!Number.isInteger(this.pageInputCharacters) || this.pageInputCharacters < 1) {
            throw new Error("Pagination pageInputCharacters must be a positive integer");
        }

        const rawBlocks = options.blocks ?? DEFAULT_BLOCKS;
        this.blockConfigs = rawBlocks.map((item) => {
            if (typeof item === "string") {
                return {
                    name: item,
                    slot: options.slot ?? "bottom",
                    position: options.position ?? "end",
                    priority: options.priority ?? 0,
                };
            }
            return {
                name: item.name,
                slot: item.slot ?? options.slot ?? "bottom",
                position: item.position ?? options.position ?? "end",
                priority: item.priority ?? options.priority ?? 0,
            };
        });

        const blockNames = this.blockConfigs.map((config) => config.name);
        if (new Set(blockNames).size !== blockNames.length || blockNames.some((block) => !ALL_BLOCKS.includes(block))) {
            throw new Error("Pagination blocks must contain unique valid block names");
        }
        if (this.blockConfigs.some((config) => ["left", "right"].includes(config.slot ?? ""))) {
            throw new Error("Pagination blocks can only be placed in the top or bottom slot");
        }
    }

    public register(api: GridApi<T>): () => void {
        this.api = api;
        if (this.mode === "client") {
            this.unregisterProcessor = api.registerDataProcessor((data) => this.applyPagination(data));
        }
        this.lastAutoPageSize = this.pageSize === 0 ? this.getEffectivePageSize() : undefined;
        this.unsubscribeViewport = api.on("viewportChange", () => this.handleViewportChange());
        this.unsubscribeState = api.on("stateChange", () => this.handleViewportChange());

        this.slotMounts = this.blockConfigs.map((config) => {
            const id = `${SLOT_ID}:${config.name}`;
            return api.slots.mount(
                config.slot ?? "bottom",
                (context: SlotRenderContext<T>) => this.renderBlock(config.name, context),
                {
                    id,
                    priority: config.priority ?? 0,
                    position: config.position ?? "end",
                },
            );
        });

        return () => {
            this.unregisterProcessor?.();
            this.unregisterProcessor = undefined;
            this.unsubscribeViewport?.();
            this.unsubscribeViewport = undefined;
            this.unsubscribeState?.();
            this.unsubscribeState = undefined;
            this.slotMounts.forEach((mount) => mount.unmount());
            this.slotMounts = [];
            this.api = undefined;
        };
    }

    /**
     * Returns the current page, page size, total rows, and computed total pages.
     * @api
     */
    public getState(): PaginationState {
        const totalPages = Math.max(1, Math.ceil(this.totalRows / this.getEffectivePageSize()));
        return {
            page: clampPage(this.page, totalPages),
            pageSize: this.pageSize,
            totalRows: this.totalRows,
            totalPages,
        };
    }

    /**
     * Navigates to a specific 1-based page number, clamped to the available page range.
     * In server mode, calls onChange when the requested page changes.
     * @api
     */
    public goToPage(page: number): void {
        const state = this.getState();
        const nextPage = clampPage(page, state.totalPages);
        const pageChanged = nextPage !== this.page;
        this.page = nextPage;
        this.pageInputValue = String(nextPage);
        if (pageChanged) {
            this.refresh();
            this.requestPage();
        } else if (this.api && !this.api.isDestroyed()) {
            this.api.refresh();
        }
    }

    /**
     * Advances to the next page.
     * @api
     */
    public nextPage(): void {
        this.goToPage(this.page + 1);
    }

    /**
     * Returns to the previous page.
     * @api
     */
    public prevPage(): void {
        this.goToPage(this.page - 1);
    }

    /**
     * Sets the page size and returns to the first page. In server mode, calls onChange.
     * Use 0 only when the plugin was configured with pageSize: 0.
     * @api
     */
    public setPageSize(pageSize: number): void {
        if (pageSize === 0 && !this.autoPageSizeEnabled) {
            throw new Error("Automatic pagination requires pageSize: 0 in the plugin options");
        }
        if (pageSize !== 0 && !this.pageSizes.includes(pageSize)) {
            throw new Error(`Unsupported pagination page size: ${pageSize}`);
        }
        if (pageSize === this.pageSize) return;
        this.pageSize = pageSize;
        this.page = 1;
        this.pageSizesOpen = false;
        this.lastAutoPageSize = pageSize === 0 ? this.getEffectivePageSize() : undefined;
        this.refresh();
        this.requestPage();
    }

    /**
     * Updates the total dataset size, primarily for server-side pagination.
     * @api
     */
    public setTotalRows(totalRows: number): void {
        if (!Number.isInteger(totalRows) || totalRows < 0) {
            throw new Error("Pagination totalRows must be a non-negative integer");
        }
        this.totalRows = totalRows;
        const totalPages = Math.max(1, Math.ceil(totalRows / this.getEffectivePageSize()));
        const nextPage = clampPage(this.page, totalPages);
        const pageChanged = nextPage !== this.page;
        this.page = nextPage;
        if (pageChanged) this.pageInputValue = String(nextPage);
        if (this.api && !this.api.isDestroyed()) this.api.refresh();
        if (pageChanged) this.requestPage();
    }

    private applyPagination(data: T[]): T[] {
        this.totalRows = data.length;
        const pageSize = this.getEffectivePageSize();
        const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
        if (this.page > totalPages) {
            this.page = totalPages;
            this.pageInputValue = String(totalPages);
        }
        const start = (this.page - 1) * pageSize;
        return data.slice(start, start + pageSize);
    }

    private refresh(): void {
        if (!this.api || this.api.isDestroyed()) return;
        this.api.setViewport({ scrollTop: 0 });
        if (this.mode === "client") {
            this.api.setData(this.api.getState().data);
        } else {
            this.api.refresh();
        }
    }

    private getEffectivePageSize(): number {
        if (this.pageSize !== 0 || !this.api) return this.pageSize || 1;
        const state = this.api.getState();
        const headerHeight = (getGroupHeaderRowCount(state.columns) + 1) * state.rowHeight;
        const rowsHeight = Math.max(0, state.viewport.height - headerHeight);
        return Math.max(1, Math.floor(rowsHeight / state.rowHeight));
    }

    private handleViewportChange(): void {
        if (this.pageSize !== 0) return;
        const pageSize = this.getEffectivePageSize();
        if (pageSize === this.lastAutoPageSize) return;
        this.lastAutoPageSize = pageSize;
        const totalPages = Math.max(1, Math.ceil(this.totalRows / pageSize));
        const nextPage = clampPage(this.page, totalPages);
        const pageChanged = nextPage !== this.page;
        this.page = nextPage;
        this.pageInputValue = String(nextPage);
        this.refresh();
        if (this.mode === "server" || pageChanged) this.requestPage();
    }

    private requestPage(): void {
        if (this.mode === "server") {
            this.onChange?.({ page: this.page, pageSize: this.getEffectivePageSize() });
        }
    }

    private getIcon(name: PaginationIconName): SlotNodeContent<T> {
        const icon = this.icons?.[name];
        if (icon) return typeof icon === "function" ? icon() : icon;
        if (!this.api) throw new Error("Pagination plugin is not registered");
        return this.api.icons.get(DEFAULT_ICONS[name]);
    }

    private renderBlock(name: PaginationBlockName, context: SlotRenderContext<T>): SlotContent {
        const state = this.getState();
        if (name === "rowInfo") {
            const pageSize = this.getEffectivePageSize();
            const from = state.totalRows === 0 ? 0 : (state.page - 1) * pageSize + 1;
            const to = Math.min(state.page * pageSize, state.totalRows);
            return {
                key: name,
                type: "html",
                html: this.labels.rowInfo(from, to, state.totalRows),
            };
        }
        if (name === "pageSize") {
            return {
                key: name,
                type: "node",
                tag: "div",
                attrs: { class: "omnigrid-popup-control" },
                children: [
                    {
                        type: "node",
                        tag: "span",
                        attrs: { class: "omnigrid-popup-label" },
                        children: [this.labels.pageSizeLabel],
                    },
                    {
                        type: "node",
                        tag: "div",
                        attrs: {
                            class: "omnigrid-popup-anchor",
                        },
                        children: [
                            {
                                type: "node",
                                tag: "button",
                                attrs: {
                                    type: "button",
                                    class: "omnigrid-control-button",
                                    "aria-haspopup": "listbox",
                                    "aria-expanded": this.pageSizesOpen,
                                    "aria-label": `${this.labels.pageSizeLabel} ${state.pageSize === 0 ? "Auto" : state.pageSize}`,
                                },
                                on: {
                                    click: () => {
                                        this.pageSizesOpen = !this.pageSizesOpen;
                                        if (this.api && !this.api.isDestroyed()) this.api.refresh();
                                    },
                                },
                                children: [state.pageSize === 0 ? "Auto" : String(state.pageSize)],
                            },
                            ...(this.pageSizesOpen ? [{
                                type: "node" as const,
                                tag: "div",
                                attrs: {
                                    class: `omnigrid-popup-menu${context.slot === "top" ? " omnigrid-popup-menu-below" : ""}`,
                                    role: "listbox",
                                    "aria-label": this.labels.pageSizesLabel,
                                },
                                children: [...(this.autoPageSizeEnabled ? [0] : []), ...this.pageSizes].map((size) => ({
                                    type: "node" as const,
                                    tag: "button",
                                    attrs: {
                                        type: "button",
                                        class: "omnigrid-popup-option",
                                        role: "option",
                                        "aria-selected": size === state.pageSize,
                                    },
                                    on: { click: () => this.setPageSize(size) },
                                    children: [size === 0 ? "Auto" : String(size)],
                                })),
                            }] : []),
                        ],
                    },
                ],
            };
        }
        const lastPage = state.totalPages;
        return {
            key: name,
            type: "node",
            tag: "div",
            attrs: { class: "omnigrid-control-group" },
            children: [
                {
                    key: "first",
                    type: "node",
                    tag: "button",
                    attrs: {
                        type: "button",
                        class: "omnigrid-icon-button",
                        disabled: state.page <= 1,
                        "aria-label": this.labels.firstAriaLabel,
                    },
                    on: { click: () => this.goToPage(1) },
                    children: [this.getIcon("first")],
                },
                {
                    key: "prev",
                    type: "node",
                    tag: "button",
                    attrs: {
                        type: "button",
                        class: "omnigrid-icon-button",
                        disabled: state.page <= 1,
                        "aria-label": this.labels.prevAriaLabel,
                    },
                    on: { click: () => this.prevPage() },
                    children: [this.getIcon("prev")],
                },
                this.quickJump
                    ? {
                          key: "page",
                          type: "node",
                          tag: "div",
                          attrs: { class: "omnigrid-control-group" },
                          children: [
                              {
                                  type: "node",
                                  tag: "input",
                                  attrs: {
                                      type: "text",
                                      inputMode: "numeric",
                                      pattern: "[0-9]*",
                                      size: this.pageInputCharacters,
                                      class: "omnigrid-number-input",
                                      value: this.pageInputValue ?? state.page,
                                      "aria-label": this.labels.pageInfo(state.page, state.totalPages).replace(/<[^>]*>/g, ""),
                                  },
                                  on: {
                                      change: (_context: SlotRenderContext<T>, event: SlotNodeEvent) => {
                                          this.pageInputValue = event.value ?? "";
                                          if (this.api && !this.api.isDestroyed()) this.api.refresh();
                                      },
                                      keydown: (_context: SlotRenderContext<T>, event: SlotNodeEvent) => {
                                          if (event.key !== "Enter") return;
                                          const value = event.value?.trim();
                                          if (!value) return;
                                          const page = Number(value);
                                          if (Number.isInteger(page)) this.goToPage(page);
                                      },
                                  },
                              },
                              this.labels.pageCount(state.totalPages),
                          ],
                      }
                    : {
                          key: "page",
                          type: "html",
                          html: this.labels.pageInfo(state.page, state.totalPages),
                      },
                {
                    key: "next",
                    type: "node",
                    tag: "button",
                    attrs: {
                        type: "button",
                        class: "omnigrid-icon-button",
                        disabled: state.page >= state.totalPages,
                        "aria-label": this.labels.nextAriaLabel,
                    },
                    on: { click: () => this.nextPage() },
                    children: [this.getIcon("next")],
                },
                {
                    key: "last",
                    type: "node",
                    tag: "button",
                    attrs: {
                        type: "button",
                        class: "omnigrid-icon-button",
                        disabled: state.page >= lastPage,
                        "aria-label": this.labels.lastAriaLabel,
                    },
                    on: { click: () => this.goToPage(lastPage) },
                    children: [this.getIcon("last")],
                },
            ],
        };
    }
}