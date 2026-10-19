import { flattenColumns, getCellValue } from "./columns";
import type { ColumnDef, ColumnLeafDef } from "./types";

/**
 * Comparison operators supported by the core filter engine.
 *
 * @api
 */
export type FilterOperator =
    | "contains"
    | "notContains"
    | "equals"
    | "notEqual"
    | "startsWith"
    | "endsWith"
    | "greaterThan"
    | "greaterThanOrEqual"
    | "lessThan"
    | "lessThanOrEqual"
    | "inRange"
    | "in"
    | "blank"
    | "notBlank"
    | "isEmpty"
    | "isNotEmpty";

/**
 * A single filter predicate applied to one column.
 *
 * Conditions whose required operand is missing (`undefined`, `null` or an empty
 * string) are treated as inactive and let every row through, so half-typed
 * input never blanks the grid.
 *
 * @api
 */
export interface FilterCondition {
    /** Comparison operator. */
    operator: FilterOperator;
    /** Primary operand. For `in` it is an array of accepted values. */
    value?: unknown;
    /** Upper bound operand, used by `inRange` (inclusive). */
    valueTo?: unknown;
    /** Makes text operators case sensitive. @default false */
    caseSensitive?: boolean;
}

/**
 * Filter state of one column: one or more conditions combined with `logic`.
 *
 * @api
 */
export interface ColumnFilterModel {
    /** Conditions evaluated against the column value. */
    conditions: FilterCondition[];
    /** How multiple conditions combine. @default "and" */
    logic?: "and" | "or";
}

/**
 * Filter state of the whole grid, keyed by column id (or column field).
 * Columns are combined with logical AND.
 *
 * @api
 */
export type FilterModel = Record<string, ColumnFilterModel>;

type RowPredicate<T> = (row: T) => boolean;

function isEmptyOperand(value: unknown): boolean {
    return value === undefined || value === null || value === "";
}

function isBlank(value: unknown): boolean {
    return value === undefined || value === null || value === "";
}

/** True when the condition carries enough information to be evaluated. */
export function isActiveCondition(condition: FilterCondition): boolean {
    switch (condition.operator) {
        case "blank":
            return true;
        case "notBlank":
            return true;
        case "isEmpty":
            return true;
        case "isNotEmpty":
            return true;
        case "inRange":
            return !isEmptyOperand(condition.value) || !isEmptyOperand(condition.valueTo);
        case "in":
            return Array.isArray(condition.value);
        default:
            return !isEmptyOperand(condition.value);
    }
}

/** Returns true when the model contains at least one active condition. */
export function isFilterModelActive(model: FilterModel): boolean {
    return Object.values(model).some((entry) => entry.conditions.some(isActiveCondition));
}

function toComparable(value: unknown): number | string {
    if (typeof value === "number") return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "boolean") return value ? 1 : 0;
    return String(value);
}

