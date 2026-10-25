import type { OverlayOptions, OverlayState, OverlayType } from "./overlays";
import type { SlotManager } from "./slots";
import type { IconRegistry } from "./icons";
import type { FilterCondition, FilterModel, FilterOperator } from "./filtering";
import type { UIPopupAnchor, UIPopupDescriptor } from "./ui";

export type RowId = string | number;
export type SortDirection = "asc" | "desc";
export type CellAlign = "left" | "center" | "right";
export type DataProcessor<T> = (data: T[]) => T[];

/**
 * Nature of the values stored in a column.
 *
 * It describes the data itself — never the filter UI. Used for sorting,
 * formatting and to pick the default filter type of a column (a `number`
 * column gets the numeric filter, and so on).
 *
 * @api
 */
export type ColumnDataType = "text" | "number" | "date" | "boolean";

/**
 * Kind of filter UI rendered for a column.
 *
 * - `text` / `number` / `date` — single value input with an operator drop-down;
 * - `boolean` — All / Yes / No switch;
 * - `set` — checklist of the distinct values of the column;
 * - `custom` — filter registered by a third-party plugin.
 *
 * @api
 */
export type ColumnFilterType = "text" | "number" | "date" | "boolean" | "set" | "custom";

/**
 * Row identity and position metadata passed to row-aware callbacks.
 *
 * `RowNode` is a lightweight view over a single processed row: the stable
 * `id` (from `getRowId`), the zero-based `index` in the processed dataset,
 * and the raw `data` object itself.
 *
 * @api
 */
export interface RowNode<T> {
    /** Stable row identifier (from `getRowId`, defaults to row index). */
    id: RowId;
    /** Zero-based index of the row in the processed dataset. */
    index: number;
    /** Raw row data object. */
    data: T;
}

/**
 * Context passed to the `colSpan` resolver of a column.
 *
 * Mirrors the data-bearing fields of `RowNode` plus the column being
 * evaluated, so span decisions can depend on row values, row position,
 * or column identity.
 *
 * @api
 */
export interface CellSpanningParams<T> {
    /** Raw row data object. */
    data: T;
    /** Row identity and position metadata. */
    node: RowNode<T>;
    /** Column definition being evaluated for spanning. */
    column: ColumnLeafDef<T>;
}

/**
 * Horizontal span declared on a leaf column.
 *
 * A static number merges that many consecutive visible columns starting at
 * the current column; a function computes the span per row from
 * `CellSpanningParams`. Values are normalized to integers `>= 1`
 * (`1` = no spanning, the default).
 *
 * @api
 */
export type ColSpanDef<T> = number | ((params: CellSpanningParams<T>) => number);

/**
 * Normalized horizontal span of a single body cell.
 *
 * Produced per visible row by `getRowSpans`: `span` is the merged width in
 * columns (`1` = plain cell), `covered` marks cells hidden underneath a span
 * started at an earlier column.
 *
 * @api
 */
export interface CellSpan {
    /** Merged width in visible columns (`1` = no spanning). */
    span: number;
    /** Whether this cell is covered by a span that starts to its left. */
    covered: boolean;
}

/**
 * Per-row span layout for one pin group of the body.
 *
 * `spans` is indexed by position in the visible leaf group: `spans[i]`
 * describes the cell at that leaf for this row. `widths[i]` / `offsets[i]`
 * are the aggregated pixel geometry — the `left` of a span origin and the
 * summed width of the `span` covered columns.
 *
 * @api
 */
export interface RowSpanLayout {
    /** Per-leaf span descriptors, indexed by position in the pin group. */
    spans: CellSpan[];
    /** Aggregated pixel width per leaf (span origins carry the summed width). */
    widths: number[];
    /** Pixel `left` per leaf (span origins align with the starting column). */
    offsets: number[];
}
/**
 * Context passed to every row-level callback (`getRowStyle`, `getRowClass`,
 * `rowClassRules`, `checkboxDisabled`, ...).
 *
 * Alias of `RowNode`: the stable row id, the zero-based index in the
 * processed dataset, and the raw row data object.
 *
 * @api
 */
export type RowRenderParams<T> = RowNode<T>;


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

/**
 * Inline styles applied to all cells in a column.
 *
 * @api
 */
export interface ColumnStyle {
    [property: string]: string | number | undefined;
}

/**
 * Context passed to column-level presentation callbacks (`getColumnStyle`,
 * `getColumnClass`, `columnClassRules`).
 *
 * Evaluated once per column across the dataset rather than per individual cell.
 *
 * @api
 */
