import type {
    ColumnDef,
    ColumnLeafDef,
    GridApi,
    GridPlugin,
    SlotMount,
    SlotName,
    SlotPosition,
    SlotRenderContext,
    UIInputControl,
} from "@omnigrid/core";
import { applyQuickFilter, flattenColumns, getCellValue } from "@omnigrid/core";

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

/**
 * Standalone base plugin providing a global quick filter text input in the top or bottom
 * slot of the grid, evaluating search terms across all searchable columns.
 *
 * @api
 */
export class QuickFilterPlugin<T> implements GridPlugin<T> {
    public readonly name: string = "@omnigrid/quick-filter-plugin";
    private api?: GridApi<T>;
    private readonly debounceMs: number;
    private readonly slot: QuickFilterSlotName;
    private readonly position: SlotPosition;
    private readonly priority: number;
    private readonly placeholder: string;
    private readonly ariaLabel: string;
    private currentValue: string;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private unmountSlot?: () => void;
    private unsubscribeQuickFilter?: () => void;

    public constructor(options: QuickFilterPluginOptions = {}) {
        this.debounceMs = options.debounceMs ?? 150;
        this.slot = options.slot ?? "top";
        this.position = options.position ?? "start";
        this.priority = options.priority ?? 0;
        this.placeholder = options.placeholder ?? "Search...";
        this.ariaLabel = options.ariaLabel ?? "Quick filter";
        this.currentValue = options.initialValue ?? "";
    }

    /**
     * Registers the plugin with the grid instance, mounting the quick filter
     * text input into the configured slot and connecting event handlers.
     * @param api - Target grid API.
     * @returns Cleanup callback to unregister the plugin.
     * @api
     */
    public register(api: GridApi<T>): () => void {
        this.api = api;

        if (this.currentValue && !api.getQuickFilter()) {
            api.setQuickFilter(this.currentValue);
        } else if (api.getQuickFilter()) {
            this.currentValue = api.getQuickFilter();
        }

        this.unsubscribeQuickFilter = api.on("quickFilterChanged", (query: string) => {
            this.currentValue = query;
        });

        const targetSlot: SlotName = this.slot as SlotName;
        const mount: SlotMount<T> = api.slots.mount(
            targetSlot,
            (context: SlotRenderContext<T>) => this.describe(context.api),
            {
                id: "omnigrid-quick-filter",
                priority: this.priority,
                position: this.position,
            },
        );
        this.unmountSlot = () => mount.unmount();

        return () => {
            this.unsubscribeQuickFilter?.();
            this.unsubscribeQuickFilter = undefined;
            if (this.debounceTimer !== null) {
                clearTimeout(this.debounceTimer);
                this.debounceTimer = null;
            }
            this.unmountSlot?.();
            this.unmountSlot = undefined;
            if (api && !api.isDestroyed() && api.getQuickFilter()) {
                api.setQuickFilter("");
            }
            this.api = undefined;
        };
    }

    /**
     * Generates a declarative UI text input descriptor representing the quick filter control.
     * Exposed so slot managers, adapters, or external containers can render the control directly.
     * @param api - Optional grid API instance; defaults to the registered API.
     * @returns UI input control descriptor.
     * @api
     */
    public describe(api?: GridApi<T>): UIInputControl {
        const currentApi: GridApi<T> | undefined = api ?? this.api;
        const value: string = currentApi && !currentApi.isDestroyed() ? currentApi.getQuickFilter() : this.currentValue;

        return {
            id: "omnigrid-quick-filter-input",
            type: "text",
            ariaLabel: this.ariaLabel,
            icon: "search",
            value,
            placeholder: this.placeholder,
            debounceMs: this.debounceMs,
            className: "omnigrid-quick-filter-input",
            onChange: (nextValue: string) => {
                this.setQuery(nextValue);
            },
            onEnter: () => {
                if (this.debounceTimer !== null) {
                    clearTimeout(this.debounceTimer);
                    this.debounceTimer = null;
                }
                if (this.api && !this.api.isDestroyed()) {
                    this.api.setQuickFilter(this.currentValue);
                }
            },
        };
    }

