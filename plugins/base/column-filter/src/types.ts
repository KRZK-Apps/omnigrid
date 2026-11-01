import type { ColumnDataType, ColumnFilterType, FilterOperator } from "@omnigrid/core";

/** Column definition extensions added by the column filter plugin. */
export interface ColumnFilterColumnDef<T> {
    /** Nature of the values in this column. When omitted, the plugin infers it by sampling the data. */
    dataType?: ColumnDataType;
    /** Kind of filter UI rendered for this column. When omitted, it is derived from `dataType`. */
    filterType?: ColumnFilterType;
    /** Identifier of a custom filter registered with the filtering plugin. Required when `filterType` is `"custom"`. */
    filterTypeId?: string;
    /** Whether this column offers a filter menu. Set to `false` to opt the column out of filtering UI. @default true */
    filterable?: boolean;
    /** Custom subset of operators allowed for this column's filter menu. */
    allowedOperators?: FilterOperator[];
    /** Fixed option list used by the `"set"` filter. */
    filterOptions?: Array<{ label: string; value: any }>;
}