export interface ColumnStyleParams<T> {
    /** The leaf column definition being evaluated. */
    column: ColumnLeafDef<T>;
    /** All visible/filtered values for this column. */
    values: any[];
    /** The grid API instance. */
    api: GridApi<T>;
    /** Current grid state. */
    state: GridState<T>;
}

/**
 * Dynamic rules for assigning CSS classes to a column as a whole.
 *
 * @api
 */
export type ColumnClassRules<T> = Record<string, (params: ColumnStyleParams<T>) => boolean>;

/**
 * Context passed to leaf header presentation callbacks.
 *
 * @api
 */
export interface HeaderRenderParams<T> {
    /** The leaf column definition being rendered. */
    column: ColumnLeafDef<T>;
    /** Zero-based index of the leaf column in the visible layout. */
    index?: number;
}

/**
 * Inline styles applied to a column or group header.
 *
 * @api
 */
export interface HeaderStyle {
    [property: string]: string | number | undefined;
}

/**
 * Dynamic rules for assigning CSS classes to a leaf column header.
 *
 * @api
 */
export type HeaderClassRules<T> = Record<string, (params: HeaderRenderParams<T>) => boolean>;

/**
 * Context passed to column group header presentation callbacks.
 *
 * @api
 */
export interface HeaderGroupRenderParams<T> {
    /** The column group definition being rendered. */
    group: ColumnGroupDef<T>;
    /** Alias for `group` providing uniform access to the column definition. */
    column: ColumnGroupDef<T>;
    /** Depth of the group in the stacked header hierarchy (0 = topmost). */
    depth?: number;
    /** Number of leaf columns spanned by this group segment. */
    columnCount?: number;
}

/**
 * Dynamic rules for assigning CSS classes to a column group header.
 *
 * @api
 */
export type HeaderGroupClassRules<T> = Record<string, (params: HeaderGroupRenderParams<T>) => boolean>;

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
    /** Stable identifier used by the grid and plugins. */
    id: string;
    /** Text displayed in the column header. */
    header: string;
    /** Pins the column to a horizontal edge of the grid. */
    pinned?: "left" | "right";
    /** Whether this column may be resized by the resize plugin. */
    resizable?: boolean;
    /** Custom renderer for this column's header. */
    headerRenderer?: (column: ColumnDef<T>) => unknown;
    /**
     * Whether this column participates in the global quick filter. Defaults to true.
     * Columns with `searchable: false` are completely ignored by the global quick filter.
     * @default true
     * @api
     */
    searchable?: boolean;
}

