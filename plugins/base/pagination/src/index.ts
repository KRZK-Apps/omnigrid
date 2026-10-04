import type {
    GridApi,
    GridPlugin,
    IconDefinition,
    SlotMount,
    SlotNodeContent,
    SlotNodeEvent,
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
export type PaginationPanelName = "rowInfo" | "pageSize" | "navigation";

export interface PaginationPluginOptions<T> {
    pageSize?: number;
    pageSizes?: number[];
    initialPage?: number;
    panels?: PaginationPanelName[];
    quickJump?: boolean;
    pageInputCharacters?: number;
    labels?: PaginationLabels;
    icons?: Partial<Record<PaginationIconName, IconDefinition<T>>>;
}

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZES = [20, 50, 100];
const ALL_PANELS: PaginationPanelName[] = ["rowInfo", "pageSize", "navigation"];
const DEFAULT_PANELS: PaginationPanelName[] = ["navigation"];
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
    private slotMount: SlotMount<T> | undefined;
    private labels: Required<PaginationLabels>;
    private readonly icons: PaginationPluginOptions<T>["icons"];
    private readonly panels: PaginationPanelName[];
    private readonly quickJump: boolean;
    private readonly pageInputCharacters: number;

    public constructor(options: PaginationPluginOptions<T> = {}) {
        this.pageSizes = [...(options.pageSizes ?? DEFAULT_PAGE_SIZES)];
        if (this.pageSizes.length === 0 || this.pageSizes.some((size) => !Number.isInteger(size) || size <= 0)) {
            throw new Error("Pagination pageSizes must contain positive integers");
        }
        if (new Set(this.pageSizes).size !== this.pageSizes.length) {
            throw new Error("Pagination pageSizes must not contain duplicates");
        }
        this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
        if (!Number.isInteger(this.pageSize) || this.pageSize <= 0) {
            throw new Error("Pagination pageSize must be a positive integer");
        }
        if (!this.pageSizes.includes(this.pageSize)) {
            this.pageSizes.push(this.pageSize);
            this.pageSizes.sort((left, right) => left - right);
        }
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
        this.panels = [...(options.panels ?? DEFAULT_PANELS)];
        if (new Set(this.panels).size !== this.panels.length || this.panels.some((panel) => !ALL_PANELS.includes(panel))) {
            throw new Error("Pagination panels must contain unique valid panel names");
        }
    }

    public register(api: GridApi<T>): () => void {
        this.api = api;
        this.unregisterProcessor = api.registerDataProcessor((data) => this.applyPagination(data));
        this.slotMount = api.slots.mount("bottom", (context: SlotRenderContext<T>) => this.renderPager(context), {
            id: SLOT_ID,
            priority: 0,
            position: "end",
        });

        return () => {
            this.unregisterProcessor?.();
            this.unregisterProcessor = undefined;
            this.slotMount?.unmount();
            this.slotMount = undefined;
            this.api = undefined;
        };
    }

    public getState(): PaginationState {
        const totalPages = Math.max(1, Math.ceil(this.totalRows / this.pageSize));
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
        if (pageChanged) this.refresh();
        else if (this.api && !this.api.isDestroyed()) this.api.refresh();
    }

    public nextPage(): void {
        this.goToPage(this.page + 1);
    }

    public prevPage(): void {
        this.goToPage(this.page - 1);
    }

    public setPageSize(pageSize: number): void {
        if (!this.pageSizes.includes(pageSize)) {
            throw new Error(`Unsupported pagination page size: ${pageSize}`);
        }
        if (pageSize === this.pageSize) return;
        this.pageSize = pageSize;
        this.page = 1;
        this.pageSizesOpen = false;
        this.refresh();
    }

    private applyPagination(data: T[]): T[] {
        this.totalRows = data.length;
        const totalPages = Math.max(1, Math.ceil(data.length / this.pageSize));
        if (this.page > totalPages) {
            this.page = totalPages;
            this.pageInputValue = String(totalPages);
        }
        const start = (this.page - 1) * this.pageSize;
        return data.slice(start, start + this.pageSize);
    }

    private refresh(): void {
        if (!this.api || this.api.isDestroyed()) return;
        this.api.setViewport({ scrollTop: 0 });
        this.api.setData(this.api.getState().data);
    }

    private getIcon(name: PaginationIconName): SlotNodeContent<T> {
        const icon = this.icons?.[name];
        if (icon) return typeof icon === "function" ? icon() : icon;
        if (!this.api) throw new Error("Pagination plugin is not registered");
        return this.api.icons.get(DEFAULT_ICONS[name]);
    }

    private renderPager(context: SlotRenderContext<T>): SlotNodeContent<T> {
        const state = this.getState();
        const lastPage = state.totalPages;
        const from = state.totalRows === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
        const to = Math.min(state.page * state.pageSize, state.totalRows);
        return {
            type: "node",
            tag: "div",
            attrs: { class: "omnigrid-control-bar" },
            children: this.panels.map((block) => {
                if (block === "rowInfo") {
                    return {
                        key: block,
                        type: "html",
                        html: this.labels.rowInfo(from, to, state.totalRows),
                    };
                }
                if (block === "pageSize") {
                    return {
                        key: block,
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
                                children: [`${this.labels.pageSizeLabel} ${state.pageSize}`],
                            },
                            ...(this.pageSizesOpen ? [{
                                type: "node" as const,
                                tag: "div",
                                attrs: {
                                    class: "omnigrid-popup-menu",
                                    role: "listbox",
                                    "aria-label": this.labels.pageSizesLabel,
                                },
                                children: this.pageSizes.map((size) => ({
                                    type: "node" as const,
                                    tag: "button",
                                    attrs: {
                                        type: "button",
                                        class: "omnigrid-popup-option",
                                        role: "option",
                                        "aria-selected": size === state.pageSize,
                                    },
                                    on: { click: () => this.setPageSize(size) },
                                    children: [String(size)],
                                })),
                            }] : []),
                        ],
                    };
                }
                return {
                    key: block,
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
            }),
        };
    }
}