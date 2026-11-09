import type {
    CheckboxRenderParams,
    ColumnDef,
    GridApi,
    GridPlugin,
    RowClickEvent,
    RowHierarchy,
    RowId,
    RowRenderParams,
} from "@omnigrid/core";

import type {
    GroupSelectionMode,
    SelectionMode,
    SelectionPluginOptions,
    SelectionRenderer,
    SelectionRendererParams,
    SelectionState,
} from "./types";

export type {
    GroupSelectionMode,
    SelectionMode,
    SelectionPluginOptions,
    SelectionRenderer,
    SelectionRendererParams,
    SelectionState,
};

/**
 * CSS class applied to selected rows. The concrete selected-row color is
 * owned by the active theme (e.g. `@omnigrid/default-theme` defines
 * `--omnigrid-cell-selected-background`); the plugin only marks the row.
 */
export const SELECTED_ROW_CLASS = "omnigrid-row-selected";

/** Applied to rows rejected by `isRowSelectable`; themes supply muted colors. */
export const UNSELECTABLE_ROW_CLASS = "omnigrid-row-unselectable";

const CHECKBOX_COLUMN_DEFAULT_ID = "__omnigrid_selection__";

interface CheckboxState<T> {
    checked: boolean;
    indeterminate: boolean;
    disabled: boolean;
    group: boolean;
    rowIds: RowId[];
    data?: T;
    index?: number;
}

function defaultCheckboxRenderer(params: CheckboxRenderParams): unknown {
    return { type: "@omnigrid/checkbox", ...params };
}

/** Adds row selection and optional checkbox controls to a grid. */
export class SelectionPlugin<T> implements GridPlugin<T> {
    public readonly name = "@omnigrid/selection-plugin";
    private api?: GridApi<T>;
    private mode: SelectionMode;
    private checkboxOnly: boolean;
    private replaceSelectionOnClick: boolean;
    private groupSelection: GroupSelectionMode;
    private showRowCheckboxes: boolean;
    private showHeaderCheckbox: boolean;
    private isRowSelectable: (row: T, index: number) => boolean;
    private checkboxRenderer: SelectionRenderer<T>;
    private onSelectionChange?: (state: SelectionState<T>) => void;
    private readonly selectionColumnId: string;
    private readonly selectionColumnWidth: number;
    private readonly selectedRowIds = new Set<RowId>();
    private anchorIndex?: number;
    private unregisterRowClick?: () => void;
    private unregisterMethods?: () => void;

    public constructor(options: SelectionPluginOptions<T> = {}) {
        this.mode = options.mode ?? "single";
        this.checkboxOnly = options.checkboxOnly ?? false;
        this.replaceSelectionOnClick = options.replaceSelectionOnClick ?? false;
        this.groupSelection = options.groupSelection ?? "none";
        this.showRowCheckboxes = options.showRowCheckboxes ?? false;
        this.showHeaderCheckbox = options.showHeaderCheckbox ?? false;
        this.isRowSelectable = options.isRowSelectable ?? (() => true);
        this.checkboxRenderer = options.checkboxRenderer ?? defaultCheckboxRenderer;
        this.onSelectionChange = options.onSelectionChange;
        this.selectionColumnId = options.selectionColumnId ?? CHECKBOX_COLUMN_DEFAULT_ID;
        this.selectionColumnWidth = options.selectionColumnWidth ?? 40;
    }

    public register(api: GridApi<T>): () => void {
        this.api = api;
        this.unregisterRowClick = api.on("rowClick", (event) => this.handleRowClick(event));
        this.unregisterMethods = api.registerMethods({
            selectRow: (rowId: RowId) => {
                this.selectedRowIds.add(rowId);
                this.refresh();
            },
            deselectRow: (rowId: RowId) => {
                this.selectedRowIds.delete(rowId);
                this.refresh();
            },
            getSelection: () => this.getSelectionState(),
            clearSelection: () => this.clearSelection(),
        });
        api.setState((prev) => ({ ...prev, selection: this.getSelectionState() }));
        this.updateColumns();

        return () => {
            this.unregisterRowClick?.();
            this.unregisterRowClick = undefined;
            this.unregisterMethods?.();
            this.unregisterMethods = undefined;
            const targetApi: GridApi<T> | undefined = this.api;
            if (targetApi && !targetApi.isDestroyed()) {
                targetApi.setColumns(
                    targetApi.getState().columns.filter((column) => column.id !== this.selectionColumnId),
                );
                targetApi.setState((prev) => {
                    const next = { ...prev };
                    delete next.selection;
                    return next;
                });
            }
            this.selectedRowIds.clear();
            this.anchorIndex = undefined;
            this.api = undefined;
        };
    }

