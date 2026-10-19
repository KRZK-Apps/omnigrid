import { flattenColumns, getColumnGroups, getRowSpans, resolveColSpan } from "./columns";
import { EventBus } from "./events";
import { applyFilterModel, applyQuickFilter, isActiveCondition } from "./filtering";
import type { ColumnFilterModel, FilterCondition, FilterModel } from "./filtering";
import { PopupManager } from "./ui";
import type { UIPopupAnchor, UIPopupDescriptor } from "./ui";
import { evaluateAutoOverlay } from "./overlays";
import { IconRegistry } from "./icons";
import { SlotManager } from "./slots";
import { Store } from "./store";
import type {
    ColumnLeafDef,
    DataProcessor,
    GridApi,
    GridEvents,
    GridOptions,
    GridPlugin,
    GridState,
    RowClickEvent,
    RowHoverEvent,
    RowId,
    RowSpanLayout,
    ScrollPosition,
    SlotMount,
    SlotName,
    ViewportData,
    ViewportState,
} from "./types";
import type { OverlayOptions, OverlayState, OverlayType } from "./overlays";
import { Virtualizer } from "./virtualizer";

export class Grid<T> implements GridApi<T> {
    private readonly store: Store<GridState<T>>;
    private readonly events = new EventBus<GridEvents<T>>();
    private readonly virtualizer: Virtualizer<T>;
    private readonly cleanupPlugins = new Set<() => void>();
    private readonly pluginRegistrations = new Map<GridPlugin<T>, () => void>();
    private readonly dataProcessors = new Set<DataProcessor<T>>();
    private readonly resolveRowId: NonNullable<GridOptions<T>["getRowId"]>;
    public readonly slots: SlotManager<T>;
    public readonly icons = new IconRegistry<T>();
    private processedDataCache: T[] | null = null;
    /** Output of the built-in filter stage; sits in front of every data processor. */
    private filteredDataCache: T[] | null = null;
    private filterModel: FilterModel = {};
    private filterMenuProviders = 0;
    private readonly popups = new PopupManager((popup) => this.events.emit("popupChange", popup));
    private revision = 0;
    private destroyed = false;

    /**
     * Overlay management state:
     * - `loading`: whether the grid is fetching data (set via setLoading / options.loading)
     * - `overlayState`: the current active overlay (type + payload)
     * - `overlayManual`: whether the overlay was set manually (showOverlay), which
     *   disables auto-evaluation until hideOverlay re-enables it.
     */
    private readonly licenseKey: string | undefined;
    private loading = false;
    private hasData = true;
    private loadError: unknown;
    private overlayState: OverlayState = { type: null };
    private overlayManual = false;

    /**
     * Separate ephemeral scroll position that is NOT stored in the Store.
     *
     * Scroll-only updates (scrollTop/scrollLeft) flow through here and never
     * trigger Store notifications, so React (or any adapter subscribed to the
     * Store) does NOT re-render on every scroll frame. Dimension changes
     * (width / height) still go through the Store and DO trigger re-renders.
     */
    private scrollPosition: ScrollPosition = { scrollTop: 0, scrollLeft: 0 };

    public constructor(options: GridOptions<T>) {
        const state: GridState<T> = {
            data: options.data ?? [],
            columns: options.columns,
            viewport: { width: 0, height: 0, scrollTop: 0, scrollLeft: 0 },
            rowHeight: options.rowHeight ?? 32,
            rowOverscan: options.rowOverscan ?? 5,
            columnOverscan: options.columnOverscan ?? 2,
            overlay: { type: null },
            quickFilter: options.quickFilter ?? "",
        };
        this.store = new Store(state);
        this.licenseKey = options.licenseKey;
        this.resolveRowId = options.getRowId ?? ((_row, index) => index);
        this.loading = options.loading ?? false;
        this.hasData = options.data !== undefined && options.data !== null;
        if (options.filterModel) this.filterModel = Grid.cloneFilterModel(options.filterModel);
        this.virtualizer = new Virtualizer({
            rowHeight: state.rowHeight,
            rowOverscan: state.rowOverscan,
            columnOverscan: state.columnOverscan,
        });
        this.slots = new SlotManager<T>({
            onChange: (slot: SlotName, mounts: SlotMount<T>[]) => {
                this.store.setState({});
                this.events.emit("slotsChange", { slot, mounts });
            },
        });
        this.store.subscribe(() => this.events.emit("stateChange", this.store.getState()));
        options.plugins?.forEach((plugin) => this.registerPlugin(plugin));
        this.recomputeOverlay();
    }

