import type { ColumnDataType, ColumnLeafDef } from "@omnigrid/core";

const ISO_DATE_REGEX: RegExp = /^\d{4}-\d{2}-\d{2}/;

/**
 * Determines the data type of a column, either from explicit `column.dataType`,
 * inferred from `column.filterOptions`, or inferred by sampling rows.
 *
 * @param column - Column definition to inspect.
 * @param rows - Current data rows to inspect values.
 * @returns The resolved column data type.
 */
export function inferColumnDataType<T>(column: ColumnLeafDef<T>, rows: T[]): ColumnDataType {
    if (column.dataType) return column.dataType;
    if (column.filterOptions && column.filterOptions.length > 0) return "select";

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
