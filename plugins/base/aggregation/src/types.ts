/** Aggregation function applied to a column's values within a group. */
export type AggregationFunc<T = unknown> =
    | "sum"
    | "avg"
    | "min"
    | "max"
    | "count"
    | ((values: unknown[]) => unknown);

/** Resolved aggregation callback registered with the grid grouping engine. */
export type ResolvedAggregationFunc<T = unknown> = (values: unknown[]) => unknown;

/** Built-in aggregation function implementations keyed by name. */
export const DEFAULT_AGGREGATION_FUNCS: Record<string, AggregationFunc<unknown>> = {
    sum: (values: unknown[]): unknown => {
        const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        return nums.reduce((total, v) => total + v, 0);
    },
    avg: (values: unknown[]): unknown => {
        const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        return nums.length > 0 ? nums.reduce((total, v) => total + v, 0) / nums.length : undefined;
    },
    min: (values: unknown[]): unknown => {
        const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        return nums.length > 0 ? Math.min(...nums) : undefined;
    },
    max: (values: unknown[]): unknown => {
        const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        return nums.length > 0 ? Math.max(...nums) : undefined;
    },
    count: (values: unknown[]): unknown => values.length,
};
