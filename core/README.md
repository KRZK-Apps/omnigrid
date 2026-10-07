# @omnigrid/core

Framework-agnostic core engine for OmniGrid — a fast, headless, extensible data grid.
Pure TypeScript, zero runtime dependencies, **no DOM, no framework imports**. The core owns data,
state, the data pipeline, 2D virtualization, DOM-pool row mapping, slots, and plugins; an adapter
(the React adapter in `@omnigrid/react`) renders it into a UI.

## What it provides

- **`Grid`** — entry point (`new Grid<T>(options)`), implements `GridApi<T>`.
- **State Store** — observable `GridState<T>`; structural changes notify subscribers and emit `stateChange`.
- **Data Pipeline** — plugins attach pure transforms (`T[] → T[]`) in registration order: raw → processed → virtualized.
- **Virtualization Engine (2D)** — visible window of rows *and* columns plus overscan; offsets are absolute table-space coordinates.
- **Event Bus** — typed `on(event, listener)`; returns an unsubscribe function.
- **DOM Pool mapping** — the core decides *which* rows are visible; the adapter performs DOM ops via injected `DomPoolBindings`.
- **Slot Manager / `GridApi.slots`** — headless widgets mounted by plugins into `top | bottom | left | right`.
- **Icon Registry** — framework-agnostic declarative SVG icons for plugin UI (`api.icons.get(name)`).

**Scroll is ephemeral, not state.** `scrollTop`/`scrollLeft` are kept out of the Store:
scroll-only `setViewport({ scrollTop, scrollLeft })` calls never notify subscribers, so adapters do
not re-render on scroll frames. Read them via `getScrollPosition()`.

## Key contracts

### `GridOptions<T>`

```ts
interface GridOptions<T> {
    data?: T[];                        // row data; omit when a plugin provides it (server pagination)
    columns: ColumnDef<T>[];           // required
    getRowId?: (row: T, index: number) => RowId;            // default: index-based
    rowHeight?: number;                // fixed px row height; default 32 (offset math is O(1))
    rowOverscan?: number;              // extra rows above/below viewport; default 5
    columnOverscan?: number;           // extra columns beyond horizontal window; default 2
    suppressRowHoverHighlight?: boolean;
    rowStyle?: RowStyle;
    getRowStyle?: (params: RowRenderParams<T>) => RowStyle | undefined;
    rowClass?: string | ((params: RowRenderParams<T>) => string | undefined);
    getRowClass?: (params: RowRenderParams<T>) => string | undefined;
    rowClassRules?: RowClassRules<T>;  // class name → predicate
    plugins?: GridPlugin<T>[];         // plugin instances registered at construction
}
```

### `ColumnDef<T>`

`ColumnDef<T> = ColumnLeafDef<T> | ColumnGroupDef<T>`. Groups nest via `children`; width/visibility/pinning can be combined freely.

```ts
interface ColumnLeafDef<T> {
    id: string;                              // unique column id (also stable slot key)
    header: string;
    field?: keyof T | string;                // value accessor (default cell value source)
    valueGetter?: (row: T) => unknown;       // overrides field
    valueFormatter?: (value: unknown) => string;
    width?: number;                          // fixed px width
    flex?: number;                           // flex weight; expands to fill remaining space
    minWidth?: number;
    maxWidth?: number;
    hidden?: boolean;
    pinned?: "left" | "right";               // fixed column in horizontal viewport
    sortable?: boolean;                      // read by SortingPlugin
    sortState?: SortDirection;               // "asc" | "desc" — initial sort for SortingPlugin
    align?: "left" | "center" | "right";
    cellRenderer?: (params: CellRenderParams<T>) => unknown;   // opaque content, adapter materializes
    cellStyle?: RowStyle;
    getCellStyle?: (params: CellRenderParams<T>) => RowStyle | undefined;
    cellClass?: string | ((params: CellRenderParams<T>) => string | undefined);
    getCellClass?: (params: CellRenderParams<T>) => string | undefined;
    cellClassRules?: CellClassRules<T>;
    headerRenderer?: (column: ColumnDef<T>) => unknown;
    stopRowClick?: boolean;
    stopHeaderClick?: boolean;
}

interface ColumnGroupDef<T> {
    id: string;
    header: string;
    children: ColumnDef<T>[];                // nested leaves / groups
    pinned?: "left" | "right";
    collapsible?: boolean;
    defaultExpanded?: boolean;
    headerRenderer?: (column: ColumnDef<T>) => unknown;
}
```

### `GridApi<T>`

`Grid<T>` implements this interface — the single public surface for adapters and plugins.
UI code must never touch core internals directly.

