import type {
    BlockConfig,
    ColumnDef,
    GridApi,
    GridPlugin,
    IconDefinition,
    SlotContent,
    SlotMount,
    SlotName,
    SlotNodeContent,
    SlotNodeEvent,
    SlotPosition,
    SlotRenderContext,
} from "@omnigrid/core";

export interface PaginationState {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
}

export interface PaginationLabels {
    firstAriaLabel?: string;
    prevAriaLabel?: string;
    nextAriaLabel?: string;
    lastAriaLabel?: string;
    pageInfo?: (page: number, totalPages: number) => string;
    rowInfo?: (from: number, to: number, totalRows: number) => string;
    pageSizeLabel?: string;
    pageSizesLabel?: string;
    pageCount?: (totalPages: number) => string;
}

export type PaginationIconName = "first" | "prev" | "next" | "last";
export type PaginationBlockName = "rowInfo" | "pageSize" | "navigation";

/**
 * Placement of a pagination block inside a slot. Based on the generic core
 * `BlockConfig`, restricted to the blocks this plugin can render.
 */
export type PaginationBlockConfig = BlockConfig<PaginationBlockName>;

export type PaginationBlockOption = PaginationBlockName | PaginationBlockConfig;

export interface PaginationPluginOptions<T> {
    pageSize?: number;
    pageSizes?: number[];
    mode?: "client" | "server";
    totalRows?: number;
    onChange?: (params: { page: number; pageSize: number }) => void;
    initialPage?: number;
    slot?: SlotName;
    position?: SlotPosition;
    priority?: number;
    blocks?: PaginationBlockOption[];
    quickJump?: boolean;
    pageInputCharacters?: number;
    labels?: PaginationLabels;
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

export class PaginationPlugin<T> implements GridPlugin<T> {
    public readonly name = "@omnigrid/pagination-plugin";
    private api: GridApi<T> | undefined;
    private page: number;
    private pageSize: number;
    private readonly pageSizes: number[];
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

    public getState(): PaginationState {
        const totalPages = Math.max(1, Math.ceil(this.totalRows / this.getEffectivePageSize()));
        return {
            page: clampPage(this.page, totalPages),
            pageSize: this.pageSize,
            totalRows: this.totalRows,
            totalPages,
        };
    }

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

    public nextPage(): void {
        this.goToPage(this.page + 1);
    }

    public prevPage(): void {
        this.goToPage(this.page - 1);
    }

    public setPageSize(pageSize: number): void {
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
                        tag: "button",
                        attrs: {
                            type: "button",
                            class: "omnigrid-control-button",
                            "aria-haspopup": "listbox",
                            "aria-expanded": this.pageSizesOpen,
                            "aria-label": this.labels.pageSizeLabel,
                        },
                        on: {
                            click: () => {
                                this.pageSizesOpen = !this.pageSizesOpen;
                                if (this.api && !this.api.isDestroyed()) this.api.refresh();
                            },
                        },
                        children: [`${this.labels.pageSizeLabel} ${state.pageSize === 0 ? "Auto" : state.pageSize}`],
                    },
                    ...(this.pageSizesOpen ? [{
                        type: "node" as const,
                        tag: "div",
                        attrs: {
                            class: "omnigrid-popup-menu",
                            role: "listbox",
                            "aria-label": this.labels.pageSizesLabel,
                        },
                        children: [0, ...this.pageSizes].map((size) => ({
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