    /** Returns the calculated width for a visible column, including off-screen columns. */
    public getColumnWidth(columnId: string): number | undefined {
        const state = this.getState();
        const visibleColumns = flattenColumns(state.columns).filter((column) => !column.hidden);
        if (!visibleColumns.some((column) => column.id === columnId)) return undefined;

        const pinnedLeft = visibleColumns.filter((column) => column.pinned === "left");
        const scrollable = visibleColumns.filter((column) => !column.pinned);
        const pinnedRight = visibleColumns.filter((column) => column.pinned === "right");
        const pinnedLeftOffsets = this.virtualizer.getColumnOffsets(pinnedLeft, state.viewport.width);
        const pinnedRightOffsets = this.virtualizer.getColumnOffsets(pinnedRight, state.viewport.width);
        const pinnedLeftWidth = pinnedLeftOffsets.reduce((sum, item) => sum + item.size, 0);
        const pinnedRightWidth = pinnedRightOffsets.reduce((sum, item) => sum + item.size, 0);
        const scrollableWidth = Math.max(0, state.viewport.width - pinnedLeftWidth - pinnedRightWidth);
        const scrollableOffsets = this.virtualizer.getColumnOffsets(scrollable, scrollableWidth);

        const pinnedLeftIndex = pinnedLeft.findIndex((column) => column.id === columnId);
        if (pinnedLeftIndex >= 0) return pinnedLeftOffsets[pinnedLeftIndex].size;
        const pinnedRightIndex = pinnedRight.findIndex((column) => column.id === columnId);
        if (pinnedRightIndex >= 0) return pinnedRightOffsets[pinnedRightIndex].size;
        const scrollableIndex = scrollable.findIndex((column) => column.id === columnId);
        return scrollableOffsets[scrollableIndex]?.size;
    }

    public getState(): GridState<T> {
        return this.store.getState();
    }

    /** Returns the current ephemeral scroll position (not part of Store state). */
    public getScrollPosition(): ScrollPosition {
        return this.scrollPosition;
    }

    /**
     * Requests the adapter to update the native scroll position.
     * @param position - Partial scroll coordinates to set.
     * @api
     */
    public scrollTo(position: Partial<ScrollPosition>): void {
        this.assertActive();
        const nextPosition: ScrollPosition = { ...this.scrollPosition, ...position };
        if (nextPosition.scrollTop === this.scrollPosition.scrollTop && nextPosition.scrollLeft === this.scrollPosition.scrollLeft) return;
        this.scrollPosition = nextPosition;
        this.events.emit("scrollTo", nextPosition);
    }

