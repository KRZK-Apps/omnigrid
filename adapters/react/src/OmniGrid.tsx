import { createElement, type ComponentType, type CSSProperties, type ReactNode, type UIEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import type {
    CellRenderParams,
    CellSpan,
    ColumnGroupDef,
    ColumnLeafDef,
    ColumnStyleParams,
    FilterModel,
    GridOptions,
    GridState,
    HeaderGroupRenderParams,
    HeaderRenderParams,
    HeaderStyle,
    OverlayComponent as CoreOverlayComponent,
    OverlayComponentProps as CoreOverlayComponentProps,
    OverlayScope,
    OverlayState,
    OverlayType,
    RowRenderParams,
    RowSpanLayout,
    RowStyle,
    SlotMount,
    SlotName,
    SlotPosition,
    SlotRenderContext,
    ViewportData,
} from "@omnigrid/core";
import { DomPool, isActiveCondition } from "@omnigrid/core";

import { type ContentBridge, contentToReactNode, hasRenderableContent } from "./content";
import { computeGroupSegments } from "./groupHeader";
import { type PooledColumn, type PooledRowCallbacks, PooledRowPane } from "./pooledRow";
import { createCellRoot } from "./reactRoot";
import { renderDefaultOverlay } from "./overlays";
import { PopupHost } from "./popup";
import {
    type ResolvedColumnPresentation,
    resolveCellClasses,
    resolveCellStyle,
    resolveColumnPresentation,
    resolveGroupHeaderClasses,
    resolveGroupHeaderStyle,
    resolveHeaderClasses,
    resolveHeaderStyle,
} from "./styling";
import { useGrid } from "./useGrid";

/**
 * Registry of native adapter components for `SlotComponentContent`:
 *   slotComponents={{ ["my-widget"]: (payload, context) => <MyWidget .../> }}
 */
export interface SlotRendererRegistry<T> {
    [kind: string]: (payload: unknown, context: SlotRenderContext<T>) => ReactNode;
}

export type OverlayComponentProps<T> = CoreOverlayComponentProps<T>;

type OverlayComponent<T> =
    | ComponentType<CoreOverlayComponentProps<T>>
    | CoreOverlayComponent<T>;

export interface GridProps<T> extends Omit<GridOptions<T>, "overlayComponents"> {
    className?: string;
    style?: CSSProperties;
    slotComponents?: SlotRendererRegistry<T>;
    overlayComponents?: Record<string, OverlayComponent<T>>;
}

function getCellValue<T>(row: T, column: ColumnLeafDef<T>): unknown {
    if (column.valueGetter) return column.valueGetter(row);
    // `field` is `keyof T | string` (loose rows), so index via a string-keyed cast.
    if (column.field) return (row as Record<string, unknown>)[column.field as string];
    return undefined;
}

const SLOT_POSITIONS: SlotPosition[] = ["start", "center", "end"];

/**
 * Scroll velocity (px/ms) above which a scroll is treated as "fast".
 * Mouse wheel and trackpad scrolls typically range 0.05–0.2 px/ms, while
 * scrollbar thumb drags and page jumps exceed 10 px/ms.
 */
const FAST_SCROLL_VELOCITY = 2.0;

/**
 * How long (ms) after the last processed scroll frame the fast-scroll state
 * is kept. The velocity is only sampled on scroll frames, so it has to be
 * aged out explicitly — otherwise a single fast flick would keep the grid in
 * fast-scroll mode forever.
 */
const FAST_SCROLL_WINDOW = 150;

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
    /**
     * Viewport data of the last pool sync. Row binds read the span layout from
     * it instead of re-computing `getViewportData()` per bound row — in
     * variable-height mode that call is O(window x log n) and used to be paid
     * once per row, once per layer, on every pool update.
     */
    viewport: ViewportData<T> | null;
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
        viewport: null,
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
    const layoutRef = useRef<HTMLDivElement>(null);
    /** Scrollable content wrapper — its height is the total height of all rows. */
    const contentRef = useRef<HTMLDivElement>(null);
    const rowsLayerRef = useRef<HTMLDivElement>(null);
    const pinnedLeftRowsLayerRef = useRef<HTMLDivElement>(null);
    const pinnedRightRowsLayerRef = useRef<HTMLDivElement>(null);
    /** Space taken by the viewport's native scrollbars; body slots stay clear of it. */
    const [scrollbarInsets, setScrollbarInsets] = useState<{ right: number; bottom: number }>({ right: 0, bottom: 0 });
    const scrollFrameRef = useRef<{ id: number; top: number; left: number; lastTop: number; lastTime: number }>({ id: 0, top: 0, left: 0, lastTop: 0, lastTime: 0 });
    const scrollVelocityRef = useRef<number>(0);
    /** Timestamp of the last processed scroll frame — used to age out the velocity. */
    const lastScrollTimeRef = useRef<number>(0);
    /** Anchoring correction accumulated while a fast scroll was in progress. */
    const pendingAnchorRef = useRef<number>(0);
    /** Timer that applies the accumulated anchoring correction after the scroll settles. */
    const anchorTimerRef = useRef<number | null>(null);
    /** Number of row heights measured since the last geometry flush. */
    const pendingHeightCountRef = useRef<number>(0);
    /** Anchoring correction of the row heights measured since the last flush. */
    const pendingHeightCorrectionRef = useRef<number>(0);
    /** rAF handle of the scheduled row-height flush. */
    const heightFlushRef = useRef<number | null>(null);
    /**
     * Scrollable content height frozen at the start of a user scroll gesture.
     *
     * While the user drags the scrollbar thumb, measured row heights keep
     * replacing estimates and `totalHeight` changes every frame. Rewriting the
     * content height mid-drag makes the browser reposition the native
     * scrollbar thumb (`scrollTop / (scrollHeight - clientHeight)`), so the
     * thumb detaches from the mouse on the very first scroll of a
     * variable-height grid. The height is therefore frozen to this snapshot
     * for the duration of the gesture — row positions still use the measured
     * offsets — and the real height is reapplied once the scroll settles.
     */
    const optionsRef = useRef<GridProps<T>>(options);
    const columnWindowKeyRef = useRef("");
    /** Content size the scrollbar insets were measured for. */
    const contentSizeKeyRef = useRef("");
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

    const onGridReadyRef = useRef(options.onGridReady);
    onGridReadyRef.current = options.onGridReady;
    useEffect(() => {
        onGridReadyRef.current?.(grid);
    }, [grid]);

    const autoHeight = style?.height === undefined;
    const rowHeight = grid.getState().rowHeight;

    // Column-group header stack: `headerRowCount` group rows (one per depth) above
    // the leaf header row. Without groups `headerRowCount` is 0 and `columnGroupDepth`
    // is empty, collapsing the header to a single row — identical to the flat case.
    const headerRowCount = viewportData.headerRowCount;
    const hasGroups = headerRowCount > 0;
    const headerHeight = (headerRowCount + 1) * rowHeight;

    /**
     * Writes the scrollable content height (and the height of the row
     * layers) into the DOM.
     *
     * The total height changes with every measured row. Writing it through
     * React would re-render the whole grid per measurement — during a fast
     * scroll that starves the frame budget and the grid lags behind the
     * native scroll position. The imperative write keeps the scroll range
     * correct without a re-render.
     */
    const applyContentHeight = (totalHeight: number): void => {
        const layerHeight: string = `${totalHeight}px`;
        for (const ref of [rowsLayerRef, pinnedLeftRowsLayerRef, pinnedRightRowsLayerRef]) {
            const element: HTMLDivElement | null = ref.current;
            if (element && element.style.height !== layerHeight) element.style.height = layerHeight;
        }
        const contentHeight: string = `${totalHeight + headerHeight}px`;
        const content: HTMLDivElement | null = contentRef.current;
        if (content && content.style.height !== contentHeight) content.style.height = contentHeight;
        if (autoHeight) {
            // Auto-height grids grow with their content. React renders the
            // height from the state, which is only updated on a re-render —
            // the measured heights do not trigger one — so the viewport height
            // is written here as well.
            const viewport: HTMLDivElement | null = viewportRef.current;
            if (viewport && viewport.style.height !== contentHeight) viewport.style.height = contentHeight;
        }
    };

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
    const overlayState: OverlayState | undefined = state.overlay;
    const filterModelSnapshot: FilterModel = grid.getFilterModel();
    const isColumnFiltered = (column: ColumnLeafDef<T>): boolean => {
        const entry = filterModelSnapshot[column.id] ?? (column.field ? filterModelSnapshot[column.field as string] : undefined);
        return entry !== undefined && entry.conditions.some(isActiveCondition);
    };
    const overlayScope: OverlayScope | undefined = overlayState.type
        ? (overlayState.scope ?? (overlayState.type === "error" ? "full" : "bodyOnly"))
        : undefined;
    const overlayBlocksHorizontalScroll: boolean = overlayState.type
        ? (overlayState.blockScroll ?? false)
        : false;
    const isFullOverlay: boolean = overlayScope === "full";

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

    const columnPresentationCacheRef = useRef<
        Map<string, { revision: number; data: unknown[] | null; presentation: ResolvedColumnPresentation }>
    >(new Map());

    /**
     * Memoized per-row span layouts, keyed by row index within one viewport
     * commit. `getRowSpans` walks the full leaf group per visible row; the
     * cache keeps horizontal scroll at 60 FPS by reusing the layout while the
     * column set, offsets, and revision are unchanged. Cleared whenever the
     * column window or structural revision changes (see `syncPool`).
     */
    const spanCacheRef = useRef<{
        revision: number;
        columns: unknown;
        offsets: unknown;
        pinnedLeftColumns: unknown;
        pinnedLeftOffsets: unknown;
        pinnedRightColumns: unknown;
        pinnedRightOffsets: unknown;
        layouts: Map<number, { central: RowSpanLayout | null; left: RowSpanLayout | null; right: RowSpanLayout | null }>;
    }>({
        revision: -1,
        columns: null,
        offsets: null,
        pinnedLeftColumns: null,
        pinnedLeftOffsets: null,
        pinnedRightColumns: null,
        pinnedRightOffsets: null,
        layouts: new Map(),
    });

    const getCachedRowSpans = (
        viewport: ViewportData<T>,
        rowData: T,
        rowIndex: number,
    ): { central: RowSpanLayout | null; left: RowSpanLayout | null; right: RowSpanLayout | null } => {
        const revision: number = grid.getRevision();
        const cache = spanCacheRef.current;
        const sameWindow: boolean =
            cache.revision === revision &&
            cache.columns === viewport.leafColumns &&
            cache.offsets === viewport.columnOffsets &&
            cache.pinnedLeftColumns === viewport.pinnedLeftLeafColumns &&
            cache.pinnedLeftOffsets === viewport.pinnedLeftOffsets &&
            cache.pinnedRightColumns === viewport.pinnedRightLeafColumns &&
            cache.pinnedRightOffsets === viewport.pinnedRightOffsets;
        if (!sameWindow) {
            cache.revision = revision;
            cache.columns = viewport.leafColumns;
            cache.offsets = viewport.columnOffsets;
            cache.pinnedLeftColumns = viewport.pinnedLeftLeafColumns;
            cache.pinnedLeftOffsets = viewport.pinnedLeftOffsets;
            cache.pinnedRightColumns = viewport.pinnedRightLeafColumns;
            cache.pinnedRightOffsets = viewport.pinnedRightOffsets;
            cache.layouts.clear();
        }
        const cached = cache.layouts.get(rowIndex);
        if (cached) return cached;
        const resolve = (columns: ColumnLeafDef<T>[], offsets: { offset: number; size: number }[]): RowSpanLayout | null => {
            if (columns.length === 0) return null;
            let hasSpan: boolean = false;
            for (let i: number = 0; i < columns.length; i += 1) {
                if (columns[i].colSpan !== undefined) {
                    hasSpan = true;
                    break;
                }
            }
            if (!hasSpan) return null;
            return grid.getRowSpans(rowData, rowIndex, columns, offsets);
        };
        const entry = {
            central: resolve(viewport.leafColumns, viewport.columnOffsets),
            left: resolve(viewport.pinnedLeftLeafColumns, viewport.pinnedLeftOffsets),
            right: resolve(viewport.pinnedRightLeafColumns, viewport.pinnedRightOffsets),
        };
        cache.layouts.set(rowIndex, entry);
        return entry;
    };

    /**
     * Slices a full-group span layout down to the windowed columns a layer
     * renders. The scrollable layer renders `columnRange` over `leafColumns`;
     * pinned layers render their whole group. Spans that start before the
     * window and cover into it surface as a leading origin whose `left`
     * already matches the starting column — no clipping. Returns `null`
     * when the row carries no spans so the pane takes the fast path.
     */
    const sliceSpanLayoutForLayer = (
        viewport: ViewportData<T>,
        layerColumns: PooledColumn<T>[],
        isCentral: boolean,
        layout: RowSpanLayout | null,
    ): RowSpanLayout | null => {
        if (!layout) return null;
        const start: number = isCentral ? viewport.columnRange.start : 0;
        const spans: CellSpan[] = [];
        const widths: number[] = [];
        const offsets: number[] = [];
        // Full-group span origins before the window that still cover into
        // it: surface the FIRST visible covered leaf as the rendered origin
        // with the REMAINING width (origin left + covered prefix clipped).
        for (let slot: number = 0; slot < layerColumns.length; slot += 1) {
            const globalIndex: number = start + slot;
            const cell: CellSpan | undefined = layout.spans[globalIndex];
            const leafOffset: number = layerColumns[slot]?.offset ?? 0;
            if (!cell) {
                spans.push({ span: 1, covered: false });
                widths.push(layerColumns[slot]?.width ?? 0);
                offsets.push(leafOffset);
                continue;
            }
            if (cell.covered) {
                // Find the origin: walk back while covered. When the origin
                // itself is before the window, the first visible covered leaf
                // becomes the rendered origin (width = remaining span width).
                let origin: number = globalIndex;
                while (origin > 0 && layout.spans[origin]?.covered) origin -= 1;
                const originCovered: boolean = layout.spans[origin]?.covered ?? true;
                if (!originCovered && origin < start) {
                    // Only the FIRST visible covered leaf renders; later ones
                    // stay covered (skipped) so the merged cell paints once.
                    if (slot > 0 && layout.spans[globalIndex - 1]?.covered && globalIndex - 1 >= start) {
                        spans.push({ span: 1, covered: true });
                        widths.push(0);
                        offsets.push(leafOffset);
                        continue;
                    }
                    const originSpan: number = layout.spans[origin]?.span ?? 1;
                    const originEnd: number = origin + originSpan;
                    // Visible remainder: from the window's left edge at this
                    // slot to the span end (clipped to rendered leaves).
                    let remaining: number = 0;
                    let visibleSpan: number = 0;
                    for (let k: number = slot; k < layerColumns.length; k += 1) {
                        const colIndex: number = start + k;
                        if (colIndex >= originEnd) break;
                        remaining += layerColumns[k]?.width ?? 0;
                        visibleSpan += 1;
                    }
                    spans.push({ span: Math.max(1, visibleSpan), covered: false });
                    widths.push(remaining);
                    offsets.push(leafOffset);
                    continue;
                }
                spans.push({ span: 1, covered: true });
                widths.push(0);
                offsets.push(leafOffset);
                continue;
            }
            // Origin inside the window: clip the width to the rendered
            // leaves so a span running past the right edge does not overlap
            // the pinned-right pane or overflow the scrollable layer.
            let clipped: number = 0;
            let visibleSpan: number = 0;
            for (let k: number = 0; k < cell.span && slot + k < layerColumns.length; k += 1) {
                clipped += layerColumns[slot + k]?.width ?? 0;
                visibleSpan += 1;
            }
            spans.push({ span: Math.max(1, visibleSpan), covered: false });
            widths.push(clipped);
            offsets.push(leafOffset);
        }
        return { spans, widths, offsets };
    };

    const getColumnPresentation = (column: ColumnLeafDef<T>): ResolvedColumnPresentation => {
        const revision: number = grid.getRevision();
        const processedData: T[] = grid.getProcessedData();
        const cached = columnPresentationCacheRef.current.get(column.id);
        if (cached && cached.revision === revision && cached.data === processedData) {
            return cached.presentation;
        }

        const values: unknown[] = processedData.map((row: T): unknown => getCellValue(row, column));
        const params: ColumnStyleParams<T> = {
            column,
            values,
            api: grid,
            state: grid.getState(),
        };
        const presentation: ResolvedColumnPresentation = resolveColumnPresentation(column, params);
        columnPresentationCacheRef.current.set(column.id, { revision, data: processedData, presentation });
        return presentation;
    };

    /**
     * Whether the user is currently fast-scrolling.
     *
     * The velocity is sampled on scroll frames only, so it is aged out: when
     * the last scroll frame is older than `FAST_SCROLL_WINDOW` the scroll has
     * settled and the grid returns to its normal (fully bound) mode.
     */
    function isFastScrolling(): boolean {
        if (scrollVelocityRef.current <= FAST_SCROLL_VELOCITY) return false;
        return performance.now() - lastScrollTimeRef.current < FAST_SCROLL_WINDOW;
    }

    /**
     * Applies the anchoring corrections that were deferred during a fast scroll.
     *
     * A row ABOVE the viewport that changes its height shifts the content
     * below it. While the user drags the scrollbar that correction fights the
     * input (the scroll position jumps back and forth), so it is accumulated
     * instead of applied. As soon as the scroll settles the accumulated offset
     * is applied in one step — the anchored row stays where it was.
     */
    function flushPendingAnchor(): void {
        anchorTimerRef.current = null;
        const pending: number = pendingAnchorRef.current;
        if (pending === 0) return;
        if (isFastScrolling()) {
            // The user started scrolling again — the correction stays pending.
            anchorTimerRef.current = window.setTimeout(flushPendingAnchor, FAST_SCROLL_WINDOW);
            return;
        }
        pendingAnchorRef.current = 0;
        const element: HTMLDivElement | null = viewportRef.current;
        const current: number = element ? element.scrollTop : grid.getScrollPosition().scrollTop;
        grid.scrollTo({ scrollTop: Math.max(0, current + pending) });
    }

    /** Schedules the deferred anchoring flush after the scroll has settled. */
    function scheduleAnchorFlush(): void {
        if (anchorTimerRef.current !== null) window.clearTimeout(anchorTimerRef.current);
        anchorTimerRef.current = window.setTimeout(flushPendingAnchor, FAST_SCROLL_WINDOW);
    }

    /**
     * Applies the row heights measured during the current frame.
     *
     * The measured heights are pushed into the virtualizer as soon as they
     * arrive, but the DOM geometry is updated HERE — once per frame, after
     * every measurement of the frame has been read.
     *
     * Measuring a row reads the DOM (`scrollHeight`), which forces a layout.
     * A DOM write between two measurements invalidates that layout, so the
     * next measurement forces it again: 30 measured rows would then cost 30
     * full layouts of the grid (hundreds of milliseconds — the grid freezes
     * for a second when the scrollbar thumb is dragged). Batching the writes
     * keeps the cost at one layout per frame.
     */
    function flushPendingHeights(): void {
        heightFlushRef.current = null;
        const measured: number = pendingHeightCountRef.current;
        if (measured === 0) return;
        pendingHeightCountRef.current = 0;
        const fast: boolean = isFastScrolling();
        const correction: number = pendingHeightCorrectionRef.current;
        pendingHeightCorrectionRef.current = 0;
        if (correction !== 0) {
            if (fast) {
                // The correction fights the user's input while they are
                // scrolling — it is applied once the scroll settles.
                pendingAnchorRef.current += correction;
                scheduleAnchorFlush();
            } else {
                const element: HTMLDivElement | null = viewportRef.current;
                const current: number = element ? element.scrollTop : grid.getScrollPosition().scrollTop;
                grid.scrollTo({ scrollTop: Math.max(0, current + correction) });
            }
        }
        // The measured heights changed the offsets of the rows below: push the
        // new geometry into the pools.
        syncPool(false, fast);
    }

    /** Schedules the row-height flush for the next frame. */
    function scheduleHeightFlush(): void {
        if (heightFlushRef.current !== null) return;
        heightFlushRef.current = window.requestAnimationFrame(flushPendingHeights);
    }

    /** Row panel callbacks: close over grid/options, never over DOM. */
    function buildRowCallbacks(bridgeArg: ContentBridge<T>): PooledRowCallbacks<T> {
        const current = () => optionsRef.current;
        return {
            rowHeight,
            onRowHeightChange: (rowIndex: number, height: number): void => {
                // The measured height goes into the virtualizer right away —
                // it does NOT touch the DOM, so the measurements of the
                // current frame stay readable without a forced layout in
                // between (see `flushPendingHeights`).
                //
                // `anchor: false` — the scroll anchoring correction is
                // collected and applied in one step by the flush: applying it
                // per measurement would move the scroll position several
                // times per frame and fight the user's input.
                //
                // `notify: false` — the row heights are geometry, not grid
                // state. A Store notification would re-render the whole grid
                // (header included) for every measured row; the geometry is
                // written to the DOM imperatively instead.
                const correction: number = grid.setRowHeight(rowIndex, height, { anchor: false, notify: false });
                if (correction !== 0) pendingHeightCorrectionRef.current += correction;
                pendingHeightCountRef.current += 1;
                scheduleHeightFlush();
            },
            renderCellContent: (info) => {
                const column = info.column;
                const value = getCellValue(info.data, column);
                if (column.cellRenderer) {
                    return column.cellRenderer({ value, data: info.data, column, id: info.rowId, index: info.rowIndex });
                }
                return column.valueFormatter ? column.valueFormatter(value) : String(value ?? "");
            },
            renderCellPlaceholder: (info) => {
                // Cheap scalar preview mirroring the renderCellContent pipeline
                // minus the (possibly expensive) cellRenderer: same value source,
                // same formatter. Skipped when the raw value is not scalar and no
                // formatter exists (e.g. CheckboxControl sources) — the cell
                // stays empty for the one commit rather than showing garbage.
                const column = info.column;
                const value = getCellValue(info.data, column);
                if (column.valueFormatter) return column.valueFormatter(value);
                const valueType = typeof value;
                if (valueType === "string" || valueType === "number" || valueType === "boolean") return String(value);
                return null;
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
                const columnPresentation: ResolvedColumnPresentation = getColumnPresentation(info.column);
                return resolveCellClasses(info.column, cellParams, columnPresentation.classes);
            },
            resolveCellStyle: (info) => {
                const cellParams: CellRenderParams<T> = { id: info.rowId, index: info.rowIndex, data: info.data, column: info.column };
                const columnPresentation: ResolvedColumnPresentation = getColumnPresentation(info.column);
                return resolveCellStyle(info.column, cellParams, columnPresentation.style);
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
                    if (!pane) return;
                    // Per-row span layout over the FULL leaf group: merged
                    // widths come from the span origin's summed geometry and
                    // covered leaves are skipped — no clipping or overlap when
                    // a span crosses the virtual window boundary.
                    const viewport = layer.viewport;
                    if (!viewport) return;
                    const spans = getCachedRowSpans(viewport, row.data, row.index);
                    const isLeft: boolean = layer === layers.left;
                    const isRight: boolean = layer === layers.right;
                    const layout = isLeft ? spans.left : isRight ? spans.right : spans.central;
                    // Slice the full-group layout down to the windowed columns
                    // this layer renders: `columnRange` addresses `leafColumns`
                    // (scrollable) while pinned layers render their full group.
                    const sliced = sliceSpanLayoutForLayer(viewport, layer.columns, !isLeft && !isRight, layout);
                    pane.bind(row, layer.columns, layer.originX, sliced);
                },
                resizeRow: (host, height) => {
                    const pane = paneMap.get(host);
                    if (pane) pane.resize(height);
                },
                updateRowIndex: (host, rowIndex) => {
                    const pane = paneMap.get(host);
                    if (pane) pane.setRowIndex(rowIndex);
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
     *
     * Receives the pre-computed `viewportData` from `syncPool` to avoid redundant
     * getViewportData() calls — each layer no longer recomputes column geometry.
     */
    const syncRowLayer = (layer: RowLayerState<T>, viewportData: ViewportData<T>, rowsLayerRef: React.MutableRefObject<HTMLDivElement | null>, skipBind = false): void => {
        const bridge = ensureLayerContext();
        ensureLayerPool(layer, rowsLayerRef.current, bridge);
        const pool = layer.pool;
        if (!pool || grid.isDestroyed()) return;

        const state = grid.getState();
        const processed = grid.getProcessedData();

        const changed = layer.revision !== grid.getRevision() || layer.totalWidth !== viewportData.totalWidth || layer.processed !== processed;
        if (changed) {
            layer.revision = grid.getRevision();
            layer.totalWidth = viewportData.totalWidth;
            layer.processed = processed;
            pool.invalidate();
        }

        // Cached for the row binds below — the viewport data of THIS sync.
        layer.viewport = viewportData;

        pool.update({
            data: processed,
            rowRange: viewportData.rowRange,
            rowHeight: state.rowHeight,
            rowOffsets: viewportData.rowOffsets,
            rowHeights: viewportData.rowHeights,
            visibleRowRange: viewportData.visibleRowRange,
            rowWidth: layer.rowWidth,
            skipBind,
        });
    };

    /**
     * Synchronises the DomPools with the grid. Idempotent — called both from
     * React effects (structural changes) and directly from the scroll rAF
     * handler (imperative, no React re-render).
     *
     * @param synchronousColumnWindow — when `true`, the rAF-driven scroll path
     *   triggers a `flushSync` for the column window header update so headers
     *   stay in step with the imperatively repositioned cells before paint.
     * @param skipContentBind — when `true` (fast scroll), row positions are
     *   updated but `bindRow` is deferred to the next slow-scroll frame. This
     *   avoids synchronous React commits (~200 cell roots) that exceed the 16ms
     *   frame budget, causing flicker/frame drops. Rows remain visible with
     *   previous content at the correct new position.
     */
    const syncPool = (synchronousColumnWindow = false, skipContentBind = false): void => {
        const state = grid.getState();
        const currentViewportData = grid.getViewportData();

        // The scrollable content height follows the measured row heights.
        // It is written imperatively: a Store notification per measured row
        // would re-render the whole grid, and the grid would then lag behind
        // the native scroll position (the user sees the previous rows).
        //
        // During an active user scroll gesture the height is frozen to the
        // snapshot taken at gesture start (see `handleScroll`). Otherwise the
        // browser recomputes the scrollbar thumb (`scrollTop /
        // (scrollHeight - clientHeight)`) every time a measured row height
        // replaces an estimate and `totalHeight` changes mid-drag — on the
        // first scroll of a variable-height grid the thumb then lags behind
        // the mouse pointer. Row positions still use the live measured
        // offsets; only the scrollbar range is frozen until the scroll
        // settles.
        const effectiveTotalHeight: number = currentViewportData.totalHeight;
        applyContentHeight(effectiveTotalHeight);

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

        // Cell content rendering (root.render) is async under React concurrent
        // mode — without flushSync, rows are repositioned but their cell content
        // stays stale for one frame, causing visible jitter on custom-renderer
        // cells. Wrap ONLY the DOM binding in flushSync to force cell roots to
        // commit before paint.
        //
        // Velocity-based: during fast scroll (scrollbar thumb drag), many scroll
        // events fire but rAF throttles to ~60fps. Calling flushSync on every frame
        // forces a synchronous React commit for ALL cell roots (~200 calls), which
        // can exceed the 16ms frame budget and cause frame drops — appearing as
        // flickering/emptying. During fast scroll, we skip flushSync: rows stay
        // at correct positions with previous content (we don't clear content on
        // recycle), so the table is never empty — just 1-frame stale, which is
        // imperceptible during rapid scroll. When velocity drops, flushSync resumes
        // for frame-perfect content. The structural path (useEffect) always uses
        // flushSync for correctness.
        // getViewportData() above runs outside flushSync since column geometry
        // caching makes it fast, avoiding blocking on computation.
        const bindLayers = (): void => {
            syncRowLayer(layers.left, currentViewportData, pinnedLeftRowsLayerRef, skipContentBind);
            syncRowLayer(layers.central, currentViewportData, rowsLayerRef, skipContentBind);
            syncRowLayer(layers.right, currentViewportData, pinnedRightRowsLayerRef, skipContentBind);
        };

        if (synchronousColumnWindow && !skipContentBind) {
            flushSync(bindLayers);
        } else {
            bindLayers();
        }

        // The horizontal column window changes infrequently (only when
        // crossing column boundaries). When it does, update central row cells
        // imperatively AND trigger a targeted React re-render for the header.
        // Pinned panes hold all their columns at once — they only rebind via
        // the structural path above (revision bump).
        //
        // Skip column window updates during fast scroll (skipContentBind) —
        // the columns themselves haven't changed, and forcing a header re-render
        // during fast scroll would cause frame drops. The column window will
        // be updated on the next slow-scroll frame or structural update.
        if (!skipContentBind) {
            const columnWindowKey = `${currentViewportData.columnRange.start}:${currentViewportData.columnRange.end}:${state.viewport.width}:${pinnedLeftWidth}:${pinnedRightWidth}`;
            if (columnWindowKey !== columnWindowKeyRef.current) {
                columnWindowKeyRef.current = columnWindowKey;
                const updateColumnWindow = (): void => {
                    // Span-aware: each pane resolves its own row's layout so
                    // merged cells keep their summed width while the window
                    // slides — covered leaves stay parked off-screen.
                    for (const pane of layers.central.panes) {
                        const paneRow = pane.getRow();
                        if (!paneRow) {
                            pane.updateColumns(layers.central.columns, layers.central.originX, null);
                            continue;
                        }
                        const spans = getCachedRowSpans(currentViewportData, paneRow.data, paneRow.index);
                        pane.updateColumns(layers.central.columns, layers.central.originX, sliceSpanLayoutForLayer(currentViewportData, layers.central.columns, true, spans.central));
                    }
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
    const syncScrollbarInsets = useCallback((element: HTMLDivElement): void => {
        const right: number = Math.max(0, element.offsetWidth - element.clientWidth - element.clientLeft * 2);
        const bottom: number = Math.max(0, element.offsetHeight - element.clientHeight - element.clientTop * 2);
        setScrollbarInsets((previous) => (previous.right === right && previous.bottom === bottom ? previous : { right, bottom }));
    }, []);

    const measureViewport = useCallback(() => {
        const element = viewportRef.current;
        if (!element) return;
        syncScrollbarInsets(element);
        const scrollbarWidth = element.offsetWidth - element.clientWidth;
        scrollbarWidthRef.current = scrollbarWidth;
        const width = element.clientWidth;
        const height = element.clientHeight;
        if (width === 0 || height === 0) return;
        grid.setViewport({ width, height });
    }, [grid, syncScrollbarInsets]);

    useEffect(() => {
        const element = viewportRef.current;
        if (!element) return;

        const observer = new ResizeObserver(() => {
            const element = viewportRef.current;
            if (!element) return;
            syncScrollbarInsets(element);
            const scrollbarWidth = element.offsetWidth - element.clientWidth;
            scrollbarWidthRef.current = scrollbarWidth;
            const width = element.clientWidth;
            const height = element.clientHeight;
            if (width === 0 || height === 0) return;
            grid.setViewport({ width, height });
        });
        observer.observe(element, { box: "content-box" });
        measureViewport();
        return () => observer.disconnect();
    }, [grid, measureViewport, syncScrollbarInsets]);

    // Scrollbars can appear or disappear when the CONTENT size changes (the
    // rows are measured, a column is resized). Measuring the insets after
    // EVERY render forces a synchronous layout of the whole page — during a
    // fast scroll that alone blows the frame budget, and the grid then lags
    // behind the native scroll (the user sees the previous rows).
    const contentSizeKey: string = `${viewportData.totalWidth}x${viewportData.totalHeight}`;
    useLayoutEffect(() => {
        if (contentSizeKeyRef.current === contentSizeKey) return;
        contentSizeKeyRef.current = contentSizeKey;
        if (viewportRef.current) syncScrollbarInsets(viewportRef.current);
    }, [contentSizeKey]);

    useLayoutEffect(() => {
        if (autoHeight) return;
        // Scrollbar and gutter changes alter clientWidth; sync it before paint
        // so columns remain aligned when an overlay locks vertical scrolling.
        measureViewport();
    }, [autoHeight, hasVerticalOverflow, measureViewport, overlayScope]);

    useEffect(() => {
        const unsubscribe: () => void = grid.on("scrollTo", (position) => {
            const element: HTMLDivElement | null = viewportRef.current;
            if (!element) return;
            element.scrollTop = position.scrollTop;
            element.scrollLeft = position.scrollLeft;
        });
        return unsubscribe;
    }, [grid]);

    useEffect(
        () => () => {
            if (anchorTimerRef.current !== null) window.clearTimeout(anchorTimerRef.current);
            if (heightFlushRef.current !== null) window.cancelAnimationFrame(heightFlushRef.current);
        },
        [],
    );

    /**
     * Sync the DomPool after every structural re-render.
     *
     * Depends on `state` (from useSyncExternalStore) — the Store only notifies
     * on structural changes (data / columns / dimensions / overlay), NOT on
     * scroll-only updates or column-window version changes. This prevents the
     * effect from running on horizontal-scroll re-renders, where syncPool(true)
     * in the rAF already handled the DomPool sync and a redundant invalidate()
     * here would force-rebind every visible row for no reason.
     *
     * The pools are invalidated only when the grid's STRUCTURAL revision
     * changed. Row-height updates (variable-height mode) also notify the
     * Store, but they are pure geometry changes: re-binding every visible row
     * for them would re-render every cell and re-trigger the row measurement
     * — a feedback loop that starves the scroll frame budget and leaves the
     * grid with overlapping rows while scrolling.
     */
    const lastStructuralRevisionRef = useRef<number>(-1);
    useEffect(() => {
        const revision: number = grid.getRevision();
        if (revision !== lastStructuralRevisionRef.current) {
            lastStructuralRevisionRef.current = revision;
            for (const layer of [layers.left, layers.central, layers.right]) {
                if (layer.pool) layer.pool.invalidate();
            }
        }
        syncPool(false, false);  // skipContentBind=false: structural changes always bind fully
    }, [state]);

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

        // The scrollbar width is NOT measured here: reading `offsetWidth` /
        // clientWidth forces a synchronous layout of the whole page, and a
        // scroll event fires several times per frame during a thumb drag.
        // The ResizeObserver reports the content box size instead — it fires
        // exactly when the scrollbar appears or disappears.

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
            // Velocity detection: px/ms. Threshold at 2.0 px/ms — mouse wheel
            // and trackpad scrolls typically range 0.05–0.2 px/ms, while
            // scrollbar thumb drags and shift-click page jumps can exceed 10 px/ms.
            // When velocity exceeds the threshold, skipContentBind is passed to
            // syncPool: rows are repositioned but content binding is deferred,
            // avoiding synchronous React commits that exceed the 16ms frame budget.
            const now = performance.now();
            const deltaT = now - frame.lastTime;
            scrollVelocityRef.current = deltaT > 8 ? Math.abs(scrollTop - frame.lastTop) / deltaT : 0;
            frame.lastTop = scrollTop;
            frame.lastTime = now;
            lastScrollTimeRef.current = now;
            // setViewport with scroll-only updates does NOT notify the Store,
            // so this does NOT trigger a React re-render. The DomPool is
            // updated imperatively below.
            grid.setViewport({ scrollTop, scrollLeft });
            const skipContentBind = scrollVelocityRef.current > FAST_SCROLL_VELOCITY;
            if (!skipContentBind && pendingAnchorRef.current !== 0) {
                // The scroll settled — the deferred anchoring correction can be
                // applied now without fighting the user's input.
                flushPendingAnchor();
            }
            syncPool(true, skipContentBind);
        });
    };

    /** Resolves headless slot content into a ReactNode (see contentToReactNode). */
    const resolveSlotContent = (mount: SlotMount<T>, context: SlotRenderContext<T>): ReactNode => {
        const raw = typeof mount.content === "function" ? mount.content(context) : mount.content;
        return contentToReactNode<T>(raw, { registry: slotComponentsRef.current, context: () => context });
    };

    const renderSlotGroups = (mounts: SlotMount<T>[], context: SlotRenderContext<T>): ReactNode[] =>
        SLOT_POSITIONS.map((position) => {
            const content: { mount: SlotMount<T>; value: ReactNode }[] = mounts
                .filter((mount) => mount.position === position)
                .map((mount) => ({ mount, value: resolveSlotContent(mount, context) }))
                .filter((item) => hasRenderableContent(item.value));
            if (content.length === 0) return null;
            return (
                <div key={position} className={`omnigrid-slot-item-group omnigrid-slot-pos-${position}`}>
                    {content.map(({ mount, value }) => (
                        <div key={mount.id} className="omnigrid-slot-item">
                            {value}
                        </div>
                    ))}
                </div>
            );
        });

    const renderSlot = (slot: SlotName): ReactNode => {
        const mounts = grid.getSlotMounts(slot);
        if (mounts.length === 0) return null;

        const context: SlotRenderContext<T> = { api: grid, state: grid.getState(), slot };
        const groups: ReactNode[] = renderSlotGroups(mounts, context);
        if (groups.every((group) => group === null)) return null;

        const slotClass: string = slot === "down" ? "omnigrid-slot omnigrid-slot-bottom omnigrid-slot-down" : `omnigrid-slot omnigrid-slot-${slot}`;
        return (
            <div className={slotClass}>
                {groups}
            </div>
        );
    };

    /** Renders slots that overlay the table body (absolute positioning, no layout shift). */
    const renderBodySlot = (slot: "bodyTop" | "bodyBottom"): ReactNode => {
        const mounts = grid.getSlotMounts(slot);
        if (mounts.length === 0) return null;

        const context: SlotRenderContext<T> = { api: grid, state: grid.getState(), slot };
        const groups: ReactNode[] = renderSlotGroups(mounts, context);
        if (groups.every((group) => group === null)) return null;

        return (
            <div
                className={`omnigrid-slot omnigrid-slot-${slot}`}
                style={{
                    bottom: slot === "bodyBottom" ? scrollbarInsets.bottom : undefined,
                    left: 0,
                    position: "absolute",
                    right: scrollbarInsets.right,
                    top: slot === "bodyTop" ? headerHeight : undefined,
                    zIndex: 3,
                }}
            >
                {groups}
            </div>
        );
    };

    /**
     * Resolves a React component, legacy headless renderer, or built-in overlay
     * for the active state.
     */
    function renderOverlayContent(overlay: OverlayState | undefined): ReactNode {
        if (!overlay || !overlay.type) return null;

        const registeredRenderer: OverlayComponent<T> | undefined =
            typeof overlay.component === "string"
                ? optionsRef.current.overlayComponents?.[overlay.component]
                : optionsRef.current.overlayComponents?.[overlay.type];
        const component: unknown =
            typeof overlay.component === "function" || (typeof overlay.component === "object" && overlay.component !== null)
                ? overlay.component
                : registeredRenderer;
        const isLegacyRenderer: boolean = typeof component === "function" && component.length >= 2;
        if (component && !isLegacyRenderer) {
            return createElement(component as ComponentType<CoreOverlayComponentProps<T>>, {
                type: overlay.type,
                message: overlay.message,
                payload: overlay.payload,
                state: grid.getState(),
            });
        }

        const customRenderer: unknown = component ?? registeredRenderer;
        if (isLegacyRenderer && typeof customRenderer === "function") {
            return contentToReactNode((customRenderer as (payload: unknown, state: GridState<T>) => unknown)(overlay.payload, grid.getState()), {
                registry: slotComponentsRef.current,
                context: buildRenderContext,
            });
        }

        if (overlay.component !== undefined) {
            return contentToReactNode(overlay.payload, {
                registry: slotComponentsRef.current,
                context: buildRenderContext,
            });
        }

        return renderDefaultOverlay(overlay);
    }

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
            const deepestDepth: number = hasGroups ? (viewportData.columnGroupDepth.get(item.index) ?? -1) : -1;
            const gapRows: number = headerRowCount - 1 - deepestDepth;
            const fullHeight: boolean = gapRows > 0;

            const headerParams: HeaderRenderParams<T> = { column: item.column, index: item.index };
            const className: string = resolveHeaderClasses(item.column, headerParams, fullHeight);
            const customHeaderStyle: HeaderStyle = resolveHeaderStyle(item.column, headerParams);

            const headerCellLayout: CSSProperties = {
                alignItems: "center",
                display: "flex",
                fontWeight: 600,
                overflow: "hidden",
                padding: "0 12px",
                whiteSpace: "nowrap",
                ...(customHeaderStyle as CSSProperties),
                position: "absolute",
                left: Math.round(item.offset - originX),
                top: fullHeight ? -(gapRows * rowHeight) : 0,
                bottom: 0,
                touchAction: "none",
                width: item.width,
            };

            return (
                <div
                    key={item.column.id}
                    role="columnheader"
                    className={className}
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
                    style={headerCellLayout}
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
                                {grid.hasFilterMenu() && item.column.filterable !== false && (
                                    <button
                                        type="button"
                                        className="omnigrid-filter-trigger"
                                        data-omnigrid-filter-trigger=""
                                        data-active={isColumnFiltered(item.column) ? "true" : undefined}
                                        aria-label={`Filter ${item.column.header ?? item.column.id}`}
                                        aria-haspopup="dialog"
                                        tabIndex={-1}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            const rect: DOMRect = event.currentTarget.getBoundingClientRect();
                                            const layoutRect: DOMRect = layoutRef.current?.getBoundingClientRect() ?? ({ left: 0, top: 0, width: 0, height: 0 } as DOMRect);
                                            grid.requestFilterMenu(item.column.id, {
                                                x: rect.left - layoutRect.left,
                                                y: rect.top - layoutRect.top,
                                                width: rect.width,
                                                height: rect.height,
                                            });
                                        }}
                                        onKeyDown={(event) => event.stopPropagation()}
                                    >
                                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
                                            <path d="M3 4h18l-7 8.5V20l-4-2v-5.5z" />
                                        </svg>
                                    </button>
                                )}
                            </span>
                        </>
                    )}
                </div>
            );
        });

    const renderGroupCells = (depth: number, columns: PooledColumn<T>[], originX: number): ReactNode =>
        computeGroupSegments(viewportData.columnGroups, columns, depth, originX).map((segment, index) => {
            const groupParams: HeaderGroupRenderParams<T> = {
                group: segment.group,
                column: segment.group,
                depth,
                columnCount: segment.columnCount,
            };

            const className: string = resolveGroupHeaderClasses(segment.group, groupParams);
            const customGroupStyle: HeaderStyle = resolveGroupHeaderStyle(segment.group, groupParams);

            const groupCellLayout: CSSProperties = {
                alignItems: "center",
                display: "flex",
                fontWeight: 600,
                justifyContent: "center",
                overflow: "hidden",
                padding: "0 12px",
                whiteSpace: "nowrap",
                ...(customGroupStyle as CSSProperties),
                position: "absolute",
                left: Math.round(segment.left),
                top: 0,
                bottom: 0,
                width: segment.width,
            };

            return (
                <div
                    key={`${depth}:${index}:${segment.group.id}`}
                    role="columnheader"
                    className={className}
                    aria-colspan={segment.columnCount}
                    title={segment.group.header ?? segment.group.id}
                    style={groupCellLayout}
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
            );
        });

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
                // The layer's height follows the measured row heights — it is
                // updated imperatively (see `syncPool`) so a measurement does
                // not re-render the whole grid.
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
        <div className="omnigrid-layout" ref={layoutRef} style={{ ...style, position: "relative", ...(isFullOverlay ? { overflow: "hidden" } : {}) }}>
            {renderSlot("top")}
            <div className="omnigrid-layout-body">
                {renderSlot("left")}
                <div
                    className="omnigrid-viewport-container"
                    style={{
                    flex: "1 1 0",
                    minHeight: 0,
                    minWidth: 0,
                    position: "relative",
                    width: "100%",
                    }}
                >
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
                        overflowX: overlayBlocksHorizontalScroll ? "hidden" : needsHorizontalScroll ? "auto" : "hidden",
                        overflowY: overlayScope || autoHeight ? "hidden" : "auto",
                        position: "relative",
                        scrollbarGutter: verticalScrollbarGutter,
                        width: "100%",
                    }}
                    >
                    <div
                        ref={contentRef}
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
                                    height: "100%",
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
                                    height: "100%",
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
                    {renderBodySlot("bodyTop")}
                    {renderBodySlot("bodyBottom")}
                    {overlayState.type && overlayScope === "bodyOnly" && (
                    <div
                        className="omnigrid-overlay omnigrid-overlay-body"
                        role="status"
                        style={{
                            bottom: 0,
                            left: 0,
                            pointerEvents: "auto",
                            position: "absolute",
                            right: 0,
                            top: headerHeight,
                            width: "100%",
                            zIndex: 4,
                        }}
                    >
                        {renderOverlayContent(overlayState)}
                    </div>
                    )}
                </div>
                {renderSlot("right")}
            </div>
            {renderSlot("bottom")}
            <PopupHost grid={grid} />
            {overlayState.type && isFullOverlay && (
                <div className="omnigrid-overlay omnigrid-overlay-full" role="status">
                    {renderOverlayContent(overlayState)}
                </div>
            )}
        </div>
    );
}