    /**
     * Returns the IDs of all currently selected rows.
     * @api
     */
    public getSelectedRowIds(): RowId[] {
        return [...this.selectedRowIds];
    }

    /**
     * Returns the data objects of all currently selected rows.
     * @api
     */
    public getSelectedRows(): T[] {
        if (!this.api) return [];
        if (this.groupSelection !== "none" && this.api.getRowHierarchy()) {
            return this.api
                .getState()
                .data.filter((row, index) => this.selectedRowIds.has(this.api!.getRowId(row, index)));
        }
        return this.api
            .getProcessedData()
            .filter((row, index) => this.selectedRowIds.has(this.api!.getRowId(row, index)));
    }

    /**
     * Returns selected row IDs and row data together.
     * @api
     */
    public getSelectionState(): SelectionState<T> {
        return { selectedRowIds: this.getSelectedRowIds(), selectedRows: this.getSelectedRows() };
    }

    /**
     * Checks whether a row ID is currently selected.
     * @api
     */
    public isSelected(rowId: RowId): boolean {
        return this.selectedRowIds.has(rowId);
    }

    /**
     * Replaces the current selection with the supplied row IDs.
     * @api
     */
    public setSelectedRowIds(rowIds: RowId[]): void {
        this.selectedRowIds.clear();
        rowIds.forEach((rowId) => this.selectedRowIds.add(rowId));
        this.refresh();
    }

    /**
     * Clears all selected rows.
     * @api
     */
    public clearSelection(): void {
        this.setSelectedRowIds([]);
    }

    /**
     * Toggles a row's selection. Shift and Ctrl modifiers control range and additive selection.
     * @api
     */
    public toggleRow(rowId: RowId, index: number, modifiers: { shiftKey?: boolean; ctrlKey?: boolean } = {}): void {
        if (!this.api) return;
        const row = this.api.getProcessedData()[index];
        if (!row || !this.isRowSelectable(row, index)) return;
        if (
            this.mode === "single" &&
            !this.replaceSelectionOnClick &&
            this.selectedRowIds.has(rowId) &&
            !modifiers.shiftKey
        ) {
            this.selectedRowIds.delete(rowId);
            this.anchorIndex = index;
            this.refresh();
            return;
        }
        this.applySelection(rowId, index, modifiers);
    }

    /** Returns selection-related CSS classes for a row. */
    public getRowClass(params: RowRenderParams<T>): string | undefined {
        const { id, index } = params;
        const data: T | undefined = params.rowType === "leaf" ? params.data : undefined;
        const checkboxState: CheckboxState<T> = this.getCheckboxState(id, index, data);
        const classes: string[] = [];
        if (checkboxState.group) {
            if (this.mode !== "multiple" || this.groupSelection === "none") return undefined;
            if (checkboxState.checked) classes.push(SELECTED_ROW_CLASS);
            if (checkboxState.disabled) classes.push(UNSELECTABLE_ROW_CLASS);
        } else {
            if (this.selectedRowIds.has(id)) classes.push(SELECTED_ROW_CLASS);
            if (data !== undefined && !this.isRowSelectable(data, index)) classes.push(UNSELECTABLE_ROW_CLASS);
        }
        return classes.length > 0 ? classes.join(" ") : undefined;
    }

    private handleRowClick(event: RowClickEvent<T>): void {
        if (this.checkboxOnly) return;
        const hierarchy: RowHierarchy<T> | undefined = this.api?.getRowHierarchy();
        if (hierarchy) {
            if (hierarchy.getLeafRowIds(event.id, "all") !== undefined) return;
            const row: { data: T; index: number } | undefined = this.getRowByStableId(event.id);
            if (!row || !this.isRowSelectable(row.data, row.index)) return;
            this.toggleStableRow(event.id, event, row.index);
            return;
        }
        this.applySelection(event.id, event.index, event);
    }

    private toggleStableRow(rowId: RowId, modifiers: { shiftKey?: boolean; ctrlKey?: boolean }, index: number): void {
        if (this.mode === "single") {
            if (!this.replaceSelectionOnClick && this.selectedRowIds.has(rowId) && !modifiers.shiftKey) {
                this.selectedRowIds.delete(rowId);
            } else {
                this.selectedRowIds.clear();
                this.selectedRowIds.add(rowId);
            }
        } else if (this.selectedRowIds.has(rowId)) {
            this.selectedRowIds.delete(rowId);
        } else {
            this.selectedRowIds.add(rowId);
        }
        this.anchorIndex = index;
        this.refresh();
    }

