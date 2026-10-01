import type { GridOptions, GridState, ViewportData } from '@omnigrid/core';
import { Grid } from '@omnigrid/core';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

export interface UseGridResult<T> {
    grid: Grid<T>;
    state: GridState<T>;
    viewportData: ViewportData<T>;
}

/**
 * Binds the Grid instance from @omnigrid/core to the React lifecycle.
 *
 * NOTE on the destroyed incident:
 * Do NOT add `return () => grid.destroy()` in the effect cleanup!
 * In dev mode React.StrictMode runs: mount → cleanup → mount.
 * If cleanup destroys the grid, the second mount (grid.setData) will throw
 * "Grid has been destroyed". To prevent this:
 *   - destroy() is NOT called automatically (the grid lifecycle is managed
 *     by the core user, not React);
 *   - all grid access is guarded by grid.isDestroyed().
 *
 * Subscription model:
 * The grid Store only notifies on structural changes (data, columns,
 * dimensions). Scroll-only updates (scrollTop / scrollLeft) bypass the Store
 * entirely, so useSyncExternalStore does NOT trigger a React re-render on
 * every scroll frame. The DOM Pool handles scroll imperatively.
 */
export function useGrid<T>(options: GridOptions<T>): UseGridResult<T> {
    // Lazy initializer is intentionally avoided: React.StrictMode may call it
    // twice, which would register plugins twice.
    const gridRef = useRef<Grid<T> | null>(null);
    if (!gridRef.current) gridRef.current = new Grid(options);
    const grid = gridRef.current;

    const subscribe = useCallback(
        (listener: () => void) => grid.subscribe(listener),
        [grid],
    );
    const getSnapshot = useCallback(() => grid.getState(), [grid]);
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    // Sync data when the data reference changes (async load, pagination,
    // parent-side filtering). Skip on the first run — the Grid constructor
    // already initialised data from options.data. Only sync on subsequent
    // reference changes.
    const dataSyncedRef = useRef(false);
    useEffect(() => {
        if (grid.isDestroyed()) return;
        if (!dataSyncedRef.current) {
            dataSyncedRef.current = true;
            return;
        }
        grid.setData(options.data ?? []);
    }, [grid, options.data]);

    // Sync columns when the columns reference changes (e.g. dynamic column
    // definitions). Skip on the first run — plugins may have prepended
    // selection/sorting columns during registerPlugin() in the Grid
    // constructor, and calling setColumns here would overwrite those injected
    // columns. Only sync on subsequent changes to options.columns.
    //
    // StrictMode note: `options.columns` is a new array reference on every
    // render, but its entries are usually the same column objects (a new
    // array wrapping the same definitions). We compare by reference of the
    // *entries*, not the array itself, so a re-render under StrictMode does
    // not wipe plugin-injected columns (selection/sorting). The reference
    // comparison also avoids redundant setColumns calls that would clobber
    // plugin state when nothing actually changed.
    const columnsSyncedRef = useRef(false);
    const lastSyncedColumnsRef = useRef<GridOptions<T>["columns"]>(undefined);
    useEffect(() => {
        if (grid.isDestroyed()) return;
        if (!columnsSyncedRef.current) {
            columnsSyncedRef.current = true;
            lastSyncedColumnsRef.current = options.columns;
            return;
        }
        const prev = lastSyncedColumnsRef.current ?? [];
        const next = options.columns ?? [];
        if (prev.length !== next.length || prev.some((column, index) => column !== next[index])) {
            lastSyncedColumnsRef.current = options.columns;
            grid.setColumns(options.columns);
        }
    }, [grid, options.columns]);

    return {
        grid,
        state,
        viewportData: grid.getViewportData(),
    };
}
