import { flattenColumns, getColumnGroups } from "./columns";
import { EventBus } from "./events";
import { IconRegistry } from "./icons";
import { SlotManager } from "./slots";
import { Store } from "./store";
import type {
    DataProcessor,
    GridApi,
    GridEvents,
    GridOptions,
    GridPlugin,
    GridState,
    RowClickEvent,
    RowHoverEvent,
    RowId,
    ScrollPosition,
    SlotMount,
    SlotName,
    ViewportData,
    ViewportState,
} from "./types";
import { Virtualizer } from "./virtualizer";

export class Grid<T> implements GridApi<T> {
    private readonly store: Store<GridState<T>>;
    private readonly events = new EventBus<GridEvents<T>>();
    private readonly virtualizer: Virtualizer<T>;
    private readonly cleanupPlugins = new Set<() => void>();
    private readonly dataProcessors = new Set<DataProcessor<T>>();
    private readonly resolveRowId: NonNullable<GridOptions<T>["getRowId"]>;
    public readonly slots: SlotManager<T>;
    public readonly icons = new IconRegistry<T>();
    private processedDataCache: T[] | null = null;
    private revision = 0;
    private destroyed = false;

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
        };
        this.store = new Store(state);
        this.resolveRowId = options.getRowId ?? ((_row, index) => index);
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
        const columnRange = scrollable.length ? this.virtualizer.getColumnRange(scrollable, scrollLeft, scrollableViewWidth) : { start: 0, end: 0 };

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
            columnGroups,
            headerRowCount,
            columnGroupDepth,
            rowRange,
            columnRange,
            totalWidth,
            totalHeight: this.virtualizer.getTotalHeight(processedData.length),
        };
    }

    public getProcessedData(): T[] {
        // Cache is invalidated by setData / setColumns / processor registration.
        // During scroll the pipeline is NOT re-run — critical optimization for
        // DOM Pool operation with large row counts.
        if (this.processedDataCache !== null) return this.processedDataCache;
        const result = [...this.dataProcessors].reduce((data, processor) => processor(data), this.getState().data);
        this.processedDataCache = result;
        return result;
    }

    public getRowId(row: T, index: number): RowId {
        return this.resolveRowId(row, index);
    }

    public setData(data: T[]): void {
        this.assertActive();
        this.processedDataCache = null;
        this.revision += 1;
        this.store.setState({ data });
        this.events.emit("dataChange", data);
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
        this.processedDataCache = null;
        this.revision += 1;
        this.store.setState({ columns });
    }

    public registerDataProcessor(processor: DataProcessor<T>): () => void {
        this.assertActive();
        this.dataProcessors.add(processor);
        this.processedDataCache = null;
        const unregister = () => {
            this.dataProcessors.delete(processor);
            this.processedDataCache = null;
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
        };
        this.cleanupPlugins.add(unregister);
        return unregister;
    }

    public getSlotMounts(slot: SlotName): SlotMount<T>[] {
        return this.slots.getMounts(slot);
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
        this.processedDataCache = null;
        this.slots.clear();
        this.store.clear();
        this.events.clear();
        this.destroyed = true;
    }

    public isDestroyed(): boolean {
        return this.destroyed;
    }

    private assertActive(): void {
        if (this.destroyed) throw new Error("Grid has been destroyed");
    }
}