    public getViewportData(): ViewportData<T> {
        const state = this.getState();
        const processedData = this.getProcessedData();
        const width = state.viewport.width;
        const scrollLeft = this.scrollPosition.scrollLeft;

        // Column grouping: the working set for virtualization is the FLAT
        // array of leaf columns. The hierarchy lives in `state.columns`;
        // groups are projected onto the visible leaf order in `columnGroups`
        // so adapters can render stacked group header rows.
        const visibleColumns = flattenColumns(state.columns).filter((column) => !column.hidden);
        const columnGroups = getColumnGroups(state.columns, (leaf) => !leaf.hidden);

        // Pre-compute group layout metadata for adapters:
        //  - `headerRowCount`: number of group header rows above the leaf row
        //  - `columnGroupDepth`: maps each leaf column's flat visible index to
        //    the deepest group depth that covers it (used to detect gap rows)
        const headerRowCount = columnGroups.reduce((depth, group) => Math.max(depth, group.depth), -1) + 1;
        const columnGroupDepth = new Map<number, number>();
        for (const groupView of columnGroups) {
            for (let i = groupView.startIndex; i < groupView.endIndex; i++) {
                const prev = columnGroupDepth.get(i) ?? -1;
                if (groupView.depth > prev) columnGroupDepth.set(i, groupView.depth);
            }
        }

        // Partition into three groups, preserving definition order within each.
        const pinnedLeft = visibleColumns.filter((c) => c.pinned === "left");
        const scrollable = visibleColumns.filter((c) => !c.pinned);
        const pinnedRight = visibleColumns.filter((c) => c.pinned === "right");

        // Pinned widths are computed first. Pinned columns are typically
        // fixed-width (no flex), so getColumnOffsets returns correct sizes
        // regardless of the viewportWidth argument — letting us derive the
        // scrollable viewport width before sizing any flex columns.
        const pinnedLeftOffsets = this.virtualizer.getColumnOffsets(pinnedLeft, width);
        const pinnedLeftWidth = pinnedLeftOffsets.reduce((sum, item) => sum + item.size, 0);
        const pinnedRightOffsets = this.virtualizer.getColumnOffsets(pinnedRight, width);
        const pinnedRightWidth = pinnedRightOffsets.reduce((sum, item) => sum + item.size, 0);

        // Effective viewport for the scrollable section: pinned columns take space.
        const scrollableViewWidth = Math.max(0, width - pinnedLeftWidth - pinnedRightWidth);

        const scrollableOffsets = this.virtualizer.getColumnOffsets(scrollable, scrollableViewWidth);
        const scrollableWidth = scrollableOffsets.reduce((sum, item) => sum + item.size, 0);
        const totalWidth = pinnedLeftWidth + scrollableWidth + pinnedRightWidth;

        // Virtual range for the scrollable section only.
        //
        // Pass pre-computed scrollableOffsets to avoid a second (iterative)
        // flex-distribution pass — getColumnRange would otherwise recompute
        // all column widths from scratch via getColumnOffsets.
        //
        // Span-aware expansion: a `colSpan` origin may sit BEFORE the window
        // while covering into it, and a span starting inside may extend PAST
        // the right edge. Expand the shared window left (bounded lookback for
        // origins) and right (max declared static span) so every visible row
        // can anchor its spans without clipping. Per-row dynamic spans that
        // reach further are handled by the adapter via `getRowSpans` over the
        // full `leafColumns` below.
        const baseColumnRange = scrollable.length
            ? this.virtualizer.getColumnRange(scrollable, scrollLeft, scrollableViewWidth, scrollableOffsets)
            : { start: 0, end: 0 };
        const columnRange = Grid.expandColumnRangeForSpans(scrollable, baseColumnRange);

        const rowRange = this.virtualizer.getRowRange(processedData.length, this.scrollPosition.scrollTop, state.viewport.height);

        // Offset composition:
        //   pinned-left: absolute from 0
        //   scrollable: shifted by pinnedLeftWidth
        //   pinned-right: shifted by pinnedLeftWidth + scrollableWidth
        const pinnedLeftColumns = pinnedLeft.map((column, i) => {
            const item = pinnedLeftOffsets[i];
            return { column, index: visibleColumns.indexOf(column), offset: item.offset, width: item.size };
        });

        const columns = scrollable.slice(columnRange.start, columnRange.end).map((column, i) => {
            const columnIndex = columnRange.start + i;
            const item = scrollableOffsets[columnIndex];
            return {
                column,
                index: visibleColumns.indexOf(column),
                offset: pinnedLeftWidth + item.offset,
                width: item.size,
            };
        });

        const pinnedRightColumns = pinnedRight.map((column, i) => {
            const item = pinnedRightOffsets[i];
            return {
                column,
                index: visibleColumns.indexOf(column),
                offset: pinnedLeftWidth + scrollableWidth + item.offset,
                width: item.size,
            };
        });

        return {
            rows: processedData.slice(rowRange.start, rowRange.end).map((data, index) => {
                const rowIndex = rowRange.start + index;
                return { id: this.getRowId(data, rowIndex), data, index: rowIndex, offset: rowIndex * state.rowHeight };
            }),
            columns,
            pinnedLeftColumns,
            pinnedRightColumns,
            leafColumns: scrollable,
            pinnedLeftLeafColumns: pinnedLeft,
            pinnedRightLeafColumns: pinnedRight,
            columnOffsets: scrollableOffsets,
            pinnedLeftOffsets,
            pinnedRightOffsets,
            columnGroups,
            headerRowCount,
            columnGroupDepth,
            rowRange,
            columnRange,
            totalWidth,
            totalHeight: this.virtualizer.getTotalHeight(processedData.length),
        };
    }