/** Compares a cell value to an operand; numeric when both sides are numeric, textual otherwise. */
function compareValues(cell: unknown, operand: unknown): number {
    const left: number | string = toComparable(cell);
    let right: number | string = toComparable(operand);
    if (typeof left === "number") {
        if (typeof right === "string") right = right.trim() === "" ? Number.NaN : Number(right);
        return left - (right as number);
    }
    if (typeof right === "number") {
        const parsed: number = Number(left);
        return parsed - right;
    }
    const leftNumber: number = Number(left);
    const rightNumber: number = Number(right);
    if (left.trim() !== "" && right.trim() !== "" && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function normalizeText(value: unknown, caseSensitive: boolean): string {
    const text: string = value instanceof Date ? value.toISOString() : String(value);
    return caseSensitive ? text : text.toLowerCase();
}

function valuesEqual(cell: unknown, operand: unknown, caseSensitive: boolean): boolean {
    if (typeof cell === "number" || cell instanceof Date || typeof cell === "boolean") {
        const result: number = compareValues(cell, operand);
        return result === 0;
    }
    return normalizeText(cell, caseSensitive) === normalizeText(operand, caseSensitive);
}

/** Compiles a condition into a value predicate; `null` means the condition is inactive. */
function compileCondition(condition: FilterCondition): ((value: unknown) => boolean) | null {
    if (!isActiveCondition(condition)) return null;
    const caseSensitive: boolean = condition.caseSensitive ?? false;
    const operand: unknown = condition.value;
    const text: string = isEmptyOperand(operand) ? "" : normalizeText(operand, caseSensitive);

    switch (condition.operator) {
        case "blank":
        case "isEmpty":
            return (value) => isBlank(value);
        case "notBlank":
        case "isNotEmpty":
            return (value) => !isBlank(value);
        case "contains":
            return (value) => !isBlank(value) && normalizeText(value, caseSensitive).includes(text);
        case "notContains":
            return (value) => isBlank(value) || !normalizeText(value, caseSensitive).includes(text);
        case "startsWith":
            return (value) => !isBlank(value) && normalizeText(value, caseSensitive).startsWith(text);
        case "endsWith":
            return (value) => !isBlank(value) && normalizeText(value, caseSensitive).endsWith(text);
        case "equals":
            return (value) => !isBlank(value) && valuesEqual(value, operand, caseSensitive);
        case "notEqual":
            return (value) => isBlank(value) || !valuesEqual(value, operand, caseSensitive);
        case "greaterThan":
            return (value) => !isBlank(value) && compareValues(value, operand) > 0;
        case "greaterThanOrEqual":
            return (value) => !isBlank(value) && compareValues(value, operand) >= 0;
        case "lessThan":
            return (value) => !isBlank(value) && compareValues(value, operand) < 0;
        case "lessThanOrEqual":
            return (value) => !isBlank(value) && compareValues(value, operand) <= 0;
        case "inRange": {
            const hasFrom: boolean = !isEmptyOperand(condition.value);
            const hasTo: boolean = !isEmptyOperand(condition.valueTo);
            return (value) => {
                if (isBlank(value)) return false;
                if (hasFrom && compareValues(value, condition.value) < 0) return false;
                if (hasTo && compareValues(value, condition.valueTo) > 0) return false;
                return true;
            };
        }
        case "in": {
            const accepted: unknown[] = condition.value as unknown[];
            return (value) => accepted.some((item) => valuesEqual(value, item, caseSensitive));
        }
        default:
            return null;
    }
}

/**
 * Evaluates a single value against a column filter model. Exposed so plugins
 * and server-side adapters can reuse the exact core semantics.
 *
 * @api
 */
export function matchesColumnFilter(value: unknown, model: ColumnFilterModel): boolean {
    const predicates: Array<(value: unknown) => boolean> = [];
    for (const condition of model.conditions) {
        const predicate = compileCondition(condition);
        if (predicate) predicates.push(predicate);
    }
    if (predicates.length === 0) return true;
    return model.logic === "or" ? predicates.some((p) => p(value)) : predicates.every((p) => p(value));
}

/** Resolves a model key to a leaf column by id first, then by field. */
function resolveColumn<T>(columns: ColumnLeafDef<T>[], key: string): ColumnLeafDef<T> | undefined {
    return columns.find((column) => column.id === key) ?? columns.find((column) => (column.field as string | undefined) === key);
}

/**
 * Applies a filter model to a dataset. Predicates are compiled once per call, not
 * per row. Returns the input array (same reference) when no condition is active.
 *
 * @param data - Raw rows.
 * @param model - Active filter model.
 * @param columns - Column definitions used to resolve cell values.
 * @returns Rows matching every column filter.
 * @api
 */
export function applyFilterModel<T>(data: T[], model: FilterModel, columns: ColumnDef<T>[]): T[] {
    const leaves: ColumnLeafDef<T>[] = flattenColumns(columns);
    const compiled: Array<{ column: ColumnLeafDef<T>; predicate: RowPredicate<unknown> }> = [];

    for (const [key, entry] of Object.entries(model)) {
        const column = resolveColumn(leaves, key);
        if (!column) continue;
        const predicates: Array<(value: unknown) => boolean> = [];
        for (const condition of entry.conditions) {
            const predicate = compileCondition(condition);
            if (predicate) predicates.push(predicate);
        }
        if (predicates.length === 0) continue;
        const isOr: boolean = entry.logic === "or";
        compiled.push({
            column,
            predicate: (value: unknown) => (isOr ? predicates.some((p) => p(value)) : predicates.every((p) => p(value))),
        });
    }

    if (compiled.length === 0) return data;
    return data.filter((row) => compiled.every(({ column, predicate }) => predicate(getCellValue(row, column))));
}

/**
 * Splits a quick filter query into comma-separated terms, trims whitespace,
 * and matches every row against the union of searchable columns.
 *
 * Terms are matched case-insensitively using `String.prototype.includes`.
 * A column participates when its `searchable` property is not `false`; the
 * column's `valueGetter` takes precedence over `field` when resolving the
 * cell value. An empty query returns the input array unchanged (same
 * reference) so callers can short-circuit.
 *
 * @param data - Rows to filter.
 * @param query - The raw quick filter query (may contain commas).
 * @param columns - Column definitions used to resolve searchable columns.
 * @returns Rows matching at least one term in at least one searchable column.
 * @api
 */
export function applyQuickFilter<T>(data: T[], query: string, columns: ColumnDef<T>[]): T[] {
    const trimmed: string = query.trim();
    if (trimmed === "") return data;

    const terms: string[] = trimmed
        .split(",")
        .map((term) => term.trim().toLowerCase())
        .filter((term) => term.length > 0);
    if (terms.length === 0) return data;

    const searchable: ColumnLeafDef<T>[] = flattenColumns(columns).filter((column) => column.searchable !== false);
    if (searchable.length === 0) return data;

    return data.filter((row) =>
        searchable.some((column) => {
            const value: unknown = getCellValue(row, column);
            if (value === undefined || value === null) return false;
            const text: string = String(value).toLowerCase();
            return terms.some((term) => text.includes(term));
        }),
    );
}