    private getRowByStableId(rowId: RowId): { data: T; index: number } | undefined {
        if (!this.api) return undefined;
        const rows: T[] = this.api.getState().data;
        for (let index: number = 0; index < rows.length; index += 1) {
            if (this.api.getRowId(rows[index], index) === rowId) return { data: rows[index], index };
        }
        return undefined;
    }

    private getSelectionRowId(row: T, index: number): RowId {
        if (!this.api) return index;
        const sourceIndex: number = this.api.getRowHierarchy() ? this.api.getState().data.indexOf(row) : -1;
        return this.api.getRowId(row, sourceIndex >= 0 ? sourceIndex : index);
    }

    private getCheckboxState(rowId: RowId, index: number, data: T | undefined): CheckboxState<T> {
        const hierarchy: RowHierarchy<T> | undefined = this.api?.getRowHierarchy();
        const allDescendants: readonly RowId[] | undefined = hierarchy?.getLeafRowIds(rowId, "all");
        const isGroup: boolean = allDescendants !== undefined;
        if (!isGroup) {
            const row: { data: T; index: number } | undefined = hierarchy
                ? this.getRowByStableId(rowId)
                : data !== undefined
                  ? { data, index }
                  : undefined;
            const selectable: boolean = row !== undefined && this.isRowSelectable(row.data, row.index);
            return {
                checked: this.selectedRowIds.has(rowId),
                indeterminate: false,
                disabled: !selectable,
                group: false,
                rowIds: selectable ? [rowId] : [],
                data: row?.data ?? data,
                index: row?.index ?? index,
            };
        }
        if (this.mode !== "multiple" || this.groupSelection === "none" || !hierarchy) {
            return { checked: false, indeterminate: false, disabled: true, group: true, rowIds: [] };
        }

        const scope: "all" | "filtered" = this.groupSelection === "descendants" ? "all" : "filtered";
        const descendants: readonly RowId[] =
            scope === "all" ? (allDescendants ?? []) : (hierarchy.getLeafRowIds(rowId, "filtered") ?? []);
        const sourceRows: T[] =
            scope === "all" ? (this.api?.getState().data ?? []) : (this.api?.getFilteredData() ?? []);
        const selectableIds: RowId[] = [];
        sourceRows.forEach((row, rowIndex) => {
            const rawIndex: number = this.api?.getState().data.indexOf(row) ?? -1;
            const sourceIndex: number = rawIndex >= 0 ? rawIndex : rowIndex;
            const leafId: RowId | undefined = this.api?.getRowId(row, sourceIndex);
            if (leafId !== undefined && descendants.includes(leafId) && this.isRowSelectable(row, rowIndex))
                selectableIds.push(leafId);
        });
        const selectedCount: number = selectableIds.filter((leafId) => this.selectedRowIds.has(leafId)).length;
        const checked: boolean = selectableIds.length > 0 && selectedCount === selectableIds.length;
        return {
            checked,
            indeterminate: selectedCount > 0 && !checked,
            disabled: selectableIds.length === 0,
            group: true,
            rowIds: selectableIds,
        };
    }

    private toggleGroupSelection(rowIds: RowId[]): void {
        if (rowIds.length === 0) return;
        const allSelected: boolean = rowIds.every((rowId) => this.selectedRowIds.has(rowId));
        rowIds.forEach((rowId) => {
            if (allSelected) this.selectedRowIds.delete(rowId);
            else this.selectedRowIds.add(rowId);
        });
        this.refresh();
    }