    /**
     * Expands the shared scrollable column window so `colSpan` origins stay
     * anchored during horizontal scrolling.
     *
     * Left: bounded lookback (`MAX_SPAN_LOOKBACK`) while any visible leaf
     * declares `colSpan` — covers spans that start before the window and
     * bleed into it. Right: extends past the window by the largest declared
     * static span minus one, so a span starting on the last visible leaf is
     * not clipped. Dynamic per-row spans beyond these bounds resolve in the
     * adapter via `getRowSpans` over the full `leafColumns`.
     *
     * @param scrollable - Ordered scrollable leaf columns.
     * @param range - Base virtual window from the virtualizer.
     * @returns Expanded `[start, end)` window, clamped to the group.
     */
    private static expandColumnRangeForSpans<T>(scrollable: ColumnLeafDef<T>[], range: { start: number; end: number }): { start: number; end: number } {
        if (scrollable.length === 0) return { start: 0, end: 0 };
        let hasSpan: boolean = false;
        let maxStaticSpan: number = 1;
        for (let i: number = 0; i < scrollable.length; i += 1) {
            const declared: unknown = scrollable[i].colSpan;
            if (declared === undefined) continue;
            hasSpan = true;
            if (typeof declared === "number" && Number.isFinite(declared)) {
                const span: number = Math.floor(declared);
                if (span > maxStaticSpan) maxStaticSpan = span;
            }
        }
        if (!hasSpan) return { start: range.start, end: range.end };
        const lookback: number = 64;
        const start: number = Math.max(0, range.start - lookback);
        const end: number = Math.min(scrollable.length, Math.max(range.end, range.end + maxStaticSpan - 1));
        return { start, end };
    }

    /**
     * Resolves the per-row span layout for one pin group of the body.
     *
     * Thin entry point over `getRowSpans` bound to this grid's row identity
     * (`getRowId`): computes merged widths and covered cells for the given
     * row across the FULL leaf group (`ViewportData.leafColumns` /
     * `columnOffsets` for the scrollable section, pinned siblings likewise).
     * Adapters call this per visible row instead of re-implementing span math;
     * results are memoized per row/column-set by the caller for 60 FPS scroll.
     *
     * @param data - Raw row data object.
     * @param index - Zero-based row index in the processed dataset.
     * @param columns - Full ordered leaves of one pin group.
     * @param offsets - Pre-computed absolute geometry for `columns`.
     * @returns Per-row span layout for the group.
     * @api
     */
    public getRowSpans(data: T, index: number, columns: ColumnLeafDef<T>[], offsets: { offset: number; size: number }[]): RowSpanLayout {
        return getRowSpans(data, index, (row: T, rowIndex: number) => this.getRowId(row, rowIndex), columns, offsets);
    }