    /**
     * Immediately sets the quick filter query string on the grid.
     * @param query - Search query string.
     * @api
     */
    public setQuery(query: string): void {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        this.currentValue = query;
        if (this.api && !this.api.isDestroyed()) {
            this.api.setQuickFilter(query);
        }
    }

    /**
     * Sets the quick filter query string after the configured debounce interval.
     * @param query - Search query string.
     * @api
     */
    public setQueryDebounced(query: string): void {
        this.currentValue = query;
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            if (this.api && !this.api.isDestroyed()) {
                this.api.setQuickFilter(query);
            }
        }, this.debounceMs);
    }

    /**
     * Returns the current quick filter query string.
     * @returns The active search query.
     * @api
     */
    public getQuery(): string {
        if (this.api && !this.api.isDestroyed()) {
            return this.api.getQuickFilter();
        }
        return this.currentValue;
    }

    /**
     * Clears the current quick filter query string.
     * @api
     */
    public clear(): void {
        this.setQuery("");
    }

    /**
     * Splits a quick filter query into trimmed, non-empty, case-insensitive terms separated by commas.
     * @param query - Raw search query.
     * @returns Array of lower-cased search terms.
     * @api
     */
    public static parseTerms(query: string): string[] {
        const trimmed: string = query.trim();
        if (trimmed === "") return [];
        return trimmed
            .split(",")
            .map((term: string) => term.trim().toLowerCase())
            .filter((term: string) => term.length > 0);
    }

    /**
     * Evaluates whether a row matches search terms across all searchable columns.
     * Ignores columns with `searchable: false` and evaluates `valueGetter` when present.
     * @param row - The data row to evaluate.
     * @param terms - Lower-cased search terms.
     * @param columns - Column definitions.
     * @returns True if the row matches at least one term in at least one searchable column.
     * @api
     */
    public static matchesRow<T>(row: T, terms: string[], columns: ColumnDef<T>[]): boolean {
        if (terms.length === 0) return true;
        const searchable: ColumnLeafDef<T>[] = flattenColumns(columns).filter((column) => column.searchable !== false);
        if (searchable.length === 0) return false;

        return searchable.some((column) => {
            const value: unknown = getCellValue(row, column);
            if (value === undefined || value === null) return false;
            const text: string = String(value).toLowerCase();
            return terms.some((term: string) => text.includes(term));
        });
    }

    /**
     * Filters a dataset according to a quick filter query string and column definitions.
     * @param data - The dataset to filter.
     * @param query - Raw search query string.
     * @param columns - Column definitions.
     * @returns Filtered dataset.
     * @api
     */
    public static filter<T>(data: T[], query: string, columns: ColumnDef<T>[]): T[] {
        return applyQuickFilter(data, query, columns);
    }

    /**
     * Evaluates whether a row matches search terms using the instance's grid columns.
     * @param row - The data row to evaluate.
     * @param terms - Lower-cased search terms.
     * @param columns - Optional columns override.
     * @returns True if the row matches at least one term in at least one searchable column.
     * @api
     */
    public matchesRow(row: T, terms: string[], columns?: ColumnDef<T>[]): boolean {
        const cols: ColumnDef<T>[] = columns ?? (this.api?.getState().columns ?? []);
        return QuickFilterPlugin.matchesRow(row, terms, cols);
    }

    /**
     * Filters a dataset using the instance's active query and columns.
     * @param data - The dataset to filter.
     * @param query - Optional query override.
     * @param columns - Optional columns override.
     * @returns Filtered dataset.
     * @api
     */
    public filter(data: T[], query?: string, columns?: ColumnDef<T>[]): T[] {
        const q: string = query ?? this.getQuery();
        const cols: ColumnDef<T>[] = columns ?? (this.api?.getState().columns ?? []);
        return QuickFilterPlugin.filter(data, q, cols);
    }
}
