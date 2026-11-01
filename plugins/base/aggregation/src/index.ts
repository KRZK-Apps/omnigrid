import type { ColumnDef, ColumnLeafDef, GridApi } from "@omnigrid/core";
import type { AggregationFunc, ResolvedAggregationFunc } from "./types";
import { DEFAULT_AGGREGATION_FUNCS } from "./types";

export type { AggregationFunc, ResolvedAggregationFunc } from "./types";
export { DEFAULT_AGGREGATION_FUNCS } from "./types";

/**
 * Module augmentation: adds `aggFunc` to `ColumnLeafDef` so that TypeScript
 * recognizes it when the aggregation plugin is in scope. Core itself does not
 * know about `aggFunc` — it is purely a plugin concern.
 */
declare module "@omnigrid/core" {
    interface ColumnLeafDef<T> {
        /** Aggregation function used when this column is inside a group. */
        aggFunc?: AggregationFunc<T>;
    }

    interface PluginApiExtensions<T> {
        /** Registers column id -> aggregation function mappings. */
        registerAggregationFuncs: (funcs: Record<string, ResolvedAggregationFunc<T>>) => () => void;
    }
}

/**
 * Registry of column id -> aggregation function mappings. Scans column
 * definitions for `aggFunc` and registers them with the grid so that
 * `computeAggregations` can compute group-level aggregates.
 *
 * @api
 */
export class AggregationRegistry<T> {
    private api?: GridApi<T>;
    private readonly funcs: Record<string, AggregationFunc<T>> = {};
    private unregister?: () => void;

    private resolve(func: AggregationFunc<T>): (values: unknown[]) => unknown {
        if (typeof func === "string") {
            const resolved = (DEFAULT_AGGREGATION_FUNCS as Record<string, (values: unknown[]) => unknown>)[func];
            if (resolved) {
                return resolved;
            }
            throw new Error(`Unknown aggregation function: ${func}`);
        }
        return func as (values: unknown[]) => unknown;
    }

    private getResolvedFuncs(): Record<string, (values: unknown[]) => unknown> {
        const resolved: Record<string, (values: unknown[]) => unknown> = {};
        for (const [columnId, func] of Object.entries(this.funcs)) {
            resolved[columnId] = this.resolve(func);
        }
        return resolved;
    }

    public register(api: GridApi<T>): () => void {
        this.api = api;
        this.applyFuncs();
        this.unregister = api.registerAggregationFuncs(this.getResolvedFuncs() as Record<string, (values: unknown[]) => unknown>);
        return () => {
            this.unregister?.();
            this.unregister = undefined;
            this.api = undefined;
        };
    }

    /** Registers an aggregation function for a column id. */
    public set(columnId: string, func: AggregationFunc<T>): void {
        this.funcs[columnId] = func;
        this.applyFuncs();
    }

    /** Removes an aggregation function for a column id. */
    public unset(columnId: string): void {
        delete this.funcs[columnId];
        this.applyFuncs();
    }

    /** Clears all registered aggregation functions. */
    public clear(): void {
        Object.keys(this.funcs).forEach((key) => delete this.funcs[key]);
        this.applyFuncs();
    }

    /** Returns a copy of the current funcs map. */
    public getFuncs(): Record<string, AggregationFunc<T>> {
        return { ...this.funcs };
    }

    private applyFuncs(): void {
        if (this.api && !this.api.isDestroyed()) {
            this.api.registerAggregationFuncs(this.getResolvedFuncs() as Record<string, (values: unknown[]) => unknown>);
        }
    }
}

/** Plugin entry point implementing the GridPlugin contract. */
export class AggregationPlugin<T> {
    public readonly name = "@omnigrid/aggregation-plugin";
    private api?: GridApi<T>;
    private readonly registry = new AggregationRegistry<T>();
    private unregisterRegistry?: () => void;

    private collectAggFuncs(columns: ColumnDef<T>[]): void {
        const stack: ColumnDef<T>[] = [...columns];
        while (stack.length > 0) {
            const column = stack.pop()!;
            const maybeGroup = column as unknown as { children?: ColumnDef<T>[] };
            if (Array.isArray(maybeGroup.children)) {
                stack.push(...maybeGroup.children);
                continue;
            }
            const leaf = column as ColumnLeafDef<T> & { aggFunc?: AggregationFunc<T> };
            const aggFunc = leaf.aggFunc;
            if (aggFunc) {
                this.registry.set(leaf.id, aggFunc);
            }
        }
    }

    public register(api: GridApi<T>): () => void {
        this.api = api;
        const columns = api.getState().columns;
        this.collectAggFuncs(columns);
        this.unregisterRegistry = this.registry.register(api);
        return () => {
            this.unregisterRegistry?.();
            this.unregisterRegistry = undefined;
            this.registry.clear();
            this.api = undefined;
        };
    }
}
