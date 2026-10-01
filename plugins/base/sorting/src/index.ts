import type { ColumnDef, ColumnLeafDef, GridApi, GridPlugin, SortDirection } from "@omnigrid/core";
import { flattenColumns, isColumnGroup } from "@omnigrid/core";

export interface SortModelItem {
    columnId: string;
    direction: SortDirection;
}

export interface SortingPluginOptions<T> {
    compare?: (left: unknown, right: unknown, column: ColumnLeafDef<T>) => number;
}

function defaultCompare(left: unknown, right: unknown): number {
    if (left == null && right == null) return 0;
    if (left == null) return -1;
    if (right == null) return 1;
    if (typeof left === "number" && typeof right === "number") return left - right;
    if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();

    return String(left).localeCompare(String(right), undefined, {
        numeric: true,
        sensitivity: "base",
    });
}

export class SortingPlugin<T> implements GridPlugin<T> {
    public readonly name = "@omnigrid/sorting-plugin";
    private api?: GridApi<T>;
    private sortModel: SortModelItem[] = [];
    private unregisterProcessor?: () => void;
    private unregisterHeaderClick?: () => void;
    private readonly compare: (left: unknown, right: unknown, column: ColumnLeafDef<T>) => number;

    public constructor(options: SortingPluginOptions<T> = {}) {
        this.compare = options.compare ?? ((left, right) => defaultCompare(left, right));
    }

    public register(api: GridApi<T>): () => void {
        this.api = api;
        this.unregisterProcessor = api.registerDataProcessor((data) => this.sortData(data));
        this.unregisterHeaderClick = api.on("headerClick", ({ columnId, multiSort }) => {
            this.toggle(columnId, multiSort);
        });
        this.initializeSortModel();

        return () => {
            this.unregisterProcessor?.();
            this.unregisterHeaderClick?.();
            this.unregisterProcessor = undefined;
            this.unregisterHeaderClick = undefined;
            this.api = undefined;
        };
    }

    private initializeSortModel(): void {
        if (!this.api) return;
        // Sorting applies to leaf columns only — group definitions carry none
        // of the sort metadata (sortable / sortState).
        const columns = flattenColumns(this.api.getState().columns);
        const initialSort = columns.filter((column) => column.sortState !== undefined).map((column) => ({ columnId: column.id, direction: column.sortState! }));
        if (initialSort.length > 0) {
            this.sortModel = initialSort;
            this.updateColumnMetadata();
            this.api.setData(this.api.getState().data);
        }
    }

    public getSortModel(): SortModelItem[] {
        return this.sortModel.map((item) => ({ ...item }));
    }

    public setSortModel(sortModel: SortModelItem[]): void {
        this.sortModel = sortModel.map((item) => ({ ...item }));
        this.updateColumnMetadata();
        this.api?.setData(this.api.getState().data);
    }

    public clearSort(): void {
        this.setSortModel([]);
    }

    private toggle(columnId: string, multiSort: boolean): void {
        const column = flattenColumns(this.api?.getState().columns ?? []).find((item) => item.id === columnId);
        if (!column || column.sortable === false) return;

        const currentIndex = this.sortModel.findIndex((item) => item.columnId === columnId);
        const current = currentIndex >= 0 ? this.sortModel[currentIndex].direction : undefined;
        const next: SortDirection | undefined = current === undefined ? "asc" : current === "asc" ? "desc" : undefined;
        const nextModel = multiSort ? [...this.sortModel] : [];

        if (currentIndex >= 0) nextModel.splice(multiSort ? currentIndex : 0, 1);
        if (next) nextModel.push({ columnId, direction: next });
        this.setSortModel(nextModel);
    }

    private sortData(data: T[]): T[] {
        if (this.sortModel.length === 0 || !this.api) return data;
        const columns = flattenColumns(this.api.getState().columns);

        return data
            .map((value, index) => ({ value, index }))
            .sort((left, right) => {
                for (const sort of this.sortModel) {
                    const column = columns.find((item) => item.id === sort.columnId);
                    if (!column) continue;
                    const result = this.compare(this.getValue(left.value, column), this.getValue(right.value, column), column);
                    if (result !== 0) return sort.direction === "asc" ? result : -result;
                }
                return left.index - right.index;
            })
            .map(({ value }) => value);
    }

    private getValue(row: T, column: ColumnLeafDef<T>): unknown {
        if (column.valueGetter) return column.valueGetter(row);
        // `field` is `keyof T | string` (loose rows), so index via a string-keyed cast.
        if (column.field) return (row as Record<string, unknown>)[column.field as string];
        return undefined;
    }

    private updateColumnMetadata(): void {
        if (!this.api) return;
        const model = new Map(this.sortModel.map((item) => [item.columnId, item.direction]));
        // Rebuild the hierarchy: leaf definitions at any nesting depth get the
        // updated sort metadata; group definitions pass through with their
        // children recursively updated.
        const updateColumns = (columns: ColumnDef<T>[]): ColumnDef<T>[] =>
            columns.map((column) => {
                if (isColumnGroup(column)) {
                    return { ...column, children: updateColumns(column.children) };
                }
                return {
                    ...column,
                    sortable: column.sortable === false ? false : true,
                    sortState: model.get(column.id),
                };
            });
        this.api.setColumns(updateColumns(this.api.getState().columns));
    }
}
