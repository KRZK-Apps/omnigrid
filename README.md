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

### Ядро (core)

| Package          | Directory | Description                                                                       |
| ---------------- | --------- | --------------------------------------------------------------------------------- |
| `@omnigrid/core` | `core/`   | Headless engine: state store, events, data pipeline, virtualization, slots, icons |

### Адаптеры (adapters)

| Package           | Directory         | Description                        |
| ----------------- | ----------------- | ---------------------------------- |
| `@omnigrid/react` | `adapters/react/` | React adapter/renderer (DOM layer) |

### Плагины (plugins)

| Package                           | Directory                      | Description                               |
| --------------------------------- | ------------------------------ | ----------------------------------------- |
| `@omnigrid/sorting-plugin`        | `plugins/base/sorting/`        | Column sorting (single + multi)           |
| `@omnigrid/selection-plugin`      | `plugins/base/selection/`      | Row/cell selection, checkbox column       |
| `@omnigrid/pagination-plugin`     | `plugins/base/pagination/`     | Client/server pagination, pager in a slot |
| `@omnigrid/resize-plugin`         | `plugins/base/resize/`         | Column resize                             |
| `@omnigrid/column-reorder-plugin` | `plugins/base/column-reorder/` | Drag-and-drop column reordering           |
| `@omnigrid/grouping-plugin`       | `plugins/base/grouping/`       | Row grouping                              |
| `@omnigrid/quick-filter-plugin`   | `plugins/base/quick-filter/`   | Quick search input mounted into a slot    |
| `@omnigrid/column-filter-plugin`  | `plugins/base/column-filter/`  | Column filter popup menu                  |
| `@omnigrid/aggregation-plugin`    | `plugins/base/aggregation/`    | Aggregation                               |

### Стиль и темы (style & themes)

| Package                   | Directory         | Description               |
| ------------------------- | ----------------- | ------------------------- |
| `@omnigrid/style`         | `style/`          | Required structural CSS   |
| `@omnigrid/default-theme` | `themes/default/` | Default light/dark colors |
| `@omnigrid/mint-theme`    | `themes/mint/`    | Mint light/dark colors    |

> Commercial Pro plugins (`@omnigrid/plugin-pro`, export, tree data, …) live in a separate private repository.

## Install

```bash
# Headless core only
npm install @omnigrid/core
# React grid (pulls in core + style + default theme automatically)
npm install @omnigrid/react
# Optional plugins / themes
npm install @omnigrid/<plugin/theme>
```

## Quick start — React

```tsx
import { useMemo } from "react";
import { OmniGrid } from "@omnigrid/react";
import { SortingPlugin } from "@omnigrid/sorting-plugin";

const sorting = useMemo(() => new SortingPlugin<Row>(), []); // one instance per grid

<OmniGrid
    columns={columns} // ColumnDef<T>[]
    data={rows} // T[]
    getRowId={(row) => row.id} // stable RowId — recycling, selection
    plugins={[sorting]}
    style={{ height: 480 }} // fixed height ⇒ scrollable virtual viewport
/>;
```

## Quick start — Core (headless)

```ts
import { Grid } from "@omnigrid/core";
import type { ColumnDef } from "@omnigrid/core";
import { SelectionPlugin } from "@omnigrid/selection-plugin";

const columns: ColumnDef<Row>[] = [{ id: "name", field: "name", header: "Name", width: 220, sortable: true }];

const grid = new Grid<Row>({
    data: rows,
    columns,
    getRowId: (row) => row.id,
    plugins: [new SelectionPlugin<Row>()],
});

grid.on("rowClick", (event) => console.log(event.id));
grid.setViewport({ width: 800, height: 400 }); // adapter feeds geometry
const viewport = grid.getViewportData(); // virtualized window + offsets
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
