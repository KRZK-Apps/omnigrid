import type { CheckboxRenderParams, RowId } from "@omnigrid/core";

/** Selection behavior supported by the plugin. */
export type SelectionMode = "single" | "multiple";

/** Values provided to a custom checkbox renderer. */
export interface SelectionRendererParams<T> extends CheckboxRenderParams {
    /** Row data for a row checkbox; absent for the header checkbox. */
    data?: T;
    /** Row identifier for a row checkbox. */
    rowId?: RowId;
    /** Row index for a row checkbox. */
    index?: number;
    /** Whether the renderer is being called for the header checkbox. */
    header: boolean;
}

/** Renderer used to customize selection checkboxes. */
export type SelectionRenderer<T> = (params: SelectionRendererParams<T>) => unknown;

/** Configuration for the selection plugin. */
export interface SelectionPluginOptions<T> {
    /** Supports selecting one row or multiple rows. @default "single" */
    mode?: SelectionMode;
    /** Restricts selection changes to checkbox interaction. @default false */
    checkboxOnly?: boolean;
    /** In multiple mode, clicking a row replaces the current selection. @default false */
    replaceSelectionOnClick?: boolean;
    /** Adds a checkbox to each row. @default false */
    showRowCheckboxes?: boolean;
    /** Adds a select-all checkbox to the selection column header. @default false */
    showHeaderCheckbox?: boolean;
    /** Determines whether a row can be selected. */
    isRowSelectable?: (row: T, index: number) => boolean;
    /** Renders checkbox UI; defaults to the OmniGrid checkbox renderer. */
    checkboxRenderer?: SelectionRenderer<T>;
    /** Called when the selected rows change. */
    onSelectionChange?: (state: SelectionState<T>) => void;
    /** ID for the automatically inserted checkbox column. @default "__omnigrid_selection__" */
    selectionColumnId?: string;
    /** Width in pixels of the automatically inserted checkbox column. @default 44 */
    selectionColumnWidth?: number;
}

/** Selected row identifiers and their corresponding row data. */
export interface SelectionState<T> {
    /** IDs of selected rows. */
    selectedRowIds: RowId[];
    /** Data objects for selected rows. */
    selectedRows: T[];
}

declare module "@omnigrid/core" {
    interface PluginStateExtensions<T> {
        /** Active selection state. */
        selection?: SelectionState<T>;
    }

    interface PluginApiExtensions<T> {
        /** Selects a row by id. */
        selectRow?: (rowId: RowId) => void;
        /** Deselects a row by id. */
        deselectRow?: (rowId: RowId) => void;
        /** Returns the current selection state. */
        getSelection?: () => SelectionState<T>;
        /** Clears the current selection. */
        clearSelection?: () => void;
    }
}

