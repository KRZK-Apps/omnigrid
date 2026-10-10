import { type CSSProperties, type ReactNode, type UIEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import type { CellRenderParams, ColumnLeafDef, GridOptions, RowRenderParams, RowStyle, SlotMount, SlotName, SlotPosition, SlotRenderContext } from "@omnigrid/core";
import { DomPool } from "@omnigrid/core";

import { type ContentBridge, contentToReactNode } from "./content";
import { computeGroupSegments } from "./groupHeader";
import { type PooledColumn, type PooledRowCallbacks, PooledRowPane } from "./pooledRow";
import { createCellRoot } from "./reactRoot";
import { useGrid } from "./useGrid";

/**
 * Registry of native adapter components for `SlotComponentContent`:
 *   slotComponents={{ ["my-widget"]: (payload, context) => <MyWidget .../> }}
 */
export interface SlotRendererRegistry<T> {
    [kind: string]: (payload: unknown, context: SlotRenderContext<T>) => ReactNode;
}

export interface GridProps<T> extends GridOptions<T> {
    className?: string;
    style?: CSSProperties;
    slotComponents?: SlotRendererRegistry<T>;
}

function getCellValue<T>(row: T, column: ColumnLeafDef<T>): unknown {
    if (column.valueGetter) return column.valueGetter(row);
    // `field` is `keyof T | string` (loose rows), so index via a string-keyed cast.
    if (column.field) return (row as Record<string, unknown>)[column.field as string];
    return undefined;
}

const SLOT_POSITIONS: SlotPosition[] = ["start", "center", "end"];

/**
 * Per-layer (DomPool + pane tracking) state for the three horizontal column
 * groups: pinned-left, scrollable, and pinned-right. The core's `ViewportData`
 * yields absolute (table-space) offsets; each layer translates those into its
 * own local coordinate space via `originX` (consumed by `PooledRowPane`).
 */
interface RowLayerState<T> {
    pool: DomPool<T> | null;
    panes: PooledRowPane<T>[];
    paneMap: WeakMap<object, PooledRowPane<T>>;
    columns: PooledColumn<T>[];
    windowKey: string;
    revision: number;
    totalWidth: number;
    processed: unknown[] | null;
    originX: number;
    rowWidth: number;
}

function createRowLayerState<T>(): RowLayerState<T> {
    return {
        pool: null,
        panes: [],
        paneMap: new WeakMap(),
        columns: [],
        windowKey: "",
        revision: -1,
        totalWidth: -1,
        processed: null,
        originX: 0,
        rowWidth: 0,
    };
}

/**
 * React adapter over the headless core.
 *
 * Rows are rendered via the DOM Pool: a fixed number of nodes that, on scroll,
 * only change `transform: translateY` (position) and update content in-place
 * (textContent / innerHTML / isolated createRoot) — without node creation
 * or React reconciliation on the scroll hot path.
 *
 * Scroll position is decoupled from React's render cycle: `Grid.setViewport`
 * for scroll-only updates does NOT notify the Store, so React does NOT
 * re-render on every scroll frame. React re-renders only on structural
 * changes (data, columns, dimensions) and column-window changes (header only).
 *
 * Horizontally pinned columns each back onto their own `DomPool` whose rows
 * live in a `position: sticky` pane (a sibling of the scrollable content inside
 * the single scroll container). Sticky panes share the scroll container's
 * vertical scroll natively — no imperative `scrollTop` sync is required —
 * while staying fixed on the horizontal axis so pinned cells never leave the
 * viewport. Each pane renders only its column group, translating the core's
 * absolute offsets into local coordinates via `originX`.
 *
 * Slots (`top` / `bottom` / `left` / `right`) are materialised from the
 * core's headless content; React components in slots are connected via
 * `slotComponents`.
 */
export function OmniGrid<T>({ className, style, slotComponents, ...options }: GridProps<T>) {
    const { grid, state, viewportData } = useGrid(options);

    const viewportRef = useRef<HTMLDivElement>(null);
    const rowsLayerRef = useRef<HTMLDivElement>(null);
    const pinnedLeftRowsLayerRef = useRef<HTMLDivElement>(null);
    const pinnedRightRowsLayerRef = useRef<HTMLDivElement>(null);
    const [isMeasured, setIsMeasured] = useState(false);
    const scrollFrameRef = useRef<{ id: number; top: number; left: number }>({ id: 0, top: 0, left: 0 });
    const optionsRef = useRef<GridOptions<T>>(options);
    const columnWindowKeyRef = useRef("");
    const scrollbarWidthRef = useRef(0);
    const slotComponentsRef = useRef<SlotRendererRegistry<T>>({});

    const layersRef = useRef<{ central: RowLayerState<T>; left: RowLayerState<T>; right: RowLayerState<T> } | null>(null);
    if (!layersRef.current) {
        layersRef.current = {
            central: createRowLayerState<T>(),
            left: createRowLayerState<T>(),
            right: createRowLayerState<T>(),
        };
    }
    const layers = layersRef.current;

    const layerContextRef = useRef<{ bridge: ContentBridge<T> } | null>(null);

    // `columnWindowVersion` is a simple counter that increments each time the
    // horizontal column window changes (i.e., when scrollLeft crosses a
    // column boundary). It exists solely to trigger a targeted React re-render
    // of the header — row DOM nodes remain managed by the DomPool and are
    // never touched by React's reconciliation.
    const [, setColumnWindowVersion] = useState(0);

    optionsRef.current = options;
    slotComponentsRef.current = slotComponents ?? {};

    // Memoized render context for header cells, group cells, and slot content.
    // `state` has a stable reference (from useSyncExternalStore) when the grid
    // state hasn't changed, so this object is reused across renders instead of
    // re-allocated on every render cycle.
    const renderContext = useMemo<SlotRenderContext<T>>(() => ({ api: grid, state, slot: undefined }), [grid, state]);
    const buildRenderContext = useCallback(() => renderContext, [renderContext]);

    const autoHeight = style?.height === undefined;
    const rowHeight = grid.getState().rowHeight;

    // Column-group header stack: `headerRowCount` group rows (one per depth) above
    // the leaf header row. Without groups `headerRowCount` is 0 and `columnGroupDepth`
    // is empty, collapsing the header to a single row — identical to the flat case.
    const headerRowCount = viewportData.headerRowCount;
    const hasGroups = headerRowCount > 0;
    const headerHeight = (headerRowCount + 1) * rowHeight;

    /**
     * For each leaf column, `columnGroupDepth` maps its flat visible index to the
     * deepest group depth that covers it.
     *
     * A leaf column whose deepest covering group sits at depth `d` only has a
     * group cell in rows `0..d`. The gap rows `d+1 .. headerRowCount-1` (between
     * that covering group and the leaf row) have NO group cell for this column,
     * so the leaf header must extend upward by that many rows to fill the gap
     * — giving full-height borders and vertically-centered text across the
     * entire uncovered span.
     *
     * Columns covered by a group at the maximum depth need no extension: the
     * group cell already sits directly above the leaf row.
     */

    const measuredHeight = viewportData.totalHeight + headerHeight;
    const hasVerticalOverflow = !autoHeight && measuredHeight > state.viewport.height;
    const verticalScrollbarGutter = hasVerticalOverflow ? "stable" : "auto";
    const viewportStyle = { ...style, height: autoHeight ? measuredHeight : style?.height };
    const suppressRowHoverHighlight = options.suppressRowHoverHighlight ?? false;
    const viewportClassName = ["omnigrid", className, suppressRowHoverHighlight ? "omnigrid-no-row-hover" : null].filter(Boolean).join(" ");

    /**
     * Bridge between the core's headless content and React: a factory for the
     * current render context (the registry is read live via the ref).
     */
    function buildBridge(): ContentBridge<T> {
        return {
            registry: slotComponentsRef.current,
            context: buildRenderContext,
        };
    }

    /** Row panel callbacks: close over grid/options, never over DOM. */
    function buildRowCallbacks(bridgeArg: ContentBridge<T>): PooledRowCallbacks<T> {
        const current = () => optionsRef.current;
        return {
            rowHeight,
            renderCellContent: (info) => {
                const column = info.column;
                const value = getCellValue(info.data, column);
                if (column.cellRenderer) {
                    return column.cellRenderer({ value, data: info.data, column, id: info.rowId, index: info.rowIndex });
                }
                return column.valueFormatter ? column.valueFormatter(value) : String(value ?? "");
            },
            resolveRowClasses: (row) => {
                const rowParams: RowRenderParams<T> = { id: row.rowId, index: row.index, data: row.data };
                const currentOptions = current();
                const rowClass = typeof currentOptions.rowClass === "function" ? currentOptions.rowClass(rowParams) : currentOptions.rowClass;
                const dynamicRowClass = currentOptions.getRowClass?.(rowParams);
                const ruleClasses = Object.entries(currentOptions.rowClassRules ?? {})
                    .filter(([, predicate]) => predicate(rowParams))
                    .map(([ruleClass]) => ruleClass);
                const pluginClasses = (currentOptions.plugins ?? [])
                    .map((plugin) => plugin.getRowClass?.(rowParams))
                    .filter((rowClass): rowClass is string => Boolean(rowClass));
                return ["omnigrid-row", rowClass, ...ruleClasses, dynamicRowClass, ...pluginClasses].filter(Boolean).join(" ");
            },
            resolveRowStyle: (row) => {
                const rowParams: RowRenderParams<T> = { id: row.rowId, index: row.index, data: row.data };
                const currentOptions = current();
                const baseRowStyle: RowStyle = {
                    ...(currentOptions.rowStyle ?? {}),
                    ...(currentOptions.getRowStyle?.(rowParams) ?? {}),
                };
                return (currentOptions.plugins ?? []).reduce<RowStyle>(
                    (styleAcc, plugin) => ({ ...styleAcc, ...(plugin.getRowStyle?.(rowParams) ?? {}) }),
                    baseRowStyle,
                );
            },
            resolveCellClasses: (info) => {
                const cellParams: CellRenderParams<T> = { id: info.rowId, index: info.rowIndex, data: info.data, column: info.column };
                const column = info.column;
                const cellClass = typeof column.cellClass === "function" ? column.cellClass(cellParams) : column.cellClass;
                const dynamicCellClass = column.getCellClass?.(cellParams);
                const ruleClasses = Object.entries(column.cellClassRules ?? {})
                    .filter(([, predicate]) => predicate(cellParams))
                    .map(([ruleClass]) => ruleClass);
                return [cellClass, ...ruleClasses, dynamicCellClass].filter(Boolean).join(" ");
            },
            resolveCellStyle: (info) => {
                const cellParams: CellRenderParams<T> = { id: info.rowId, index: info.rowIndex, data: info.data, column: info.column };
                const column = info.column;
                return {
                    ...(column.cellStyle ?? {}),
                    ...(column.getCellStyle?.(cellParams) ?? {}),
                };
            },
            onRowClick: (row, modifiers) =>
                grid.rowClick({
                    id: row.rowId,
                    index: row.index,
                    data: row.data,
                    ctrlKey: modifiers.ctrlKey,
                    shiftKey: modifiers.shiftKey,
                }),
            onRowHover: (row, hovered) => {
                const rowElements = viewportRef.current?.querySelectorAll<HTMLElement>(`[data-row-index="${row.index}"]`);
                rowElements?.forEach((element) => element.classList.toggle("omnigrid-row-hover", hovered));
                grid.rowHover({ id: row.rowId, index: row.index, data: row.data, hovered });
            },
            onCellClick: (row, column, modifiers) => {
                if (column.stopRowClick) return;
                grid.rowClick({
                    id: row.rowId,
                    index: row.index,
                    data: row.data,
                    ctrlKey: modifiers.ctrlKey,
                    shiftKey: modifiers.shiftKey,
                });
            },
            createRoot: (container) => createCellRoot(container),
        };
    }

    /** Lazily creates the bridge (shared by all layers) on first use. */
    const ensureLayerContext = (): ContentBridge<T> => {
        if (!layerContextRef.current) layerContextRef.current = { bridge: buildBridge() };
        return layerContextRef.current.bridge;
    };

    /**
     * Creates the DOM pool for a layer once its rows-layer element is available
     * (post-mount). Bindings translate the layer's column group into local
     * coordinates using the layer's `originX`.
     */
    const ensureLayerPool = (layer: RowLayerState<T>, rowsLayer: HTMLDivElement | null, bridge: ContentBridge<T>): void => {
        if (layer.pool || !rowsLayer) return;
        const { paneMap, panes } = layer;
        layer.pool = new DomPool<T>({
            rowHeight,
            getRowId: (row, index) => grid.getRowId(row, index),
            bindings: {
                createRow: () => {
                    const element = document.createElement("div");
                    rowsLayer.appendChild(element);
                    const pane = new PooledRowPane<T>(element, buildRowCallbacks(bridge), bridge);
                    paneMap.set(element, pane);
                    panes.push(pane);
                    return element;
                },
                bindRow: (host, row) => {
                    const pane = paneMap.get(host);
                    if (pane) pane.bind(row, layer.columns, layer.originX);
                },
                transformRow: (host, offsetY) => {
                    const pane = paneMap.get(host);
                    if (pane) pane.setOffsetY(offsetY);
                },
                recycleRow: (host) => {
                    const pane = paneMap.get(host);
                    if (pane) pane.recycle();
                },
            },
        });
    };

    /**
     * Synchronises a single column-group layer with the grid: lazily creates its
     * DomPool, invalidates on structural changes, then pushes the current row
     * range and per-row width.
     */
    const syncRowLayer = (layer: RowLayerState<T>, rowsLayerRef: React.MutableRefObject<HTMLDivElement | null>): void => {
        const bridge = ensureLayerContext();
        ensureLayerPool(layer, rowsLayerRef.current, bridge);
        const pool = layer.pool;
        if (!pool || grid.isDestroyed()) return;

        const state = grid.getState();
        const currentViewportData = grid.getViewportData();
        const processed = grid.getProcessedData();

        const changed = layer.revision !== grid.getRevision() || layer.totalWidth !== currentViewportData.totalWidth || layer.processed !== processed;
        if (changed) {
            layer.revision = grid.getRevision();
            layer.totalWidth = currentViewportData.totalWidth;
            layer.processed = processed;
            pool.invalidate();
        }

        pool.update({
            data: processed,
            rowRange: currentViewportData.rowRange,
            rowHeight: state.rowHeight,
            rowWidth: layer.rowWidth,
        });
    };

    /**
     * Synchronises the DomPools with the grid. Idempotent — called both from
     * React effects (structural changes) and directly from the scroll rAF
     * handler (imperative, no React re-render).
     */
    const syncPool = (synchronousColumnWindow = false): void => {
        const state = grid.getState();
        const currentViewportData = grid.getViewportData();

        const pinnedLeftWidth = currentViewportData.pinnedLeftColumns.reduce((sum, item) => sum + item.width, 0);
        const pinnedRightWidth = currentViewportData.pinnedRightColumns.reduce((sum, item) => sum + item.width, 0);
        const scrollableWidth = Math.max(0, currentViewportData.totalWidth - pinnedLeftWidth - pinnedRightWidth);

        // Configure each layer: which columns it renders, the table-space origin
        // of its coordinate system (subtracted from core offsets), and the pixel
        // width of its row hosts.
        layers.left.columns = currentViewportData.pinnedLeftColumns;
        layers.left.originX = 0;
        layers.left.rowWidth = pinnedLeftWidth;

        layers.central.columns = currentViewportData.columns;
        layers.central.originX = pinnedLeftWidth;
        layers.central.rowWidth = Math.max(scrollableWidth, state.viewport.width - pinnedLeftWidth - pinnedRightWidth);

        layers.right.columns = currentViewportData.pinnedRightColumns;
        layers.right.originX = pinnedLeftWidth + scrollableWidth;
        layers.right.rowWidth = pinnedRightWidth;

        syncRowLayer(layers.left, pinnedLeftRowsLayerRef);
        syncRowLayer(layers.central, rowsLayerRef);
        syncRowLayer(layers.right, pinnedRightRowsLayerRef);

        // The horizontal column window changes infrequently (only when
        // crossing column boundaries). When it does, update central row cells
        // imperatively AND trigger a targeted React re-render for the header.
        // Pinned panes hold all their columns at once — they only rebind via
        // the structural path above (revision bump).
        const columnWindowKey = `${currentViewportData.columnRange.start}:${currentViewportData.columnRange.end}:${state.viewport.width}:${pinnedLeftWidth}:${pinnedRightWidth}`;
        if (columnWindowKey !== columnWindowKeyRef.current) {
            columnWindowKeyRef.current = columnWindowKey;
            const updateColumnWindow = (): void => {
                for (const pane of layers.central.panes) pane.updateColumns(layers.central.columns, layers.central.originX);
                setColumnWindowVersion((v) => v + 1);
            };
            if (synchronousColumnWindow) {
                // Keep React-rendered cell content and headers in step with the
                // imperative cell repositioning before the browser paints.
                flushSync(updateColumnWindow);
            } else {
                updateColumnWindow();
            }
        }
    };

    /**
     * Measures viewport dimensions from the DOM and syncs them to the core.
     * Called on mount and on ResizeObserver events.
     *
     * The available content width (clientWidth) already excludes the scrollbar
     * width. When `scrollbar-gutter: stable` is active (modern browsers), the
     * browser reserves scrollbar space permanently, so clientWidth is stable
     * whether or not the scrollbar is visible. For browsers without support,
     * the scroll handler re-measures when the scrollbar appears/disappears.
     */
    const measureViewport = useCallback(() => {
        const element = viewportRef.current;
        if (!element) return;
        const scrollbarWidth = element.offsetWidth - element.clientWidth;
        scrollbarWidthRef.current = scrollbarWidth;
        const width = element.clientWidth;
        const height = element.clientHeight;
        if (width === 0 || height === 0) return;
        grid.setViewport({ width, height });
        setIsMeasured(true);
    }, [grid]);

    useEffect(() => {
        const element = viewportRef.current;
        if (!element) return;

        const observer = new ResizeObserver(() => {
            const element = viewportRef.current;
            if (!element) return;
            const scrollbarWidth = element.offsetWidth - element.clientWidth;
            scrollbarWidthRef.current = scrollbarWidth;
            const width = element.clientWidth;
            const height = element.clientHeight;
            if (width === 0 || height === 0) return;
            grid.setViewport({ width, height });
            setIsMeasured(true);
        });
        observer.observe(element, { box: "content-box" });
        measureViewport();
        return () => observer.disconnect();
    }, [grid, measureViewport]);

    useLayoutEffect(() => {
        if (!isMeasured || autoHeight) return;
        // Gutter changes alter clientWidth; sync it before paint so columns
        // cannot render underneath a newly visible vertical scrollbar.
        measureViewport();
    }, [autoHeight, hasVerticalOverflow, isMeasured, measureViewport]);

    /**
     * Sync the DomPool after every structural re-render.
     * This runs only when React actually re-renders (data / columns /
     * dimensions / column-window changes), never on scroll.
     *
     * Adapter options (rowClassRules closures, getRowStyle, plugins) can
     * change between renders WITHOUT touching the grid revision or the data
     * reference — e.g. a rule toggled by a useState in the host component.
     * Force-rebind the visible nodes so row classes/styles are re-evaluated
     * with the fresh options on every render.
     */
    useEffect(() => {
        for (const layer of [layers.left, layers.central, layers.right]) {
            if (layer.pool) layer.pool.invalidate();
        }
        syncPool();
    });

    useEffect(() => {
        return () => {
            if (scrollFrameRef.current.id) cancelAnimationFrame(scrollFrameRef.current.id);
            for (const layer of [layers.left, layers.central, layers.right]) {
                layer.pool?.destroy();
                layer.pool = null;
                layer.panes.length = 0;
                layer.paneMap = new WeakMap();
            }
            rowsLayerRef.current?.replaceChildren();
            pinnedLeftRowsLayerRef.current?.replaceChildren();
            pinnedRightRowsLayerRef.current?.replaceChildren();
        };
    }, []);

    const handleScroll = (event: UIEvent<HTMLDivElement>) => {
        const element = event.currentTarget;
        const frame = scrollFrameRef.current;
        frame.top = element.scrollTop;
        frame.left = element.scrollLeft;

        // Detect scrollbar appearance/disappearance. When the vertical
        // scrollbar appears it reduces clientWidth; if the grid previously
        // measured without the scrollbar, we re-measure to avoid a phantom
        // horizontal scrollbar. (With `scrollbar-gutter: stable` this is a
        // no-op in modern browsers.)
        const scrollbarWidth = element.offsetWidth - element.clientWidth;
        if (scrollbarWidth !== scrollbarWidthRef.current) {
            scrollbarWidthRef.current = scrollbarWidth;
            grid.setViewport({ width: element.clientWidth });
        }

        if (frame.id) return;
        frame.id = window.requestAnimationFrame(() => {
            frame.id = 0;
            // Read the live scroll position directly from the DOM. This is a
            // safety net for cases where scroll events are coalesced or missed
            // (e.g. releasing the mouse outside the scrollbar thumb). The rAF
            // always reflects the most recent scrollTop, even if the last
            // onScroll event was at a different intermediate position.
            const element = viewportRef.current;
            const scrollTop = element ? element.scrollTop : frame.top;
            const scrollLeft = element ? element.scrollLeft : frame.left;
            // setViewport with scroll-only updates does NOT notify the Store,
            // so this does NOT trigger a React re-render. The DomPool is
            // updated imperatively below.
            grid.setViewport({ scrollTop, scrollLeft });
            syncPool(true);
        });
    };

    if (!isMeasured) {
        return (
            <div
                ref={viewportRef}
                className={viewportClassName}
                style={{
                    ...viewportStyle,
                    overflowX: "auto",
                    overflowY: autoHeight ? "hidden" : "auto",
                    position: "relative",
                    scrollbarGutter: verticalScrollbarGutter,
                }}
            />
        );
    }

    /** Resolves headless slot content into a ReactNode (see contentToReactNode). */
    const resolveSlotContent = (mount: SlotMount<T>, context: SlotRenderContext<T>): ReactNode => {
        const raw = typeof mount.content === "function" ? mount.content(context) : mount.content;
        return contentToReactNode<T>(raw, { registry: slotComponentsRef.current, context: () => context });
    };

    const renderSlot = (slot: SlotName): ReactNode => {
        const mounts = grid.getSlotMounts(slot);
        if (mounts.length === 0) return null;

        const context: SlotRenderContext<T> = { api: grid, state: grid.getState(), slot };
        return (
            <div className={`omnigrid-slot omnigrid-slot-${slot}`}>
                {SLOT_POSITIONS.map((position) => {
                    const group = mounts.filter((mount) => mount.position === position);
                    if (group.length === 0) return null;
                    return (
                        <div key={position} className={`omnigrid-slot-item-group omnigrid-slot-pos-${position}`}>
                            {group.map((mount) => (
                                <div key={mount.id} className="omnigrid-slot-item">
                                    {resolveSlotContent(mount, context)}
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>
        );
    };

    const pinnedLeftWidth = viewportData.pinnedLeftColumns.reduce((sum, item) => sum + item.width, 0);
    const pinnedRightWidth = viewportData.pinnedRightColumns.reduce((sum, item) => sum + item.width, 0);
    const scrollableWidth = Math.max(0, viewportData.totalWidth - pinnedLeftWidth - pinnedRightWidth);
    const hasPinnedLeft = pinnedLeftWidth > 0;
    const hasPinnedRight = pinnedRightWidth > 0;
    const hasPins = hasPinnedLeft || hasPinnedRight;
    const centralWidth = hasPins ? `${scrollableWidth}px` : `max(100%, ${viewportData.totalWidth}px)`;
    const rowTotalHeight = viewportData.totalHeight + headerHeight;

    // Horizontal overflow mode. The scroll container must only expose a
    // horizontal scrollbar when the content genuinely overflows it
    // (totalWidth > clientWidth). Using `overflow-x: hidden` when the content
    // fits makes it impossible for a sub-pixel rounding (fractional 100%,
    // border-box borders, etc.) to turn `scrollWidth > clientWidth` by 1px
    // and flash a phantom horizontal scrollbar. The pinned panes still stick
    // correctly on the horizontal axis because sticky positioning is not
    // affected by the clip.
    const needsHorizontalScroll = viewportData.totalWidth > grid.getState().viewport.width;

    const renderHeaderCells = (columns: PooledColumn<T>[], originX: number): ReactNode =>
        columns.map((item) => {
            const deepestDepth = hasGroups ? (viewportData.columnGroupDepth.get(item.index) ?? -1) : -1;
            const gapRows = headerRowCount - 1 - deepestDepth;
            const fullHeight = gapRows > 0;

            return (
                <div
                    key={item.column.id}
                    role="columnheader"
                    className={`omnigrid-header-cell${fullHeight ? " omnigrid-header-cell-full-height" : ""}`}
                    data-sort={item.column.sortState}
                    data-sort-index={item.column.sortIndex}
                    data-sortable={item.column.sortable === true ? "true" : undefined}
                    aria-sort={item.column.sortState === "asc" ? "ascending" : item.column.sortState === "desc" ? "descending" : "none"}
                    onClick={(event) =>
                        item.column.stopHeaderClick
                            ? event.stopPropagation()
                            : grid.headerClick(item.column.id, event.shiftKey || event.ctrlKey || event.metaKey)
                    }
                    onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") grid.headerClick(item.column.id);
                    }}
                    tabIndex={0}
                    style={{
                        alignItems: "center",
                        display: "flex",
                        fontWeight: 600,
                        overflow: "hidden",
                        padding: "0 12px",
                        position: "absolute",
                        left: Math.round(item.offset - originX),
                        top: fullHeight ? -(gapRows * rowHeight) : 0,
                        bottom: 0,
                        touchAction: "none",
                        whiteSpace: "nowrap",
                        width: item.width,
                    }}
                >
                    {item.column.headerRenderer ? (
                        contentToReactNode(item.column.headerRenderer(item.column), {
                            registry: slotComponentsRef.current,
                            context: buildRenderContext,
                        })
                    ) : (
                        <>
                            <span className="omnigrid-header-label">{item.column.header ?? item.column.id}</span>
                            <span className="omnigrid-header-tools">
                                {item.column.sortState && (
                                    <span className="omnigrid-sort-indicator" aria-hidden="true">
                                        {contentToReactNode(
                                            item.column.sortState === "asc"
                                                ? grid.icons.get("arrow-up")
                                                : grid.icons.get("arrow-down"),
                                            { registry: slotComponentsRef.current, context: buildRenderContext },
                                        )}
                                        {item.column.sortIndex !== undefined && (
                                            <span className="omnigrid-sort-priority">{item.column.sortIndex}</span>
                                        )}
                                    </span>
                                )}
                            </span>
                        </>
                    )}
                </div>
            );
        });

    const renderGroupCells = (depth: number, columns: PooledColumn<T>[], originX: number): ReactNode =>
        computeGroupSegments(viewportData.columnGroups, columns, depth, originX).map((segment, index) => (
            <div
                key={`${depth}:${index}:${segment.group.id}`}
                role="columnheader"
                className="omnigrid-header-cell omnigrid-header-group-cell"
                aria-colspan={segment.columnCount}
                title={segment.group.header ?? segment.group.id}
                style={{
                    alignItems: "center",
                    display: "flex",
                    fontWeight: 600,
                    justifyContent: "center",
                    left: Math.round(segment.left),
                    overflow: "hidden",
                    padding: "0 12px",
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    whiteSpace: "nowrap",
                    width: segment.width,
                }}
            >
                {segment.group.headerRenderer ? (
                    contentToReactNode(segment.group.headerRenderer(segment.group), {
                        registry: slotComponentsRef.current,
                        context: buildRenderContext,
                    })
                ) : (
                    <span className="omnigrid-header-label">{segment.group.header ?? segment.group.id}</span>
                )}
            </div>
        ));

    /**
     * Sticky header stack: `headerRowCount` group rows (one per depth) above the
     * leaf header row. Each pane renders its own stack with the same geometry;
     * without groups this is exactly the previous single header row.
     */
    const renderHeader = (columns: PooledColumn<T>[], originX: number, width: number | string, isPinned = false): ReactNode => (
        <div
            className="omnigrid-header"
            style={{
                height: headerHeight,
                overflow: "hidden",
                position: "sticky",
                top: 0,
                zIndex: isPinned ? 4 : 2,
                width,
            }}
        >
            {Array.from({ length: headerRowCount }, (_, depth) => (
                <div
                    key={`group-row-${depth}`}
                    role="row"
                    className="omnigrid-header-row omnigrid-header-group-row"
                    style={{
                        height: rowHeight,
                        left: 0,
                        overflow: "hidden",
                        position: "absolute",
                        top: depth * rowHeight,
                        width: "100%",
                    }}
                >
                    {renderGroupCells(depth, columns, originX)}
                </div>
            ))}
            <div
                role="row"
                className="omnigrid-header-row"
                style={{
                    height: rowHeight,
                    left: 0,
                    overflow: hasGroups ? "visible" : "hidden",
                    position: "absolute",
                    top: headerRowCount * rowHeight,
                    width: "100%",
                }}
            >
                {renderHeaderCells(columns, originX)}
            </div>
        </div>
    );

    const renderRowsLayer = (ref: React.MutableRefObject<HTMLDivElement | null>, width: number | string) => (
        <div
            ref={ref}
            data-pool-layer="true"
            style={{
                height: viewportData.totalHeight,
                left: 0,
                overflow: "hidden",
                position: "absolute",
                top: headerHeight,
                width,
            }}
        />
    );

    return (
        <div className="omnigrid-layout" style={style}>
            {renderSlot("top")}
            <div className="omnigrid-layout-body">
                {renderSlot("left")}
                <div
                    ref={viewportRef}
                    className={viewportClassName}
                    onScroll={handleScroll}
                    style={{
                        ...viewportStyle,
                        flex: "1 1 0",
                        height: autoHeight ? measuredHeight : "100%",
                        minHeight: 0,
                        minWidth: 0,
                        overflowX: needsHorizontalScroll ? "auto" : "hidden",
                        overflowY: autoHeight ? "hidden" : "auto",
                        position: "relative",
                        scrollbarGutter: verticalScrollbarGutter,
                        width: "100%",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            height: rowTotalHeight,
                            position: "relative",
                            width: `max(100%, ${viewportData.totalWidth}px)`,
                        }}
                    >
                        {hasPinnedLeft && (
                            <div
                                className="omnigrid-pinned omnigrid-pinned-left"
                                style={{
                                    height: rowTotalHeight,
                                    left: 0,
                                    position: "sticky",
                                    top: 0,
                                    width: `${pinnedLeftWidth}px`,
                                    zIndex: 3,
                                }}
                            >
                                {renderHeader(viewportData.pinnedLeftColumns, 0, `${pinnedLeftWidth}px`, true)}
                                {renderRowsLayer(pinnedLeftRowsLayerRef, `${pinnedLeftWidth}px`)}
                            </div>
                        )}
                        <div
                            className="omnigrid-scrollable"
                            style={{
                                flex: hasPins ? `1 0 ${scrollableWidth}px` : "1 1 auto",
                                minWidth: 0,
                                position: "relative",
                                width: centralWidth,
                                zIndex: 1,
                            }}
                        >
                            {renderHeader(viewportData.columns, pinnedLeftWidth, "100%", false)}
                            {renderRowsLayer(rowsLayerRef, "100%")}
                        </div>
                        {hasPinnedRight && (
                            <div
                                className="omnigrid-pinned omnigrid-pinned-right"
                                style={{
                                    height: rowTotalHeight,
                                    position: "sticky",
                                    right: 0,
                                    top: 0,
                                    width: `${pinnedRightWidth}px`,
                                    zIndex: 3,
                                }}
                            >
                                {renderHeader(viewportData.pinnedRightColumns, pinnedLeftWidth + scrollableWidth, `${pinnedRightWidth}px`, true)}
                                {renderRowsLayer(pinnedRightRowsLayerRef, `${pinnedRightWidth}px`)}
                            </div>
                        )}
                    </div>
                </div>
                {renderSlot("right")}
            </div>
            {renderSlot("bottom")}
        </div>
    );
}