```ts
interface GridApi<T> {
    getState(): GridState<T>;                              // { data, columns, viewport, rowHeight, rowOverscan, columnOverscan }
    getScrollPosition(): ScrollPosition;                   // ephemeral scrollTop/scrollLeft
    getViewportData(): ViewportData<T>;                    // virtualized window: rows/columns + absolute offsets
    getProcessedData(): T[];                               // after all registered data processors
    getRowId(row: T, index: number): RowId;
    setData(data: T[]): void;
    setViewport(viewport: Partial<ViewportState>): void;   // width/height/scrollTop/scrollLeft; scroll-only ⇒ no Store notify
    refresh(): void;                                       // repaint hints (rowClassRules), bumps revision
    subscribe(listener: () => void): () => void;
    on<E extends keyof GridEvents<T>>(event: E, listener: (p: GridEvents<T>[E]) => void): () => void;
    registerPlugin(plugin: GridPlugin<T>): () => void;
    registerDataProcessor(processor: DataProcessor<T>): () => void;
    setColumns(columns: ColumnDef<T>[]): void;
    headerClick(columnId: string, multiSort?: boolean): void;
    rowClick(row: RowClickEvent<T>): void;
    rowHover(row: RowHoverEvent<T>): void;
    readonly slots: SlotManager<T>;                        // mount headless widgets
    readonly icons: IconRegistry<T>;                       // declarative SVG icons for plugin UI
    getSlotMounts(slot: SlotName): SlotMount<T>[];
    getRevision(): number;                                 // monotonic counter for structural changes
    destroy(): void;
    isDestroyed(): boolean;
}
```

`GridEvents<T>`: `stateChange` | `viewportChange` | `dataChange` | `headerClick` | `rowClick` | `rowHover` | `slotsChange`.
Example: `grid.on("rowClick", (e) => console.log(e.id, e.index, e.data))`.

### Plugin contract — `GridPlugin<T>`

```ts
interface GridPlugin<T> {
    name: string;                                          // unique, namespaced, e.g. "@omnigrid/sorting-plugin"
    register(api: GridApi<T>): void | (() => void);        // returns cleanup
    getRowClass?(params: RowRenderParams<T>): string | undefined;
    getRowStyle?(params: RowRenderParams<T>): RowStyle | undefined;
}
```

A plugin hooks the grid via `api.on(...)`, `api.registerDataProcessor(...)`, `api.slots.mount(...)`,
and `api.icons.register(...)`; it must return a cleanup function that tears down everything it created.
Plugin source must remain framework-agnostic (see [`AI_INSTRUCTIONS.md`](../AI_INSTRUCTIONS.md) and
[`core/AI_INSTRUCTIONS.md`](AI_INSTRUCTIONS.md) in this repo).

## Quick start

Headless core only (no UI):

```ts
import { Grid } from "@omnigrid/core";
import type { ColumnDef } from "@omnigrid/core";

interface Row { id: string; name: string }

const columns: ColumnDef<Row>[] = [
    { id: "name", field: "name", header: "Name", width: 220 },
];

const grid = new Grid<Row>({ data: [{ id: "1", name: "Ada" }], columns, getRowId: (row) => row.id });

grid.setViewport({ width: 400, height: 300 });   // the adapter normally feeds geometry
const viewport = grid.getViewportData();         // virtualized rows + columns + offsets
grid.on("rowClick", (e) => console.log(e.index));
grid.destroy();
```

With base plugins:

```ts
import { Grid } from "@omnigrid/core";
import { SortingPlugin } from "@omnigrid/sorting-plugin";
import { SelectionPlugin } from "@omnigrid/selection-plugin";
import { PaginationPlugin } from "@omnigrid/pagination-plugin";

const grid = new Grid<Row>({
    data,
    columns,
    getRowId: (row) => row.id,
    plugins: [
        new SortingPlugin<Row>(),
        new SelectionPlugin<Row>({ mode: "multiple", showRowCheckboxes: true }),
        new PaginationPlugin<Row>({ pageSize: 50 }),
    ],
});
```

In a UI framework, use the adapter — e.g. `@omnigrid/react`:

```tsx
<OmniGrid columns={columns} data={rows} getRowId={(row) => row.id} plugins={plugins} style={{ height: 480 }} />
```

See [@omnigrid/react](../../adapters/react/README.md).

## Exported helpers

- `flattenColumns`, `isColumnLeaf`, `isColumnGroup`, `getColumnGroups` — column tree utilities.
- `Store`, `Virtualizer`, `EventBus`, `DomPool`, `SlotManager`, `IconRegistry` — building blocks
  (mostly used internally; public for advanced integrations/tests).

## Links

- **Source:** https://github.com/KRZK-Apps/omnigrid/tree/main/core
- **Demo:** https://omnigrid-demo.vercel.app/
- **Issues:** https://github.com/KRZK-Apps/omnigrid/issues

## License

MIT © KRZK Apps
