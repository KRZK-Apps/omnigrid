import type { SlotManager } from "./slots";

export type RowId = string | number;
export type SortDirection = "asc" | "desc";
export type CellAlign = "left" | "center" | "right";
export type DataProcessor<T> = (data: T[]) => T[];

export interface RowRenderParams<T> {
    id: RowId;
    index: number;
    data: T;
}

export interface RowStyle {
    [property: string]: string | number | undefined;
}

/**
 * Dynamic rules for assigning CSS classes to rows.
 *
 * The key is the CSS class name, the value is a predicate that receives row
 * parameters (`RowRenderParams`) and returns `true` when the class should be
 * applied. Rules are dynamic: re-evaluated on every viewport commit and
 * applied in batch to all visible rows at once.
 */
export type RowClassRules<T> = Record<string, (params: RowRenderParams<T>) => boolean>;

/**
 * Context passed to every cell-level callback (`cellRenderer`, `getCellStyle`,
 * `cellClass`, `getCellClass`, `cellClassRules`).
 *
 * Shape is the same for all of them. `value` is populated when the engine
 * renders the cell content (`cellRenderer`); the style / class resolution
 * passes may omit it (marks are `value?: unknown` to avoid computing the
 * per-cell value on every presentation pass).
 */
export interface CellRenderParams<T> {
    id: RowId;
    index: number;
    data: T;
    column: ColumnLeafDef<T>;
    value?: unknown;
}

export type CellClassRules<T> = Record<string, (params: CellRenderParams<T>) => boolean>;

export interface CheckboxRenderParams {
    checked: boolean;
    indeterminate: boolean;
    disabled: boolean;
    ariaLabel: string;
    onChange: (event: { shiftKey: boolean; ctrlKey: boolean }) => void;
}

export interface CheckboxControl extends CheckboxRenderParams {
    type: "@omnigrid/checkbox";
}

interface BaseColumnDef<T> {
    id: string;
    header: string;
    pinned?: "left" | "right";
    headerRenderer?: (column: ColumnDef<T>) => unknown;
}

export interface ColumnLeafDef<T> extends BaseColumnDef<T> {
    field?: keyof T | string;
    hidden?: boolean;
    flex?: number;
    width?: number;
    minWidth?: number;
    maxWidth?: number;
    sortable?: boolean;
    align?: CellAlign;
    sortState?: SortDirection;
    stopRowClick?: boolean;
    stopHeaderClick?: boolean;
    valueGetter?: (row: T) => unknown;
    valueFormatter?: (value: unknown) => string;
    cellRenderer?: (params: CellRenderParams<T>) => unknown;
    cellStyle?: RowStyle;
    getCellStyle?: (params: CellRenderParams<T>) => RowStyle | undefined;
    cellClass?: string | ((params: CellRenderParams<T>) => string | undefined);
    getCellClass?: (params: CellRenderParams<T>) => string | undefined;
    cellClassRules?: CellClassRules<T>;
}

export interface ColumnGroupDef<T> extends BaseColumnDef<T> {
    children: ColumnDef<T>[];
    collapsible?: boolean;
    defaultExpanded?: boolean;
}

export type ColumnDef<T> = ColumnLeafDef<T> | ColumnGroupDef<T>;

export interface GridOptions<T> {
    data?: T[];
    columns: ColumnDef<T>[];
    getRowId?: (row: T, index: number) => RowId;
    rowHeight?: number;
    rowOverscan?: number;
    columnOverscan?: number;
    suppressRowHoverHighlight?: boolean;
    rowStyle?: RowStyle;
    getRowStyle?: (params: RowRenderParams<T>) => RowStyle | undefined;
    rowClass?: string | ((params: RowRenderParams<T>) => string | undefined);
    getRowClass?: (params: RowRenderParams<T>) => string | undefined;
    rowClassRules?: RowClassRules<T>;
    plugins?: GridPlugin<T>[];
}

export interface ViewportState {
    width: number;
    height: number;
    scrollTop: number;
    scrollLeft: number;
}

/** Ephemeral scroll position — not stored in the Store (no React re-render on scroll). */
export interface ScrollPosition {
    scrollTop: number;
    scrollLeft: number;
}

export interface Range {
    start: number;
    end: number;
}

export interface VirtualItem {
    index: number;
    offset: number;
    size: number;
}

