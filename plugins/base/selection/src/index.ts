import type { CheckboxRenderParams, ColumnDef, GridApi, GridPlugin, RowClickEvent, RowId, RowRenderParams } from "@omnigrid/core";

export type SelectionMode = "single" | "multiple";

/**
 * CSS class applied to selected rows. The concrete selected-row color is
 * owned by the active theme (e.g. `@omnigrid/default-theme` defines
 * `--omnigrid-cell-selected-background`); the plugin only marks the row.
 */
export const SELECTED_ROW_CLASS = "omnigrid-row-selected";

export interface SelectionRendererParams<T> extends CheckboxRenderParams {
    data?: T;
    rowId?: RowId;
    index?: number;
    header: boolean;
}

export type SelectionRenderer<T> = (params: SelectionRendererParams<T>) => unknown;

export interface SelectionPluginOptions<T> {
    mode?: SelectionMode;
    checkboxOnly?: boolean;
    replaceSelectionOnClick?: boolean;
    showRowCheckboxes?: boolean;
    showHeaderCheckbox?: boolean;
    isRowSelectable?: (row: T, index: number) => boolean;
    checkboxRenderer?: SelectionRenderer<T>;
    selectionColumnId?: string;
    selectionColumnWidth?: number;
}

export interface SelectionState<T> {
    selectedRowIds: RowId[];
    selectedRows: T[];
}

const CHECKBOX_COLUMN_DEFAULT_ID = "__omnigrid_selection__";

function defaultCheckboxRenderer(params: CheckboxRenderParams): unknown {
    return { type: "@omnigrid/checkbox", ...params };
}

export class SelectionPlugin<T> implements GridPlugin<T> {
    public readonly name = "@omnigrid/selection-plugin";
    private api?: GridApi<T>;
    private mode: SelectionMode;
    private checkboxOnly: boolean;
    private replaceSelectionOnClick: boolean;
    private showRowCheckboxes: boolean;
    private showHeaderCheckbox: boolean;
    private isRowSelectable: (row: T, index: number) => boolean;
    private checkboxRenderer: SelectionRenderer<T>;
    private readonly selectionColumnId: string;
    private readonly selectionColumnWidth: number;
    private readonly selectedRowIds = new Set<RowId>();
    private anchorIndex?: number;
    private unregisterRowClick?: () => void;

    public constructor(options: SelectionPluginOptions<T> = {}) {
        this.mode = options.mode ?? "single";
        this.checkboxOnly = options.checkboxOnly ?? false;
        this.replaceSelectionOnClick = options.replaceSelectionOnClick ?? false;
        this.showRowCheckboxes = options.showRowCheckboxes ?? false;
        this.showHeaderCheckbox = options.showHeaderCheckbox ?? false;
        this.isRowSelectable = options.isRowSelectable ?? (() => true);
        this.checkboxRenderer = options.checkboxRenderer ?? defaultCheckboxRenderer;
        this.selectionColumnId = options.selectionColumnId ?? CHECKBOX_COLUMN_DEFAULT_ID;
        this.selectionColumnWidth = options.selectionColumnWidth ?? 44;
    }

    public register(api: GridApi<T>): () => void {
        this.api = api;
        this.unregisterRowClick = api.on("rowClick", (event) => this.handleRowClick(event));
        this.updateColumns();

        return () => {
            this.unregisterRowClick?.();
            this.unregisterRowClick = undefined;
            this.api = undefined;
        };
    }

    public getSelectedRowIds(): RowId[] {
        return [...this.selectedRowIds];
    }

    public getSelectedRows(): T[] {
        if (!this.api) return [];
        return this.api.getProcessedData().filter((row, index) => this.selectedRowIds.has(this.api!.getRowId(row, index)));
    }

    public getSelectionState(): SelectionState<T> {
        return { selectedRowIds: this.getSelectedRowIds(), selectedRows: this.getSelectedRows() };
    }

    public isSelected(rowId: RowId): boolean {
        return this.selectedRowIds.has(rowId);
    }

    public setSelectedRowIds(rowIds: RowId[]): void {
        this.selectedRowIds.clear();
        rowIds.forEach((rowId) => this.selectedRowIds.add(rowId));
        this.refresh();
    }