export interface ColumnLeafDef<T> extends BaseColumnDef<T> {
    /** Row property used as the cell value source. */
    field?: keyof T | string;
    /** Hides this column without removing it from the column definitions. */
    hidden?: boolean;
    /** Relative width factor used to distribute available space. */
    flex?: number;
    /** Fixed column width in pixels. */
    width?: number;
    /** Minimum column width in pixels. */
    minWidth?: number;
    /** Maximum column width in pixels. */
    maxWidth?: number;
    /** Whether this column can be sorted. */
    sortable?: boolean;
    /**
     * Nature of the values in this column. When omitted, the filtering plugin
     * infers it by sampling the data.
     */
    dataType?: ColumnDataType;
    /**
     * Kind of filter UI rendered for this column. When omitted, it is derived
     * from `dataType` (and, failing that, from the sampled data).
     */
    filterType?: ColumnFilterType;
    /**
     * Identifier of a custom filter registered with the filtering plugin.
     * Required when `filterType` is `"custom"`.
     */
    filterTypeId?: string;
    /**
     * Whether this column offers a filter menu. Set to `false` to opt the column out of
     * filtering UI (the header filter icon is hidden).
     * @default true
     */
    filterable?: boolean;
    /**
     * Custom subset of operators allowed for this column's filter menu.
     */
    allowedOperators?: FilterOperator[];
    /**
     * Fixed option list used by the `"set"` filter. When provided, the column
     * defaults to `filterType: "set"` unless `filterType` is set explicitly.
     */
    filterOptions?: Array<{ label: string; value: any }>;
    /** Horizontal alignment of cell content. */
    align?: CellAlign;
    /** Enables automatic text wrapping instead of ellipsis truncation. @default false @api */
    wrapText?: boolean;
    /** Initial sort direction used by SortingPlugin. */
    sortState?: SortDirection;
    /** 1-based sort priority, set only while multiple columns are sorted. */
    sortIndex?: number;
    /** Compares values for this column, overriding the sorting plugin default. */
    comparator?: (left: unknown, right: unknown, column: ColumnLeafDef<T>) => number;
    /**
     * Horizontal cell merging declared on the column.
     *
     * A static number merges that many consecutive visible columns starting
     * at this column; a function computes the span per row from
     * `CellSpanningParams`. Normalized to an integer `>= 1` (`1` = no merge).
     * Spans are clipped to the visible leaf layout (pinned groups never
     * merge) and covered cells are skipped during rendering.
     *
     * @default 1
     * @api
     */
    colSpan?: ColSpanDef<T>;
    /** Prevents clicks in this column's cells from triggering row-click behavior. */
    stopRowClick?: boolean;
    /** Prevents clicks on this column's header from triggering header-click behavior. */
    stopHeaderClick?: boolean;
    /** Computes the cell value from the row; takes precedence over `field`. */
    valueGetter?: (row: T) => unknown;
    /** Formats the raw cell value for display. */
    valueFormatter?: (value: unknown) => string;
    /** Replaces the default cell content with custom content. */
    cellRenderer?: (params: CellRenderParams<T>) => unknown;
    /** Static inline styles applied to cells in this column. */
    cellStyle?: RowStyle;
    /** Computes inline styles for each rendered cell. */
    getCellStyle?: (params: CellRenderParams<T>) => RowStyle | undefined;
    /** Static CSS class applied to cells in this column. */
    cellClass?: string | ((params: CellRenderParams<T>) => string | undefined);
    /** Computes a CSS class for each rendered cell. */
    getCellClass?: (params: CellRenderParams<T>) => string | undefined;
    /** Maps CSS class names to predicates evaluated for each rendered cell. */
    cellClassRules?: CellClassRules<T>;
    /** Computes inline styles for the entire column body once per column evaluation across dataset. */
    getColumnStyle?: (params: ColumnStyleParams<T>) => ColumnStyle | undefined;
    /** Computes a CSS class for the entire column body across dataset. */
    getColumnClass?: (params: ColumnStyleParams<T>) => string | undefined;
    /** Maps CSS class names to predicates evaluated once for the entire column body across dataset. */
    columnClassRules?: ColumnClassRules<T>;
    /** Static inline styles applied to the leaf header cell of this column. */
    headerStyle?: HeaderStyle;
    /** Computes inline styles for the leaf header cell of this column. */
    getHeaderStyle?: (params: HeaderRenderParams<T>) => HeaderStyle | undefined;
    /** Static CSS class or resolver applied to the leaf header cell of this column. */
    headerClass?: string | ((params: HeaderRenderParams<T>) => string | undefined);
    /** Computes a CSS class for the leaf header cell of this column. */
    getHeaderClass?: (params: HeaderRenderParams<T>) => string | undefined;
    /** Maps CSS class names to predicates evaluated for the leaf header cell of this column. */
    headerClassRules?: HeaderClassRules<T>;
}

export interface ColumnGroupDef<T> extends BaseColumnDef<T> {
    /** Child column definitions nested under this group. */
    children: ColumnDef<T>[];
    /** Allows users to collapse and expand this group. */
    collapsible?: boolean;
    /** Whether this group starts expanded when it is collapsible. */
    defaultExpanded?: boolean;
    /** Static inline styles applied to this group header cell. */
    headerStyle?: HeaderStyle;
    /** Computes inline styles for this group header cell. */
    getHeaderStyle?: (params: HeaderGroupRenderParams<T>) => HeaderStyle | undefined;
    /** Static CSS class or resolver applied to this group header cell. */
    headerClass?: string | ((params: HeaderGroupRenderParams<T>) => string | undefined);
    /** Computes a CSS class for this group header cell. */
    getHeaderClass?: (params: HeaderGroupRenderParams<T>) => string | undefined;
    /** Maps CSS class names to predicates evaluated for this group header cell. */
    headerClassRules?: HeaderGroupClassRules<T>;
}

/** Leaf or grouped column definition accepted by the grid. */
export type ColumnDef<T> = ColumnLeafDef<T> | ColumnGroupDef<T>;

/**
 * Props supplied to a framework-specific overlay renderer.
 *
 * @api
 */
export interface OverlayComponentProps<T> {
    /** The active overlay state. */
    type: OverlayType;
    /** Optional display text override. */
    message?: string;
    /** Custom overlay payload. */
    payload?: unknown;
    /** Latest public grid state. */
    state: GridState<T>;
}

/**
 * Framework-neutral custom overlay renderer.
 *
 * @api
 */