    private applySelection(rowId: RowId, index: number, modifiers: { shiftKey?: boolean; ctrlKey?: boolean }): void {
        if (!this.api) return;
        const processedData = this.api.getProcessedData();
        const row = processedData[index];
        if (!row || !this.isRowSelectable(row, index)) return;

        if (
            this.mode === "single" &&
            !this.replaceSelectionOnClick &&
            this.selectedRowIds.has(rowId) &&
            !modifiers.shiftKey
        ) {
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
        const selectionColumn: ColumnDef<T> & { filterable: false } = {
            id: this.selectionColumnId,
            header: "",
            width: this.selectionColumnWidth,
            minWidth: this.selectionColumnWidth,
            maxWidth: this.selectionColumnWidth,
            align: "center",
            sortable: false,
            filterable: false,
            stopHeaderClick: true,
            stopRowClick: true,
            // The checkbox column must always stay pinned to the left.
            pinned: "left",
            headerRenderer: () =>
                this.renderCheckbox({
                    checked: this.isAllSelectableRowsSelected(),
                    indeterminate: this.hasSomeSelectableRowsSelected() && !this.isAllSelectableRowsSelected(),
                    disabled: !this.hasSelectableRows(),
                    ariaLabel: "Select all rows",
                    header: true,
                    onChange: (event) => this.toggleAll(event),
                }),
            cellRenderer: ({ data, id, index }) => {
                if (id === undefined || index === undefined) {
                    return this.renderCheckbox({
                        checked: false,
                        indeterminate: false,
                        disabled: true,
                        ariaLabel: "Select row",
                        header: false,
                        onChange: () => {},
                    });
                }
                const checkboxState: CheckboxState<T> = this.getCheckboxState(id, index, data);
                if (checkboxState.group && (this.mode !== "multiple" || this.groupSelection === "none")) return "";
                return this.renderCheckbox({
                    checked: checkboxState.checked,
                    indeterminate: checkboxState.indeterminate,
                    disabled: checkboxState.disabled,
                    ariaLabel: checkboxState.group ? "Select group" : "Select row",
                    data: checkboxState.group ? undefined : checkboxState.data,
                    rowId: id,
                    index: checkboxState.index,
                    header: false,
                    group: checkboxState.group,
                    onChange: (event) => {
                        if (checkboxState.group) {
                            this.toggleGroupSelection(checkboxState.rowIds);
                        } else if (this.api?.getRowHierarchy()) {
                            this.toggleStableRow(id, event, checkboxState.index ?? index);
                        } else {
                            this.toggleRow(id, index, event);
                        }
                    },
                });
            },
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
            processedData.every(
                (row, index) =>
                    !this.isRowSelectable(row, index) || this.selectedRowIds.has(this.getSelectionRowId(row, index)),
            )
        );
    }

    private hasSomeSelectableRowsSelected(): boolean {
        if (!this.api) return false;
        return this.api
            .getProcessedData()
            .some(
                (row, index) =>
                    this.isRowSelectable(row, index) && this.selectedRowIds.has(this.getSelectionRowId(row, index)),
            );
    }

    private toggleAll(modifiers: { shiftKey: boolean; ctrlKey: boolean }): void {
        if (!this.api) return;
        const processedData = this.api.getProcessedData();
        if (this.isAllSelectableRowsSelected()) {
            processedData.forEach((row, index) => {
                if (this.isRowSelectable(row, index)) this.selectedRowIds.delete(this.getSelectionRowId(row, index));
            });
        } else {
            processedData.forEach((row, index) => {
                if (this.isRowSelectable(row, index)) this.selectedRowIds.add(this.getSelectionRowId(row, index));
            });
        }
        this.refresh();
    }

    private refresh(): void {
        if (!this.api || this.api.isDestroyed()) return;
        this.api.setState((prev) => ({ ...prev, selection: this.getSelectionState() }));
        this.api.refresh();
        this.onSelectionChange?.(this.getSelectionState());
    }

    private validateSelection(): void {
        if (!this.api) return;
        const processedData = this.api.getProcessedData();
        const validIds = new Set<RowId>();
        for (let i = 0; i < processedData.length; i += 1) {
            const row = processedData[i];
            if (this.isRowSelectable(row, i)) validIds.add(this.getSelectionRowId(row, i));
        }
        let hasChanges = false;
        for (const rowId of this.selectedRowIds) {
            if (!validIds.has(rowId)) {
                this.selectedRowIds.delete(rowId);
                hasChanges = true;
            }
        }
        if (hasChanges) {
            this.refresh();
        }
    }

    /**
     * Updates plugin options at runtime.
     * @api
     */
    public updateOptions(newOptions: Partial<SelectionPluginOptions<T>>): void {
        if (newOptions.mode !== undefined) (this as any).mode = newOptions.mode;
        if (newOptions.checkboxOnly !== undefined) (this as any).checkboxOnly = newOptions.checkboxOnly;
        if (newOptions.replaceSelectionOnClick !== undefined)
            (this as any).replaceSelectionOnClick = newOptions.replaceSelectionOnClick;
        if (newOptions.groupSelection !== undefined) this.groupSelection = newOptions.groupSelection;
        if (newOptions.showRowCheckboxes !== undefined) (this as any).showRowCheckboxes = newOptions.showRowCheckboxes;
        if (newOptions.showHeaderCheckbox !== undefined)
            (this as any).showHeaderCheckbox = newOptions.showHeaderCheckbox;
        if (newOptions.isRowSelectable !== undefined) (this as any).isRowSelectable = newOptions.isRowSelectable;
        if (newOptions.checkboxRenderer !== undefined) (this as any).checkboxRenderer = newOptions.checkboxRenderer;
        if (newOptions.onSelectionChange !== undefined) this.onSelectionChange = newOptions.onSelectionChange;

        this.updateColumns();
        this.validateSelection();
        this.refresh();
    }
}
