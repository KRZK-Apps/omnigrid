# OmniGrid

A high-performance, framework-agnostic **headless data grid** for TypeScript.

The engine (`@omnigrid/core`) owns data, state, geometry, and 2D virtualization and never touches
the DOM. Thin adapters render it into a UI (React available today), and optional behavior ships as
plugins. Free **Base** plugins are MIT; commercial **Pro** plugins are distributed separately.

## Key capabilities

- **Headless core** — zero runtime dependencies, no DOM, no framework imports, runs in Node.
- **2D virtualization** — only rows/columns intersecting the viewport (plus overscan) are rendered;
  row DOM nodes are reused via a pool and repositioned with `transform: translateY(...)`.
- **Scroll is not state** — scroll-only updates never notify the store, so the UI does not
  re-render on scroll frames.
- **Plugin system** — sorting, selection, and pagination plug into the core data pipeline.
- **Slot architecture** — plugins mount headless widgets into `top | bottom | left | right` using a
  framework-agnostic content protocol (text / HTML / declarative nodes / native components).
- **Theming** — structural CSS (`omnigrid-` prefixed classes) + `--omnigrid-*` CSS variables;
  light and dark color themes.

## Packages in this repository

| Package | Directory | Description |
|---|---|---|
| `@omnigrid/core` | `core/` | Headless engine: state store, events, data pipeline, virtualization, slots, icons |
| `@omnigrid/react` | `adapters/react/` | React adapter/renderer (DOM layer) |
| `@omnigrid/sorting-plugin` | `plugins/base/sorting/` | Column sorting (single + multi) |
| `@omnigrid/selection-plugin` | `plugins/base/selection/` | Row/cell selection, checkbox column |
| `@omnigrid/pagination-plugin` | `plugins/base/pagination/` | Client/server pagination, pager in a slot |
| `@omnigrid/style` | `style/` | Required structural CSS |
| `@omnigrid/default-theme` | `themes/default/` | Default light/dark colors |
| `@omnigrid/mint-theme` | `themes/mint/` | Mint light/dark colors |

> `plugins/pro/` is an empty public stub — commercial Pro plugins (`@omnigrid/plugin-pro`, grouping,
> export, tree data, …) live in a separate private repository.

Related but external repositories: `omnigrid-demo` (Next.js demo site) and `omnigrid-pro` (commercial).

## Install

```bash
# React grid (pulls in core + style + default theme automatically)
npm install @omnigrid/react
# Headless core only
npm install @omnigrid/core
# Optional plugins / themes
npm install @omnigrid/sorting-plugin @omnigrid/selection-plugin @omnigrid/pagination-plugin
npm install @omnigrid/mint-theme
```

## Quick start — React

```tsx
import { useMemo } from "react";
import { OmniGrid } from "@omnigrid/react";
import { SortingPlugin } from "@omnigrid/sorting-plugin";

const sorting = useMemo(() => new SortingPlugin<Row>(), []); // one instance per grid

<OmniGrid
    columns={columns}                // ColumnDef<T>[]
    data={rows}                      // T[]
    getRowId={(row) => row.id}       // stable RowId — recycling, selection
    plugins={[sorting]}
    style={{ height: 480 }}          // fixed height ⇒ scrollable virtual viewport
/>;
```

## Quick start — Core (headless)

```ts
import { Grid } from "@omnigrid/core";
import type { ColumnDef } from "@omnigrid/core";
import { SelectionPlugin } from "@omnigrid/selection-plugin";

const columns: ColumnDef<Row>[] = [
    { id: "name", field: "name", header: "Name", width: 220, sortable: true },
];

const grid = new Grid<Row>({
    data: rows,
    columns,
    getRowId: (row) => row.id,
    plugins: [new SelectionPlugin<Row>()],
});

grid.on("rowClick", (event) => console.log(event.id));
grid.setViewport({ width: 800, height: 400 }); // adapter feeds geometry
const viewport = grid.getViewportData();       // virtualized window + offsets
grid.destroy();
```

## Documentation

- [`llms.txt`](llms.txt) — concise AI-tooling overview (core concepts, quick starts).
- [`AI_INSTRUCTIONS.md`](AI_INSTRUCTIONS.md) — mandatory editing rules; each package adds its own
  `AI_INSTRUCTIONS.md` (e.g. [`core/AI_INSTRUCTIONS.md`](core/AI_INSTRUCTIONS.md)).
- [`core/README.md`](core/README.md) — core API contracts: `GridApi`, `ColumnDef`, `GridOptions`.
- [`adapters/react/README.md`](adapters/react/README.md) — React adapter details.
- Every package has its own `README.md` (usage, options) and `AI_INSTRUCTIONS.md` (dev rules).
- Architecture documents live in the workspace `doc/` folder.

## Links

- **Demo:** https://omnigrid-demo.vercel.app/
- **Issues:** https://github.com/KRZK-Apps/omnigrid/issues

## License

Base packages (core, react, base plugins, style, themes): **MIT** © KRZK Apps.
Pro plugins (`@omnigrid/plugin-pro`): commercial license.