export type OverlayComponent<T> =
    | ((props: OverlayComponentProps<T>) => unknown)
    | ((payload: unknown, state: GridState<T>) => unknown);

/**
 * Options for a single row-height update.
 *
 * @api
 */
export interface RowHeightUpdateOptions {
    /**
     * Whether the grid applies the scroll anchoring correction itself.
     * Set to `false` when the adapter wants to defer the correction — e.g.
     * while the user is actively scrolling, where a scrollTop jump fights
     * the user's input. The returned correction stays valid either way.
     * @default true
     */
    anchor?: boolean;
    /**
     * Whether the grid notifies its Store subscribers about the change.
     *
     * The row heights are NOT part of the grid state — the notification only
     * re-renders the host framework. Adapters that update the row geometry
     * imperatively (the DOM pool) can opt out: a re-render per measured row
     * starves the frame budget while the user scrolls, and the grid then
     * lags behind the native scroll position.
     * @default true
     */
    notify?: boolean;
}

export interface GridOptions<T> {
    /** Row data; omitted or null means an initial load is pending. */
    data?: T[] | null;
    columns: ColumnDef<T>[];
    /** Returns a stable row ID; defaults to the row's current index. Use a stable ID to preserve row identity when rows are reordered. */
    getRowId?: (row: T, index: number) => RowId;
    rowHeight?: number;
    /** Enables automatic text wrapping for all cells. @default false @api */
    wrapText?: boolean;
    /**
     * Fallback row height (px) for rows that have not been measured yet.
     * When set (or when `getRowHeight` is set), the grid switches to
     * variable-height mode: each row may have its own height, while unknown
     * rows use this estimate for scrollbar and range math.
     * Defaults to `rowHeight`.
     * @api
     */
    estimatedRowHeight?: number;
    /**
     * Synchronous per-row height resolver. Must be O(1) — it is consulted
     * during virtualization math. Return `undefined` to fall back to the
     * estimated height for that row. Dynamically measured heights (via
     * `setRowHeight`) always win over this resolver.
     *
     * The result is captured when the offset index is (re)built, so the
     * resolver must be stable for a given row index — changing it requires
     * a `setData` / `setColumns` call (or `resetAllRowHeights`).
     * @api
     */
    getRowHeight?: (rowIndex: number, row: T) => number | undefined;
    /** Rows to render beyond the visible viewport (top + bottom buffer). @default 5 */
    rowOverscan?: number;
    /** Columns to render beyond the visible viewport (left + right buffer). @default 2 */
    columnOverscan?: number;
    suppressRowHoverHighlight?: boolean;
    rowStyle?: RowStyle;
    getRowStyle?: (params: RowRenderParams<T>) => RowStyle | undefined;
    rowClass?: string | ((params: RowRenderParams<T>) => string | undefined);
    getRowClass?: (params: RowRenderParams<T>) => string | undefined;
    rowClassRules?: RowClassRules<T>;
    plugins?: GridPlugin<T>[];
    /** Initial filter model applied to the data pipeline. */
    filterModel?: FilterModel;
    /**
     * Initial global quick filter query string. Applied across every column
     * whose `searchable` property is not `false`.
     */
    quickFilter?: string;
    /**
     * License key for Pro plugins. When provided, Pro plugins verify the
     * cryptographic signature and activate full functionality. When missing
     * or invalid, Pro plugins enter demo mode with a non-intrusive watermark.
     * @api
     */
    licenseKey?: string;
    /** Whether data is currently being fetched. Triggers a loading overlay. @default false when data is supplied */
    loading?: boolean;
    /**
     * Custom overlay renderers keyed by overlay type or renderer identifier.
     * A one-argument function receives `OverlayComponentProps`; the legacy
     * two-argument form receives `(payload, state)`.
     */
    overlayComponents?: Record<string, unknown>;
    /**
     * Called with the grid API instance when the grid is ready.
     * Use this to programmatically control overlays, sorting, scrolling, etc.
     * @api
     */
    onGridReady?: (grid: GridApi<T>) => void;
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
    rows: Array<{ id: RowId; data: T; index: number; offset: number; height?: number }>;
    /** Scrollable (virtualized) leaf columns of the current horizontal window. */
    columns: Array<{ column: ColumnLeafDef<T>; index: number; offset: number; width: number }>;
    /** Left-pinned leaf columns — always visible, absolute offsets from 0. */
    pinnedLeftColumns: Array<{ column: ColumnLeafDef<T>; index: number; offset: number; width: number }>;
    /** Right-pinned leaf columns — always visible, absolute offsets anchored to totalWidth. */
    pinnedRightColumns: Array<{ column: ColumnLeafDef<T>; index: number; offset: number; width: number }>;
    /**
     * Full ordered leaf columns of each pin group (scrollable or pinned),
     * independent of the current virtual window. Adapters use these together
     * with `getRowSpans` (or `Grid.getRowSpans`) to resolve per-row spanning:
     * the windowed `columns` / `pinned*Columns` above only carry the visible
     * slice, while a span origin may sit before the window and cover into it.
     */
    leafColumns: ColumnLeafDef<T>[];
    /** Full ordered leaf columns of the left-pinned group. See `leafColumns`. */
    pinnedLeftLeafColumns: ColumnLeafDef<T>[];
    /** Full ordered leaf columns of the right-pinned group. See `leafColumns`. */
    pinnedRightLeafColumns: ColumnLeafDef<T>[];
    /**
     * Pre-computed absolute geometry (`offset`/`size`) for every entry of
     * `leafColumns`, aligned by position. Backs span width aggregation.
     */
    columnOffsets: VirtualItem[];
    /** Pre-computed absolute geometry for `pinnedLeftLeafColumns`, aligned by position. */
    pinnedLeftOffsets: VirtualItem[];
    /** Pre-computed absolute geometry for `pinnedRightLeafColumns`, aligned by position. */
    pinnedRightOffsets: VirtualItem[];
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
    /**
     * Rows that intersect the viewport — `rowRange` without the overscan
     * buffer.
     *
     * Adapters must bind these rows eagerly: pooled nodes are recycled in a
     * ring, so a node that was not re-bound shows the data of an unrelated
     * row.
     * @api
     */
    visibleRowRange: Range;
    columnRange: Range;
    /**
     * Per-row vertical offsets aligned with `rowRange` in variable-height mode.
     * Omitted in fixed-height mode.
     * @api
     */
    rowOffsets?: number[];
    /**
     * Per-row heights aligned with `rowRange` in variable-height mode.
     * Omitted in fixed-height mode.
     * @api
     */
    rowHeights?: number[];
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
    /** Active overlay state — updated automatically by the grid's overlay manager. */
    overlay: OverlayState;
    /**
     * Global quick filter query string. Applied across every column whose
     * `searchable` property is not `false`. Empty string means no quick filter.
     */
    quickFilter: string;
}

