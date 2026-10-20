import type { ColumnDataType, ColumnFilterType, ColumnLeafDef } from "@omnigrid/core";

const ISO_DATE_REGEX: RegExp = /^\d{4}-\d{2}-\d{2}/;

/**
 * Determines the data type of a column, either from explicit `column.dataType`,
 * or inferred by sampling rows. Presence of `filterOptions` no longer forces
 * `dataType` to `"select"`.
 *
 * @param column - Column definition to inspect.
 * @param rows - Current data rows to inspect values.
 * @returns The resolved column data type.
 */
export function inferColumnDataType<T>(column: ColumnLeafDef<T>, rows: T[]): ColumnDataType {
    if (column.dataType) return column.dataType;

    for (const row of rows) {
        if (!row) continue;
        let value: unknown;
        if (column.valueGetter) {
            value = column.valueGetter(row);
        } else if (column.field) {
            value = (row as Record<string, unknown>)[column.field as string];
        }
        if (value === undefined || value === null || value === "") continue;

        if (typeof value === "boolean") return "boolean";
        if (typeof value === "number") return "number";
        if (value instanceof Date) return "date";
        if (typeof value === "string" && ISO_DATE_REGEX.test(value) && !Number.isNaN(Date.parse(value))) {
            return "date";
        }
        return "text";
    }

    return "text";
}

/**
 * Resolves the effective filter type for a column.
 *
 * - If `column.filterType` is set, use it.
 * - If `column.filterOptions` is set (and length > 0), default to `"set"`.
 * - Otherwise derive from `column.dataType` or from data sampling.
 */
export function resolveFilterType<T>(column: ColumnLeafDef<T>, dataType: ColumnDataType, hasOptions: boolean): ColumnFilterType {
    if (column.filterType) return column.filterType;
    if (hasOptions) return "set";
    return dataType as ColumnFilterType;
}