    /**
     * Resolves the normalized horizontal span of a single body cell.
     *
     * Entry point over `resolveColSpan` bound to this grid's row identity:
     * clips the declared `colSpan` to the pin group (`columnCount` leaves)
     * and falls back to `1` for invalid declarations or resolver errors.
     *
     * @param data - Raw row data object.
     * @param index - Zero-based row index in the processed dataset.
     * @param column - Column definition being evaluated.
     * @param columnIndex - Position of the column in the visible leaf layout.
     * @param columnCount - Total number of visible leaves in the pin group.
     * @returns Normalized span width in columns (`1` = no merge).
     * @api
     */
    public resolveColSpan(data: T, index: number, column: ColumnLeafDef<T>, columnIndex: number, columnCount: number): number {
        return resolveColSpan(data, index, (row: T, rowIndex: number) => this.getRowId(row, rowIndex), column, columnIndex, columnCount);
    }

    public getProcessedData(): T[] {
        // Pipeline: raw data -> filter engine -> processors (sort, ...) -> virtualization.
        // Cache is invalidated by setData / setColumns / filter changes / processor
        // registration. During scroll the pipeline is NOT re-run — critical
        // optimization for DOM Pool operation with large row counts.
        if (this.processedDataCache !== null) return this.processedDataCache;
        const result = [...this.dataProcessors].reduce((data, processor) => processor(data), this.getFilteredData());
        this.processedDataCache = result;
        return result;
    }

    private getFilteredData(): T[] {
        if (this.filteredDataCache !== null) return this.filteredDataCache;
        const state: GridState<T> = this.getState();
        let data: T[] = applyFilterModel(state.data, this.filterModel, state.columns);
        if (state.quickFilter) {
            data = applyQuickFilter(data, state.quickFilter, state.columns);
        }
        this.filteredDataCache = data;
        return this.filteredDataCache;
    }

    private static cloneFilterModel(model: FilterModel): FilterModel {
        const clone: FilterModel = {};
        for (const [key, entry] of Object.entries(model)) {
            const conditions: FilterCondition[] = entry.conditions.map((condition) => ({ ...condition }));
            clone[key] = entry.logic ? { conditions, logic: entry.logic } : { conditions };
        }
        return clone;
    }

    public setFilterModel(model: FilterModel): void {
        this.assertActive();
        const next: FilterModel = {};
        for (const [key, entry] of Object.entries(Grid.cloneFilterModel(model))) {
            if (entry.conditions.length > 0) next[key] = entry;
        }
        this.filterModel = next;
        this.filteredDataCache = null;
        this.processedDataCache = null;
        this.revision += 1;
        this.scrollTo({ scrollTop: 0 });
        this.store.setState({});
        this.recomputeOverlay();
        this.events.emit("filterChanged", this.getFilterModel());
    }

    public getFilterModel(): FilterModel {
        return Grid.cloneFilterModel(this.filterModel);
    }

    public setColumnFilter(field: string, condition: FilterCondition | null): void {
        this.assertActive();
        const next: FilterModel = this.getFilterModel();
        if (condition === null || !isActiveCondition(condition)) {
            if (!(field in next)) return;
            delete next[field];
        } else {
            const entry: ColumnFilterModel = { conditions: [{ ...condition }] };
            next[field] = entry;
        }
        this.setFilterModel(next);
    }

    public clearFilters(): void {
        this.assertActive();
        if (Object.keys(this.filterModel).length === 0) return;
        this.setFilterModel({});
    }

