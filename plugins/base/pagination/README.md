# @omnigrid/pagination-plugin

Headless pagination plugin for OmniGrid. Mounts a pager into the bottom slot.

## What it provides

- Client-side pagination with configurable page sizes
- Pager component rendered into the bottom slot
- API to navigate pages, set page size, and read current pagination state
- Accessible icon-only first, previous, next, and last page controls
- Customizable labels and icons
- Row range and page-size selection blocks, each independently configurable

## Usage

```ts
import { paginationPlugin } from "@omnigrid/pagination-plugin";

const grid = new Grid({
  plugins: [paginationPlugin({ pageSize: 50 })],
  // ...
});
```

Pagination controls use the core SVG icon registry by default (`chevron-first`,
`chevron-left`, `chevron-right`, and `chevron-last`). Replace any control icon
through the plugin options with a declarative slot node or a factory:

```ts
paginationPlugin({
  icons: {
    prev: {
      type: "node",
      tag: "svg",
      attrs: { viewBox: "0 0 24 24", "aria-hidden": "true" },
      children: [{ type: "node", tag: "path", attrs: { d: "M15 18l-6-6 6-6" } }],
    },
  },
  pageSizes: [20, 50, 100],
  panels: ["rowInfo", "navigation", "pageSize"],
  quickJump: true,
  pageInputCharacters: 2,
});
```

`panels` selects and orders the visible sections; by default it is
`["navigation"]`. The available panels are `"rowInfo"`, `"pageSize"`, and
`"navigation"`. The default page-size choices are `[20, 50, 100]`. The size
menu opens above its control. A custom
`pageSize` not in `pageSizes` is added to the choices automatically. The row
range message can be localized with `labels.rowInfo(from, to, totalRows)`, and
the selector labels with `labels.pageSizeLabel` and `labels.pageSizesLabel`.
Quick page navigation is disabled by default; set `quickJump: true` to show a
page-number input. Its width is controlled by `pageInputCharacters` (default
`2`), and Enter submits the page number. When quick navigation is disabled,
the current page and total pages use the `labels.pageInfo` formatter. The
quick-jump counter text can be localized with `labels.pageCount(totalPages)`.
The page-size control is labeled `Page Size:` by default. `setPageSize(size)`
changes the page size and returns to the first page.

The grid also exposes `api.icons` for registering/replacing shared core icons.
The core registry includes common chevrons and up/down sorting arrows, and has
no dependency on an icon package.

## Links

- **Source:** https://github.com/KRZK-Apps/omnigrid/tree/main/plugins/base/pagination
- **Demo:** https://omnigrid-demo.vercel.app/
- **Issues:** https://github.com/KRZK-Apps/omnigrid/issues

## License

MIT © KRZK Apps