/**
 * A column group projected onto the flat VISIBLE leaf layout.
 *
 * `startIndex` / `endIndex` address the flat ordering of the visible leaf
 * columns — the same indices reported by the `index` field on `ViewportData`
 * columns. `[startIndex, endIndex)` is the span of leaf columns the group
 * header covers on its header row. `depth` is the nesting level
 * (0 = top header row), and groups are listed in pre-order, so the adapter
 * can reconstruct the group tree when rendering stacked header rows.
 */
export interface ColumnGroupViewport<T> {
    group: ColumnGroupDef<T>;
    startIndex: number;
    endIndex: number;
    depth: number;
}

export interface ViewportData<T> {
    rows: Array<{ id: RowId; data: T; index: number; offset: number }>;
    /** Scrollable (virtualized) leaf columns of the current horizontal window. */
    columns: Array<{ column: ColumnLeafDef<T>; index: number; offset: number; width: number }>;
    /** Left-pinned leaf columns — always visible, absolute offsets from 0. */
    pinnedLeftColumns: Array<{ column: ColumnLeafDef<T>; index: number; offset: number; width: number }>;
    /** Right-pinned leaf columns — always visible, absolute offsets anchored to totalWidth. */
    pinnedRightColumns: Array<{ column: ColumnLeafDef<T>; index: number; offset: number; width: number }>;
    /**
     * Column groups (definitions with leaf spans) — the data needed to render
     * stacked group header rows. Empty when no groups are defined.
     */
    columnGroups: ColumnGroupViewport<T>[];
    /**
     * Number of group header rows stacked above the leaf header row.
     * Equals `maxGroupDepth + 1` when groups exist, `0` otherwise.
     * The total header height is `(headerRowCount + 1) * rowHeight`.
     */
    headerRowCount: number;
    /**
     * Maps each leaf column's flat visible index (the `index` field on
     * `columns` / `pinnedLeftColumns` / `pinnedRightColumns`) to the deepest
     * group depth that covers it.
     *
     * Adapters use this to determine how many gap rows lie between the deepest
     * covering group and the leaf row — leaf headers for columns with a shallow
     * covering group need to extend upward to fill that gap.
     */
    columnGroupDepth: Map<number, number>;
    rowRange: Range;
    columnRange: Range;
    totalWidth: number;
    totalHeight: number;
}

export interface GridState<T> {
    data: T[];
    columns: ColumnDef<T>[];
    viewport: ViewportState;
    rowHeight: number;
    rowOverscan: number;
    columnOverscan: number;
}

export interface GridEvents<T> {
    stateChange: GridState<T>;
    viewportChange: ViewportState;
    dataChange: T[];
    headerClick: { columnId: string; multiSort: boolean };
    rowClick: RowClickEvent<T>;
    rowHover: RowHoverEvent<T>;
    slotsChange: { slot: SlotName; mounts: SlotMount<T>[] };
}

/* ------------------------------------------------------------------ */
/* DOM Pool — reusable row nodes (core manages the "pool slot → row   */
/* index" mapping; DOM is touched only by the adapter via the          */
/* injected bindings contract).                                        */
/* ------------------------------------------------------------------ */

/** Opaque token for a row node owned by the adapter. */
export type RowHost<T> = object;

/** Data snapshot for binding a row node in the pool. */
export interface PooledRow<T> {
    index: number;
    rowId: RowId;
    data: T;
    offsetY: number;
    height: number;
    /** Pixel width of the row (sum of all column widths) — used to size the row node. */
    width: number;
}

/**
 * Injected node operations. The adapter implements these (e.g. setting
 * `textContent` and `transform: translateY`), while the core decides
 * WHEN and WHICH node to update.
 */
export interface DomPoolBindings<T> {
    createRow(): RowHost<T>;
    bindRow(host: RowHost<T>, row: PooledRow<T>): void;
    transformRow(host: RowHost<T>, offsetY: number): void;
    recycleRow(host: RowHost<T>): void;
}

/** Result of a viewport frame update (informational for tests/debugging). */
export interface DomPoolUpdate<T> {
    windowStart: number;
    windowEnd: number;
    poolSize: number;
    bound: Array<{ host: RowHost<T>; row: PooledRow<T> }>;
    positioned: Array<{ host: RowHost<T>; offsetY: number }>;
    recycled: RowHost<T>[];
}