    /**
     * Sets the global quick filter query string. The query is split on commas
     * and matched case-insensitively against every column whose `searchable`
     * property is not `false`, using the column's `valueGetter` when present.
     * An empty string clears the quick filter. Emits `quickFilterChanged`.
     * @param query - The quick filter query.
     * @api
     */
    public setQuickFilter(query: string): void {
        this.assertActive();
        const nextQuery: string = query ?? "";
        if (this.store.getState().quickFilter === nextQuery) return;
        this.filteredDataCache = null;
        this.processedDataCache = null;
        this.revision += 1;
        this.store.setState({ quickFilter: nextQuery });
        this.scrollTo({ scrollTop: 0 });
        this.recomputeOverlay();
        this.events.emit("quickFilterChanged", nextQuery);
    }

    /**
     * Returns the current global quick filter query string.
     * @returns The active quick filter query string.
     * @api
     */
    public getQuickFilter(): string {
        return this.store.getState().quickFilter;
    }

    public registerFilterMenu(): () => void {
        this.assertActive();
        this.filterMenuProviders += 1;
        this.refresh();
        let removed: boolean = false;
        return () => {
            if (removed) return;
            removed = true;
            this.filterMenuProviders -= 1;
            if (!this.destroyed) this.refresh();
        };
    }

    public hasFilterMenu(): boolean {
        return this.filterMenuProviders > 0;
    }

    public requestFilterMenu(columnId: string, anchor: UIPopupAnchor): void {
        this.assertActive();
        this.events.emit("filterMenuRequest", { columnId, anchor });
    }

    public openPopup(descriptor: UIPopupDescriptor): void {
        this.assertActive();
        this.popups.open(descriptor);
    }

    public closePopup(): void {
        this.assertActive();
        this.popups.close();
    }

    public getPopup(): UIPopupDescriptor | null {
        return this.popups.get();
    }

    public getRowId(row: T, index: number): RowId {
        return this.resolveRowId(row, index);
    }

    public setData(data: T[] | null | undefined): void {
        this.assertActive();
        this.loadError = undefined;
        this.hasData = data !== undefined && data !== null;
        const nextData: T[] = data ?? [];
        this.filteredDataCache = null;
        this.processedDataCache = null;
        this.revision += 1;
        this.store.setState({ data: nextData });
        this.events.emit("dataChange", nextData);
        this.recomputeOverlay();
    }

    /**
     * Chunk-append API for incremental data loading (infinite scroll, live
     * feeds). Concatenates `rows` onto the existing dataset inside the State
     * Store — the host does not need to re-send the whole array — then emits
     * a single `dataChange` with the combined result. A no-op for empty or
     * missing `rows`.
     */
    public appendData(rows: T[] | null | undefined): void {
        this.assertActive();
        if (!rows || rows.length === 0) return;
        const currentData: T[] = this.store.getState().data;
        const nextData: T[] = [...currentData, ...rows];
        this.hasData = true;
        this.filteredDataCache = null;
        this.processedDataCache = null;
        this.revision += 1;
        this.store.setState({ data: nextData });
        this.events.emit("dataChange", nextData);
        this.recomputeOverlay();
    }

    public setViewport(viewport: Partial<ViewportState>): void {
        this.assertActive();
        const state = this.store.getState();
        const current = state.viewport;
        const nextViewport = { ...current, ...viewport };

        // isUnchanged compares against the ephemeral scrollPosition, NOT
        // the Store's stale scrollTop (which scroll-only updates never
        // write to). Comparing against Store.scrollTop would make every
        // return-to-zero a no-op: 0 === 0 → early return → scrollPosition
        // never updated → DomPool renders rows at the old offset → empty grid.
        const isUnchanged =
            nextViewport.width === current.width &&
            nextViewport.height === current.height &&
            nextViewport.scrollTop === this.scrollPosition.scrollTop &&
            nextViewport.scrollLeft === this.scrollPosition.scrollLeft;
        if (isUnchanged) return;

        // Update the ephemeral scroll position ONLY for properties explicitly
        // passed. Dimension-only updates (e.g. scrollbar-detection calling
        // `setViewport({ width })`) must NOT clobber scrollPosition with a
        // stale Store scrollTop — otherwise the DomPool syncs to the wrong
        // position until the next rAF tick, causing blank/half-empty grids
        // on rapid scroll-to-top.
        if (viewport.scrollTop !== undefined) {
            this.scrollPosition.scrollTop = viewport.scrollTop;
        }
        if (viewport.scrollLeft !== undefined) {
            this.scrollPosition.scrollLeft = viewport.scrollLeft;
        }

        // Only notify Store subscribers (e.g. React via useSyncExternalStore)
        // when dimensions change. Scroll-only updates must NOT trigger a
        // Store notification — otherwise every scroll frame re-renders React.
        const hasStructuralChange = nextViewport.width !== current.width || nextViewport.height !== current.height;

        if (hasStructuralChange) {
            // Dimension changes are structural for the DOM Pool: adapters use
            // the revision to force-rebind row geometry (pixel widths) that
            // was computed for the previous viewport size. Without this bump a
            // shrunken grid could keep rows at their old WIDE width, stretching
            // scrollWidth beyond the last column and leaving phantom empty
            // space to the right of the table.
            this.revision += 1;
            this.store.setState({ viewport: nextViewport });
        }

        this.events.emit("viewportChange", nextViewport);
    }