    public clearSelection(): void {
        this.setSelectedRowIds([]);
    }

    public toggleRow(rowId: RowId, index: number, modifiers: { shiftKey?: boolean; ctrlKey?: boolean } = {}): void {
        if (!this.api) return;
        const row = this.api.getProcessedData()[index];
        if (!row || !this.isRowSelectable(row, index)) return;
        if (this.mode === "single" && !this.replaceSelectionOnClick && this.selectedRowIds.has(rowId) && !modifiers.shiftKey) {
            this.selectedRowIds.delete(rowId);
            this.anchorIndex = index;
            this.refresh();
            return;
        }
        this.applySelection(rowId, index, modifiers);
    }

    public getRowClass({ id }: RowRenderParams<T>): string | undefined {
        return this.selectedRowIds.has(id) ? SELECTED_ROW_CLASS : undefined;
    }

    private handleRowClick(event: RowClickEvent<T>): void {
        if (this.checkboxOnly) return;
        this.applySelection(event.id, event.index, event);
    }

    private applySelection(rowId: RowId, index: number, modifiers: { shiftKey?: boolean; ctrlKey?: boolean }): void {
        if (!this.api) return;
        const processedData = this.api.getProcessedData();
        const row = processedData[index];
        if (!row || !this.isRowSelectable(row, index)) return;

        if (this.mode === "single" && !this.replaceSelectionOnClick && this.selectedRowIds.has(rowId) && !modifiers.shiftKey) {
            this.selectedRowIds.delete(rowId);
            this.anchorIndex = index;
            this.refresh();
            return;
        }

        const useRange = modifiers.shiftKey === true && this.anchorIndex !== undefined;
        if (useRange) {
            const start = Math.min(this.anchorIndex!, index);
            const end = Math.max(this.anchorIndex!, index);
            if (!modifiers.ctrlKey) this.selectedRowIds.clear();
            for (let rowIndex = start; rowIndex <= end; rowIndex += 1) {
                const rangeRow = processedData[rowIndex];
                if (rangeRow && this.isRowSelectable(rangeRow, rowIndex)) {
                    this.selectedRowIds.add(this.api.getRowId(rangeRow, rowIndex));
                }
            }
        } else if (this.replaceSelectionOnClick && !modifiers.ctrlKey) {
            this.selectedRowIds.clear();
            this.selectedRowIds.add(rowId);
        } else if (this.mode === "multiple" || modifiers.ctrlKey) {
            if (this.selectedRowIds.has(rowId)) this.selectedRowIds.delete(rowId);
            else this.selectedRowIds.add(rowId);
        } else {
            this.selectedRowIds.clear();
            this.selectedRowIds.add(rowId);
        }

        this.anchorIndex = index;
        this.refresh();
    }

    private updateColumns(): void {
        if (!this.api) return;
        const columns = this.api.getState().columns.filter((column) => column.id !== this.selectionColumnId);
        if (!this.showRowCheckboxes && !this.showHeaderCheckbox) {
            this.api.setColumns(columns);
            return;
        }
        const hasPinnedLeft = columns.some((column) => column.pinned === "left");
        const selectionColumn: ColumnDef<T> = {
            id: this.selectionColumnId,
            header: "",
            width: this.selectionColumnWidth,
            minWidth: this.selectionColumnWidth,
            maxWidth: this.selectionColumnWidth,
            sortable: false,
            stopHeaderClick: true,
            stopRowClick: true,
            // The checkbox column must stay in view while scrolling horizontally.
            // When the table already has left-pinned columns, pin the checkbox
            // column to the left (as the very first pinned column) so it never
            // scrolls away together with its pinned peers. With no left-pinned
            // columns the checkbox column stays as the first scrollable column.
            pinned: hasPinnedLeft ? "left" : undefined,
            headerRenderer: () =>
                this.renderCheckbox({
                    checked: this.isAllSelectableRowsSelected(),
                    indeterminate: this.hasSomeSelectableRowsSelected() && !this.isAllSelectableRowsSelected(),
                    disabled: !this.hasSelectableRows(),
                    ariaLabel: "Select all rows",
                    header: true,
                    onChange: (event) => this.toggleAll(event),
                }),
            cellRenderer: ({ data, id, index }) =>
                this.renderCheckbox({
                    checked: id !== undefined && this.selectedRowIds.has(id),
                    indeterminate: false,
                    disabled: index === undefined || !this.isRowSelectable(data, index),
                    ariaLabel: "Select row",
                    data,
                    rowId: id,
                    index,
                    header: false,
                    onChange: (event) => id !== undefined && index !== undefined && this.toggleRow(id, index, event),
                }),
        };
        this.api.setColumns([selectionColumn, ...columns]);
    }