export interface GridEvents<T> {
    stateChange: GridState<T>;
    viewportChange: ViewportState;
    scrollTo: ScrollPosition;
    dataChange: T[];
    headerClick: { columnId: string; multiSort: boolean };
    sortingChanged: Array<{ columnId: string; direction: SortDirection }>;
    rowClick: RowClickEvent<T>;
    rowHover: RowHoverEvent<T>;
    slotsChange: { slot: SlotName; mounts: SlotMount<T>[] };
    overlayChange: OverlayState;
    /** Fired after the filter model changed; the payload is a copy of the new model. */
    filterChanged: FilterModel;
    /** Fired after the global quick filter changed; the payload is the new query string. */
    quickFilterChanged: string;
    /** Fired when a popup is opened, updated (`descriptor`) or closed (`null`). */
    popupChange: UIPopupDescriptor | null;
    /** Fired when the user asks for a column's filter menu (e.g. clicks the header filter icon). */
    filterMenuRequest: { columnId: string; anchor: UIPopupAnchor };
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
    /**
     * Applies a new height to an already bound row node.
     *
     * Called when only the row HEIGHT changed (variable-height mode) while
     * the row itself stayed the same: the content is still valid, so the
     * node only needs a new box. Rebinding instead would re-render every
     * cell of the row and re-trigger its measurement.
     *
     * Optional: when it is not implemented the pool falls back to a full
     * re-bind for height changes.
     * @api
     */
    resizeRow?(host: RowHost<T>, height: number): void;
    /**
     * Updates the row index a node stands for.
     *
     * Called when the node was re-used for a different row but its content
     * could not be re-bound in the same frame (fast scroll, rebind quota).
     * The node keeps the PREVIOUS content until it is bound, but its row
     * index must already describe the NEW row — adapters look rows up by
     * index (e.g. the hover highlight), and a stale index would highlight
     * the wrong node.
     *
     * Optional: when it is not implemented the node keeps its old index
     * until the content is bound.
     * @api
     */
    updateRowIndex?(host: RowHost<T>, rowIndex: number): void;
}