    /**
     * Repaints the current viewport: notifies Store subscribers that
     * visible rows and row classes (rowClassRules) may need rebinding
     * in a single batch. Increments revision so adapters can detect
     * structural changes.
     */
    public refresh(): void {
        this.assertActive();
        this.revision += 1;
        this.store.setState({});
    }

    public setColumns(columns: GridState<T>["columns"]): void {
        this.assertActive();
        this.filteredDataCache = null;
        this.processedDataCache = null;
        this.revision += 1;
        this.store.setState({ columns });
        this.recomputeOverlay();
    }

    public registerDataProcessor(processor: DataProcessor<T>): () => void {
        this.assertActive();
        this.dataProcessors.add(processor);
        this.processedDataCache = null;
        this.recomputeOverlay();
        const unregister = () => {
            this.dataProcessors.delete(processor);
            this.processedDataCache = null;
            if (!this.destroyed) this.recomputeOverlay();
        };
        return unregister;
    }

    public headerClick(columnId: string, multiSort = false): void {
        this.assertActive();
        this.events.emit("headerClick", { columnId, multiSort });
    }

    public rowClick(row: RowClickEvent<T>): void {
        this.assertActive();
        this.events.emit("rowClick", row);
    }

    public rowHover(row: RowHoverEvent<T>): void {
        this.assertActive();
        this.events.emit("rowHover", row);
    }

    public subscribe(listener: () => void): () => void {
        if (this.destroyed) return () => undefined;
        return this.store.subscribe(listener);
    }

    public on<EventName extends keyof GridEvents<T>>(event: EventName, listener: (payload: GridEvents<T>[EventName]) => void): () => void {
        this.assertActive();
        return this.events.on(event, listener);
    }

    public emit<EventName extends keyof GridEvents<T>>(event: EventName, payload: GridEvents<T>[EventName]): void {
        this.assertActive();
        this.events.emit(event, payload);
    }

    public registerPlugin(plugin: GridPlugin<T>): () => void {
        this.assertActive();
        const cleanup = plugin.register(this);
        const unregister = () => {
            cleanup?.();
            this.cleanupPlugins.delete(unregister);
            if (this.pluginRegistrations.get(plugin) === unregister) this.pluginRegistrations.delete(plugin);
        };
        this.cleanupPlugins.add(unregister);
        this.pluginRegistrations.set(plugin, unregister);
        return unregister;
    }

