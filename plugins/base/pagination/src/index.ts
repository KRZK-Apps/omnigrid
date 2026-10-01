import type { GridApi, GridPlugin, SlotMount, SlotNodeContent, SlotRenderContext } from "@omnigrid/core";

export interface PaginationState {
    /** Current page, starting from 1. */
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
}

export interface PaginationPluginOptions<T> {
    pageSize?: number;
    initialPage?: number;
}

const DEFAULT_PAGE_SIZE = 50;
const SLOT_ID = "@omnigrid/pagination";

function clampPage(page: number, totalPages: number): number {
    return Math.min(Math.max(1, page), Math.max(1, totalPages));
}

/**
 * Demo of the Slot Architecture: the plugin mounts a pager into the `bottom`
 * slot via headless content (`SlotNodeContent`) and slices data through a
 * DataProcessor. The core remains framework-agnostic, and any adapter
 * materializes the buttons using its own protocol.
 */
export class PaginationPlugin<T> implements GridPlugin<T> {
    public readonly name = "@omnigrid/pagination-plugin";
    private api: GridApi<T> | undefined;
    private page: number;
    private readonly pageSize: number;
    private totalRows = 0;
    private unregisterProcessor: (() => void) | undefined;
    private slotMount: SlotMount<T> | undefined;

    public constructor(options: PaginationPluginOptions<T> = {}) {
        this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
        this.page = Math.max(1, options.initialPage ?? 1);
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
        if (nextPage === this.page) return;
        this.page = nextPage;
        this.refresh();
    }

    public nextPage(): void {
        this.goToPage(this.page + 1);
    }

    public prevPage(): void {
        this.goToPage(this.page - 1);
    }

    private applyPagination(data: T[]): T[] {
        this.totalRows = data.length;
        const totalPages = Math.max(1, Math.ceil(data.length / this.pageSize));
        if (this.page > totalPages) this.page = totalPages;
        const start = (this.page - 1) * this.pageSize;
        return data.slice(start, start + this.pageSize);
    }

    private refresh(): void {
        if (!this.api || this.api.isDestroyed()) return;
        this.api.setViewport({ scrollTop: 0 });
        this.api.setData(this.api.getState().data);
    }

    private renderPager(context: SlotRenderContext<T>): SlotNodeContent<T> {
        const state = this.getState();
        return {
            type: "node",
            tag: "div",
            attrs: { class: "omnigrid-pagination" },
            children: [
                {
                    key: "prev",
                    type: "node",
                    tag: "button",
                    attrs: {
                        class: "omnigrid-pagination-btn",
                        disabled: state.page <= 1,
                        "aria-label": "Previous page",
                    },
                    on: { click: () => this.prevPage() },
                    children: ["◀ Previous"],
                },
                {
                    key: "page",
                    type: "html",
                    html: `Page <b>${state.page}</b> of ${state.totalPages} · ${state.totalRows} rows`,
                },
                {
                    key: "next",
                    type: "node",
                    tag: "button",
                    attrs: {
                        class: "omnigrid-pagination-btn",
                        disabled: state.page >= state.totalPages,
                        "aria-label": "Next page",
                    },
                    on: { click: () => this.nextPage() },
                    children: ["Next ▶"],
                },
            ],
        };
    }
}
