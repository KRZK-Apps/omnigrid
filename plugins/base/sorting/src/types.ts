import type { SortDirection } from "@omnigrid/core";

/** A single item in the sorting plugin's sort model. */
export interface SortModelItem {
    /** Column identifier being sorted. */
    columnId: string;
    /** Sort direction. */
    direction: SortDirection;
}

declare module "@omnigrid/core" {
    interface PluginStateExtensions<T> {
        /** Active sort model applied to rows. */
        sortModel?: SortModelItem[];
    }

    interface PluginApiExtensions<T> {
        /** Sets the active sorting model. */
        setSortModel?: (model: SortModelItem[]) => void;
        /** Returns the active sorting model. */
        getSortModel?: () => SortModelItem[];
    }
}