    /**
     * Reconciles the registered plugins with the given list: plugins missing from
     * the list are unregistered (their cleanup restores default behavior), new
     * ones are registered. Plugins already registered are left untouched.
     * When the set actually changes, the vertical scroll position is reset to
     * the top, since the plugin set redefines how rows are sourced.
     * @param plugins - The desired plugin set.
     */
    public setPlugins(plugins: GridPlugin<T>[] | null | undefined): void {
        this.assertActive();
        const next: GridPlugin<T>[] = plugins ?? [];
        let changed: boolean = false;
        Array.from(this.pluginRegistrations.entries()).forEach(([plugin, unregister]) => {
            if (!next.includes(plugin)) {
                unregister();
                changed = true;
            }
        });
        next.forEach((plugin) => {
            if (!this.pluginRegistrations.has(plugin)) {
                this.registerPlugin(plugin);
                changed = true;
            }
        });
        if (changed) {
            this.scrollTo({ scrollTop: 0 });
            this.refresh();
        }
    }

    public getSlotMounts(slot: SlotName): SlotMount<T>[] {
        return this.slots.getMounts(slot);
    }

    public showOverlay(options: OverlayOptions): void {
        this.assertActive();
        this.overlayManual = true;
        this.overlayState = {
            ...options,
            scope: options.scope ?? (options.type === "error" ? "full" : "bodyOnly"),
            blockScroll: options.blockScroll ?? false,
        };
        this.store.setState({ overlay: { ...this.overlayState } });
        this.events.emit("overlayChange", { ...this.overlayState });
    }

    public hideOverlay(): void {
        this.assertActive();
        this.overlayManual = false;
        this.recomputeOverlay();
    }

    public getOverlayState(): OverlayState {
        return { ...this.overlayState };
    }

    public setLoading(isLoading: boolean, error?: unknown): void {
        this.assertActive();
        const nextError: unknown = isLoading ? undefined : error;
        if (this.loading === isLoading && this.loadError === nextError) return;
        this.loading = isLoading;
        this.loadError = nextError;
        this.recomputeOverlay();
    }

    /**
     * Re-evaluates the overlay based on the current Data Pipeline state.
     *
     * Skipped when a manual overlay is active (set via `showOverlay`). The
     * Store is only updated when the overlay type actually changes — identical
     * evaluations are a no-op to avoid spurious React re-renders.
     */
    private recomputeOverlay(): void {
        if (this.destroyed) return;
        if (this.overlayManual) return;

        const state = this.store.getState();
        const processedData = this.getProcessedData();
        const type: OverlayType | null = evaluateAutoOverlay({
            loading: this.loading || !this.hasData,
            error: this.loadError,
            rawData: state.data,
            processedData,
        });
        const next: OverlayState = type
            ? {
                  type,
                  scope: type === "error" ? "full" : "bodyOnly",
                  blockScroll: false,
                  ...(type === "error" && this.loadError !== undefined ? { payload: this.loadError } : {}),
              }
            : { type };

        if (
            next.type !== this.overlayState.type ||
            next.payload !== this.overlayState.payload ||
            next.scope !== this.overlayState.scope ||
            next.blockScroll !== this.overlayState.blockScroll ||
            next.message !== this.overlayState.message ||
            next.component !== this.overlayState.component
        ) {
            this.overlayState = next;
            this.store.setState({ overlay: { ...next } });
            this.events.emit("overlayChange", { ...next });
        }
    }

    /** Monotonic counter for structural changes (refresh / data / columns). */
    public getRevision(): number {
        return this.revision;
    }

    public destroy(): void {
        if (this.destroyed) return;
        this.cleanupPlugins.forEach((cleanup) => cleanup());
        this.cleanupPlugins.clear();
        this.dataProcessors.clear();
        this.popups.close();
        this.filteredDataCache = null;
        this.processedDataCache = null;
        this.overlayState = { type: null };
        this.overlayManual = false;
        this.slots.clear();
        this.store.clear();
        this.events.clear();
        this.destroyed = true;
    }

    public getLicenseKey(): string | undefined {
        return this.licenseKey;
    }

    public isDestroyed(): boolean {
        return this.destroyed;
    }

    private assertActive(): void {
        if (this.destroyed) throw new Error("Grid has been destroyed");
    }
}
