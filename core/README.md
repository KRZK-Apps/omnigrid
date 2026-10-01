# @omnigrid/core

Framework-agnostic core engine for OmniGrid — a fast, extensible data grid.

## What it provides

- **State Store** — lightweight observable state manager for column sizing, order, scroll position, and selection
- **Data Pipeline** — raw data → filter → sort → group/aggregate → paginate → virtual viewport
- **Virtualization Engine** — 2D windowing (rows + columns) with overscan for smooth scrolling on large datasets
- **Event Bus** — typed event system with `on`/`off`/`emit` for `cellClick`, `rowHover`, `scroll`, etc.
- **DOM Pool** — reusable DOM node pool for high-performance rendering
- **Slot Manager** — extensible slot system for headers, footers, cells, and custom UI

## Usage

```ts
import { Grid, Store, Virtualizer } from "@omnigrid/core";
```

## Links

- **Source:** https://github.com/KRZK-Apps/omnigrid/tree/main/core
- **Demo:** https://omnigrid-demo.vercel.app/
- **Issues:** https://github.com/KRZK-Apps/omnigrid/issues

## License

MIT © KRZK Apps
