import type { SortDirection } from "@omnigrid/core";

/** One active column sort in priority order. */
export interface SortModelItem {
    /** ID of the sorted column. */
    columnId: string;
    /** Direction in which the column values are ordered. */
    direction: SortDirection;
}