    private renderCheckbox(params: SelectionRendererParams<T>): unknown {
        if ((params.header && !this.showHeaderCheckbox) || (!params.header && !this.showRowCheckboxes)) return "";
        return this.checkboxRenderer(params);
    }

    private hasSelectableRows(): boolean {
        if (!this.api) return false;
        return this.api.getState().data.some((row, index) => this.isRowSelectable(row, index));
    }

    private isAllSelectableRowsSelected(): boolean {
        if (!this.api) return false;
        const processedData = this.api.getProcessedData();
        const selectableRows = processedData.filter((row, index) => this.isRowSelectable(row, index));
        return (
            selectableRows.length > 0 &&
            processedData.every((row, index) => !this.isRowSelectable(row, index) || this.selectedRowIds.has(this.api!.getRowId(row, index)))
        );
    }

    private hasSomeSelectableRowsSelected(): boolean {
        if (!this.api) return false;
        return this.api.getProcessedData().some((row, index) => this.isRowSelectable(row, index) && this.selectedRowIds.has(this.api!.getRowId(row, index)));
    }

    private toggleAll(modifiers: { shiftKey: boolean; ctrlKey: boolean }): void {
        if (!this.api) return;
        const processedData = this.api.getProcessedData();
        if (this.isAllSelectableRowsSelected()) {
            processedData.forEach((row, index) => {
                if (this.isRowSelectable(row, index)) this.selectedRowIds.delete(this.api!.getRowId(row, index));
            });
        } else {
            processedData.forEach((row, index) => {
                if (this.isRowSelectable(row, index)) this.selectedRowIds.add(this.api!.getRowId(row, index));
            });
        }
        this.refresh();
    }

    private refresh(): void {
        if (!this.api || this.api.isDestroyed()) return;
        this.api.setData(this.api.getState().data);
    }

    private validateSelection(): void {
        if (!this.api) return;
        const processedData = this.api.getProcessedData();
        let hasChanges = false;

        for (const rowId of this.selectedRowIds) {
            const index = processedData.findIndex((row, idx) => this.api!.getRowId(row, idx) === rowId);
            const row = index !== -1 ? processedData[index] : undefined;

            if (row && index !== -1 && !this.isRowSelectable(row, index)) {
                this.selectedRowIds.delete(rowId);
                hasChanges = true;
            }
        }
        if (hasChanges) {
            this.refresh();
        }
    }

    public updateOptions(newOptions: Partial<SelectionPluginOptions<T>>): void {
        if (newOptions.mode !== undefined) (this as any).mode = newOptions.mode;
        if (newOptions.checkboxOnly !== undefined) (this as any).checkboxOnly = newOptions.checkboxOnly;
        if (newOptions.replaceSelectionOnClick !== undefined) (this as any).replaceSelectionOnClick = newOptions.replaceSelectionOnClick;
        if (newOptions.showRowCheckboxes !== undefined) (this as any).showRowCheckboxes = newOptions.showRowCheckboxes;
        if (newOptions.showHeaderCheckbox !== undefined) (this as any).showHeaderCheckbox = newOptions.showHeaderCheckbox;
        if (newOptions.isRowSelectable !== undefined) (this as any).isRowSelectable = newOptions.isRowSelectable;
        if (newOptions.checkboxRenderer !== undefined) (this as any).checkboxRenderer = newOptions.checkboxRenderer;

        this.updateColumns();
        this.validateSelection();
        this.refresh();
    }
}