/**
 * Options passed to `DomPool.update()` to control binding behavior.
 *
 * @api
 */
export interface DomPoolUpdateOptions<T> {
    /** Full (post-processing) array of rows. */
    data: T[];
    /** Inclusive start, exclusive end of visible rows (from Virtualizer). */
    rowRange: Range;
    /** Pixel height of each row. */
    rowHeight: number;
    /**
     * Per-row geometry for variable-height mode, aligned with `rowRange`:
     * `rowOffsets[i]` / `rowHeights[i]` describe `data[rowRange.start + i]`.
     * When present, the pool positions each row at its own offset and height
     * instead of `rowIndex * rowHeight`. Omitted in fixed-height mode.
     * @api
     */
    rowOffsets?: number[];
    /** Per-row heights aligned with `rowOffsets`. See `rowOffsets`. @api */
    rowHeights?: number[];
    /**
     * Rows that intersect the viewport (a subset of `rowRange`, without the
     * overscan buffer).
     *
     * These rows are bound even when `skipBind` is set: a recycled node that
     * is not re-bound keeps the content of a completely unrelated row, and
     * the user would see the wrong data in the visible area. The off-screen
     * rows follow the rebind quota.
     * @api
     */
    visibleRowRange?: Range;
    /** Pixel width of each row (sum of all column widths). */
    rowWidth: number;
    /**
     * When `true`, row position (transform) is updated but content binding
     * (`bindRow`) is skipped — the row displays previous content at the
     * correct new position. Used during fast scroll to avoid synchronous
     * React commits that exceed the 16ms frame budget.
     *
     * @default false
     */
    skipBind?: boolean;
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

/**
 * A single targeted row transaction: add, update, or remove rows by their
 * stable identifier (`getRowId`) without recreating the whole data array.
 *
 * Rows are matched against the current dataset by their row id. `add`
 * appends new rows (optionally at `addIndex`), `update` replaces existing
 * rows matched by id, and `remove` drops rows matched by id or by row object
 * reference. Use a stable `getRowId` (a business key, not the row index) so
 * row identity survives reordering and transactions.
 *
 * @api
 */
export interface RowTransaction<T> {
    /** Rows to add. Each row receives a stable id via `getRowId`. */
    add?: T[];
    /**
     * Zero-based index at which added rows are inserted.
     * Defaults to appending at the end of the dataset.
     * @default dataset length
     * @api
     */
    addIndex?: number;
    /** Rows to update. Each row is matched by id and replaced with the new data. */
    update?: T[];
    /**
     * Rows to remove, given either as row objects (matched by id/reference)
     * or as raw row ids.
     * @api
     */
    remove?: Array<T | RowId>;
}

/**
 * Outcome of `Grid.applyTransaction`: the added, updated and removed rows
 * with their resolved ids and indexes in the dataset.
 *
 * @api
 */
export interface TransactionResult<T> {
    /** Rows that were added, with their resolved id and index. */
    added: RowNode<T>[];
    /** Rows that were updated, with their resolved id and index. */
    updated: RowNode<T>[];
    /** Rows that were removed, with their resolved id and previous index. */
    removed: RowNode<T>[];
}

/* ------------------------------------------------------------------ */
/* Slot Architecture — blocks where plugins mount their widgets       */
/* ------------------------------------------------------------------ */

export type SlotName = "top" | "bottom" | "left" | "right" | "bodyTop" | "bodyBottom" | "down";
export type SlotPosition = "start" | "center" | "end";

/**
 * Placement of a single UI block that a plugin mounts into a slot.
 *
 * Generic over `Name` so every plugin can restrict the accepted block names,
 * e.g. `BlockConfig<"rowInfo" | "pageSize" | "navigation">` in the pagination
 * plugin, while still being able to target any slot / position.
 */
export interface BlockConfig<Name extends string = string> {
    name: Name;
    slot?: SlotName;
    position?: SlotPosition;
    priority?: number;
}

export type SlotNodeEventName = "click" | "change" | "keydown" | "pointerdown" | "pointermove" | "pointerup" | "dblclick";

export interface SlotNodeEvent {
    value?: string;
    key?: string;
    clientX?: number;
    clientY?: number;
    button?: number;
}

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
    on?: Partial<Record<SlotNodeEventName, (context: SlotRenderContext<T>, event: SlotNodeEvent) => void>>;
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
    /**
     * Requests a native scroll position update from the active adapter.
     * @param position - Scroll coordinates to update.
     * @api
     */
    scrollTo(position: Partial<ScrollPosition>): void;
    getViewportData(): ViewportData<T>;
    getColumnWidth(columnId: string): number | undefined;
    getProcessedData(): T[];
    getRowId(row: T, index: number): RowId;
    /**
     * Resolves the normalized horizontal span of a single body cell.
     * Clips the declared `colSpan` to the pin group and falls back to `1`
     * for invalid declarations or resolver errors.
     * @param data - Raw row data object.
     * @param index - Zero-based row index in the processed dataset.
     * @param column - Column definition being evaluated.
     * @param columnIndex - Position of the column in the visible leaf layout.
     * @param columnCount - Total number of visible leaves in the pin group.
     * @returns Normalized span width in columns (`1` = no merge).
     * @api
     */
    resolveColSpan(data: T, index: number, column: ColumnLeafDef<T>, columnIndex: number, columnCount: number): number;
    /**
     * Resolves the per-row span layout for one pin group of the body.
     * Computes merged widths and covered cells across the FULL leaf group.
     * @param data - Raw row data object.
     * @param index - Zero-based row index in the processed dataset.
     * @param columns - Full ordered leaves of one pin group.
     * @param offsets - Pre-computed absolute geometry for `columns`.
     * @returns Per-row span layout for the group.
     * @api
     */
    getRowSpans(data: T, index: number, columns: ColumnLeafDef<T>[], offsets: { offset: number; size: number }[]): RowSpanLayout;
    setData(data: T[] | null | undefined): void;
    /**
     * Chunk-append API for incremental data loading (infinite scroll, live
     * feeds): appends `rows` to the end of the existing dataset without
     * rebuilding it from the host side. Patches the State Store directly and
     * emits a single `dataChange` with the combined array. Empty or missing
     * `rows` is a no-op.
     * @param rows - Chunk of rows appended to the end of the dataset.
     * @api
     */
    appendData(rows: T[] | null | undefined): void;
    /**
     * Applies a targeted row transaction (add / update / remove) to the State
     * Store without recreating the whole data array.
     *
     * Rows are matched by their stable id (`getRowId`). The pipeline caches
     * (filtered / processed data) are invalidated and the virtualizer's
     * row-height cache is reset only for the affected rows (or fully when the
     * dataset size changes), avoiding heavy recomputation.
     *
     * Emits a single `dataChange` with the resulting dataset and bumps the
     * grid revision.
     * @param transaction - The rows to add, update and/or remove.
     * @returns The added, updated and removed rows with resolved ids/indexes.
     * @api
     */
    applyTransaction(transaction: RowTransaction<T>): TransactionResult<T>;
    /**
     * Records the measured DOM height of a row (variable-height mode).
     * Heights below 1px delta are ignored to prevent feedback loops between
     * measurement and layout. Switching the height of rows above the current
     * scroll position keeps the anchored row visually stable: the returned
     * value is the scrollTop correction (px, may be negative) the adapter
     * must apply to its scroll container to prevent viewport jumps.
     * @param rowIndex - Zero-based index in the processed dataset.
     * @param height - Measured row height in pixels (must be finite and > 0).
     * @param options - Optional anchoring control.
     * @returns ScrollTop adjustment in pixels (`0` = no anchoring needed).
     * @api
     */
    setRowHeight(rowIndex: number, height: number, options?: RowHeightUpdateOptions): number;
    /**
     * Removes a measured row height (e.g. when row content collapses back to
     * the estimate). Returns the scrollTop correction like `setRowHeight`.
     * @param rowIndex - Zero-based index in the processed dataset.
     * @param options - Optional anchoring control.
     * @returns ScrollTop adjustment in pixels (`0` = no anchoring needed).
     * @api
     */
    resetRowHeight(rowIndex: number, options?: RowHeightUpdateOptions): number;
    /** Removes all measured row heights (e.g. after `setColumns`). @api */
    resetAllRowHeights(): void;
    /**
     * Returns the absolute vertical offset (px) of the top of a row,
     * accounting for variable heights. Falls back to `index * rowHeight`
     * when no measurements exist.
     * @param rowIndex - Zero-based index in the processed dataset.
     * @api
     */
    getRowTop(rowIndex: number): number;
    /**
     * Returns the current (measured, resolved, or estimated) height of a row.
     * @param rowIndex - Zero-based index in the processed dataset.
     * @api
     */
    getRowHeight(rowIndex: number): number;
    setViewport(viewport: Partial<ViewportState>): void;
    refresh(): void;
    subscribe(listener: () => void): () => void;
    on<EventName extends keyof GridEvents<T>>(event: EventName, listener: (payload: GridEvents<T>[EventName]) => void): () => void;
    /** Emits a typed grid event for plugin-to-plugin and adapter notifications. */
    emit<EventName extends keyof GridEvents<T>>(event: EventName, payload: GridEvents<T>[EventName]): void;
    registerPlugin(plugin: GridPlugin<T>): () => void;
    registerDataProcessor(processor: DataProcessor<T>): () => void;
    setColumns(columns: ColumnDef<T>[]): void;
    headerClick(columnId: string, multiSort?: boolean): void;
    rowClick(row: RowClickEvent<T>): void;
    rowHover(row: RowHoverEvent<T>): void;
    readonly slots: SlotManager<T>;
    readonly icons: IconRegistry<T>;
    getSlotMounts(slot: SlotName): SlotMount<T>[];
    /**
     * Returns the `licenseKey` supplied in `GridOptions`. The core never
     * interprets the key; Pro plugins verify it themselves.
     * @api
     */
    getLicenseKey(): string | undefined;
    /**
     * Shows an overlay using the supplied options.
     *
     * Manual overlays take precedence over automatic states until `hideOverlay`
     * is called. Vertical scrolling is locked for every active overlay;
     * `blockScroll` controls whether horizontal scrolling is locked.
     * @param options - Overlay type, scope, message, and custom render payload.
     * @api
     */
    showOverlay(options: OverlayOptions): void;
    /**
     * Hides the current overlay and re-enables automatic overlay evaluation
     * based on the Data Pipeline state.
     * @api
     */
    hideOverlay(): void;
    /**
     * Returns the current overlay state (a copy).
     * @api
     */
    getOverlayState(): OverlayState;
    /**
     * Marks the grid as loading or not — triggers automatic overlay
     * re-evaluation. When loading completes with an error, pass it as the
     * second argument to show the automatic error overlay. A subsequent
     * successful `setData` clears the error.
     * @api
     */
    setLoading(isLoading: boolean, error?: unknown): void;
    /**
     * Replaces the whole filter model. Filtering runs before every data
     * processor (sorting, pagination, ...) and its result is cached until the
     * data, columns or filter model change. Emits `filterChanged`.
     * @param model - New filter model; an empty object clears all filters.
     * @api
     */
    setFilterModel(model: FilterModel): void;
    /**
     * Returns a copy of the current filter model.
     * @api
     */
    getFilterModel(): FilterModel;
    /**
     * Sets (replaces) the single condition of one column, or removes that
     * column's filter when `condition` is `null`.
     * @param field - Column id or field.
     * @param condition - New condition, or `null` to clear.
     * @api
     */
    setColumnFilter(field: string, condition: FilterCondition | null): void;
    /**
     * Removes every column filter.
     * @api
     */
    clearFilters(): void;
    /**
     * Sets the global quick filter query string. The query is split on commas
     * and matched case-insensitively against every column whose `searchable`
     * property is not `false`, using the column's `valueGetter` when present.
     * An empty string clears the quick filter. Emits `quickFilterChanged`.
     * @param query - The quick filter query.
     * @api
     */
    setQuickFilter(query: string): void;
    /**
     * Returns the current global quick filter query string.
     * @api
     */
    getQuickFilter(): string;
    /**
     * Declares that a plugin provides a column filter menu. While at least one
     * provider is registered, adapters show the filter icon in column headers.
     * @returns Function that removes the registration.
     * @api
     */
    registerFilterMenu(): () => void;
    /**
     * Whether a filter menu provider is registered.
     * @api
     */
    hasFilterMenu(): boolean;
    /**
     * Asks the filter menu provider to open the menu of a column (emits `filterMenuRequest`).
     * @param columnId - Column id.
     * @param anchor - Viewport-relative rectangle of the trigger element.
     * @api
     */
    requestFilterMenu(columnId: string, anchor: UIPopupAnchor): void;
    /**
     * Opens (or updates, when the id matches) a declarative popup rendered by
     * the active UI adapter.
     * @param descriptor - Framework-agnostic popup description.
     * @api
     */
    openPopup(descriptor: UIPopupDescriptor): void;
    /**
     * Closes the active popup, if any.
     * @api
     */
    closePopup(): void;
    /**
     * Returns the active popup descriptor or `null`.
     * @api
     */
    getPopup(): UIPopupDescriptor | null;
    /** Monotonic counter for structural changes (refresh / data / columns). */
    getRevision(): number;
    destroy(): void;
    isDestroyed(): boolean;
}
