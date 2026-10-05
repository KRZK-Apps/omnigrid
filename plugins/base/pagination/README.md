# @omnigrid/pagination-plugin

Headless pagination plugin for OmniGrid. Mounts a pager into the bottom slot.

## What it provides

- Client-side pagination with configurable page sizes and automatic viewport-based sizing
- Server-side pagination that requests page changes without slicing supplied data
- Pager component rendered into the bottom slot
- API to navigate pages, set page size, and read current pagination state
- Accessible icon-only first, previous, next, and last page controls
- Customizable labels and icons
- Row range and page-size selection blocks, each independently configurable

## Usage

```ts
import { PaginationPlugin } from "@omnigrid/pagination-plugin";

const grid = new Grid({
  plugins: [new PaginationPlugin({ pageSize: 50 })],
  // ...
});
```

Set `pageSize: 0` to automatically fit whole rows into the grid's row area.
Auto subtracts the leaf header and all visible column-group header rows from
the viewport height before calculating the page size, with a minimum of one
row. When the plugin is configured with `pageSize: 0`, the page-size selector
includes `Auto` as its first option; `pageSizes` continues to configure the
numeric options.

For server-side pagination, set `mode: "server"` and provide `onChange`. The
plugin leaves data unchanged and calls `onChange({ page, pageSize })` when the
requested page or size changes. Provide the server's total row count with
`totalRows` and update it as responses arrive with `setTotalRows(totalRows)`.
Pass the server response's current page slice to the grid separately:
when `pageSize` is `0` (`Auto`), the callback receives the calculated number of
rows that fit in the viewport.

```ts
const pagination = new PaginationPlugin({
  mode: "server",
  pageSize: 50,
  totalRows: 1200,
  onChange: ({ page, pageSize }) => fetchPage(page, pageSize),
});
```

Pagination controls use the core SVG icon registry by default (`chevron-first`,
`chevron-left`, `chevron-right`, and `chevron-last`). Replace any control icon
through the plugin options with a declarative slot node or a factory:

```ts
new PaginationPlugin({
  icons: {
    prev: {
      type: "node",
      tag: "svg",
      attrs: { viewBox: "0 0 24 24", "aria-hidden": "true" },
      children: [{ type: "node", tag: "path", attrs: { d: "M15 18l-6-6 6-6" } }],
    },
  },
  pageSizes: [20, 50, 100],
  blocks: ["rowInfo", "navigation", "pageSize"],
  quickJump: true,
  pageInputCharacters: 2,
});
```

`blocks` selects and orders the visible sections; by default it is
`["navigation"]`. The available blocks are `"rowInfo"`, `"pageSize"`, and
`"navigation"`. Pagination blocks can be mounted in the `"top"` or `"bottom"`
slot, but not the side slots. The page-size dropdown opens above controls in
the bottom slot and below controls in the top slot. The default page-size
choices are `[20, 50, 100]`. A custom
numeric `pageSize` not in `pageSizes` is added to the choices automatically. The row
range message can be localized with `labels.rowInfo(from, to, totalRows)`, and
the selector labels with `labels.pageSizeLabel` and `labels.pageSizesLabel`.
Quick page navigation is disabled by default; set `quickJump: true` to show a
page-number input. Its width is controlled by `pageInputCharacters` (default
`2`), and Enter submits the page number. When quick navigation is disabled,
the current page and total pages use the `labels.pageInfo` formatter. The
quick-jump counter text can be localized with `labels.pageCount(totalPages)`.
The page-size control is labeled `Page Size:` by default. `setPageSize(size)`
changes the page size and returns to the first page. `setPageSize(0)` is
available only when the plugin was initially configured with `pageSize: 0`.

The grid also exposes `api.icons` for registering/replacing shared core icons.
The core registry includes common chevrons and up/down sorting arrows, and has
no dependency on an icon package.

## Links

- **Source:** https://github.com/KRZK-Apps/omnigrid/tree/main/plugins/base/pagination
- **Demo:** https://omnigrid-demo.vercel.app/
- **Issues:** https://github.com/KRZK-Apps/omnigrid/issues

## License

MIT © KRZK Apps