export interface RowClickEvent<T> extends RowRenderParams<T> {
    ctrlKey: boolean;
    shiftKey: boolean;
}

export interface RowHoverEvent<T> extends RowRenderParams<T> {
    hovered: boolean;
}

export interface GridPlugin<T> {
    name: string;
    register(api: GridApi<T>): void | (() => void);
    getRowClass?(params: RowRenderParams<T>): string | undefined;
    getRowStyle?(params: RowRenderParams<T>): RowStyle | undefined;
}

/* ------------------------------------------------------------------ */
/* Slot Architecture — panels where plugins mount their widgets       */
/* ------------------------------------------------------------------ */

export type SlotName = "top" | "bottom" | "left" | "right";
export type SlotPosition = "start" | "center" | "end";
export type SlotNodeEventName = "click" | "change" | "keydown";

/**
 * Context passed to the slot content provider. Headless: the plugin
 * works only with the core API and state — no DOM or framework code.
 */
export interface SlotRenderContext<T> {
    api: GridApi<T>;
    state: GridState<T>;
    slot?: SlotName;
}

/** Raw HTML fragment (adapter inserts via innerHTML). */
export interface SlotHtmlContent {
    type: "html";
    html: string;
}

/**
 * Declarative DOM node for a slot: the adapter materializes it into a real
 * element and binds handlers. This lets a headless plugin (e.g. pagination)
 * create buttons without depending on React / Vue / Svelte.
 */
export interface SlotNodeContent<T> {
    type: "node";
    tag: string;
    attrs?: Record<string, string | number | boolean | undefined>;
    on?: Partial<Record<SlotNodeEventName, (context: SlotRenderContext<T>) => void>>;
    children?: SlotContent[];
}

/**
 * Request for a native adapter component: the adapter keeps a registry
 * `kind → renderer` and mounts a full component (e.g. a React component)
 * directly into the slot.
 */
export interface SlotComponentContent {
    type: "component";
    kind: string;
    payload?: unknown;
}

/**
 * Headless description of slot content. The value is opaque (just like the
 * result of `cellRenderer`): the core stores and propagates it as `unknown`,
 * and the adapter materializes it according to a documented runtime protocol:
 *
 *   - `string | number`                  → plain text;
 *   - `SlotHtmlContent`                  → HTML fragment;
 *   - `SlotNodeContent`                  → declarative DOM node;
 *   - `SlotComponentContent`             → component from the adapter registry;
 *   - any other object                    → framework-native value
 *     (in the React adapter this is a `ReactNode`, including React components).
 */
export type SlotContent = unknown;

/** Static content or a function that computes it on each render. */
export type SlotProvider<T> = SlotContent | ((context: SlotRenderContext<T>) => SlotContent);

export interface SlotMountOptions {
    /** Stable identifier (needed for unmount and key-preserving re-render). */
    id?: string;
    /** Order within the slot: lower comes first (default 0). */
    priority?: number;
    /** Alignment group within the slot (default "start"). */
    position?: SlotPosition;
}

export interface SlotMount<T> {
    id: string;
    slot: SlotName;
    content: SlotProvider<T>;
    priority: number;
    position: SlotPosition;
    unmount(): void;
}

export interface GridApi<T> {
    getState(): GridState<T>;
    getScrollPosition(): ScrollPosition;
    getViewportData(): ViewportData<T>;
    getProcessedData(): T[];
    getRowId(row: T, index: number): RowId;
    setData(data: T[]): void;
    setViewport(viewport: Partial<ViewportState>): void;
    refresh(): void;
    subscribe(listener: () => void): () => void;
    on<EventName extends keyof GridEvents<T>>(event: EventName, listener: (payload: GridEvents<T>[EventName]) => void): () => void;
    registerPlugin(plugin: GridPlugin<T>): () => void;
    registerDataProcessor(processor: DataProcessor<T>): () => void;
    setColumns(columns: ColumnDef<T>[]): void;
    headerClick(columnId: string, multiSort?: boolean): void;
    rowClick(row: RowClickEvent<T>): void;
    rowHover(row: RowHoverEvent<T>): void;
    readonly slots: SlotManager<T>;
    getSlotMounts(slot: SlotName): SlotMount<T>[];
    /** Monotonic counter for structural changes (refresh / data / columns). */
    getRevision(): number;
    destroy(): void;
    isDestroyed(): boolean;
}
