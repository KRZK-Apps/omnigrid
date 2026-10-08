# @omnigrid/sorting-plugin

Headless column sorting plugin for OmniGrid.

## What it provides

- Single- and multi-column sorting (Shift+Click headers)
- Configurable sort directions (`asc`, `desc`, `none`)
- Accessor-based sorting and global or per-column custom comparators
- Client-side or server-side sorting
- Sort-priority badges for multi-column sorting
- Visual sort indicators via slot system

## Usage

```ts
import { SortingPlugin } from "@omnigrid/sorting-plugin";

const grid = new Grid({
  plugins: [new SortingPlugin({
    mode: "server",
    onChange: (sortModel) => fetchRows({ sortModel }),
    tristate: false,
  })],
  // ...
});
```

The default mode is `"client"` and sorts processed rows locally. In `"server"`
mode, the plugin updates each column's `sortState` but leaves row order intact;
use `onChange` or the grid's `sortingChanged` event to request server data.
Set `tristate: false` to toggle between ascending and descending without a
third click clearing the sort. A leaf column's `comparator` overrides the
plugin-wide `compare` option. To change the cycle after registration, call
`sortingPlugin.setTristate(false)` (or `true`).

## Links

- **Source:** https://github.com/KRZK-Apps/omnigrid/tree/main/plugins/base/sorting
- **Demo:** https://omnigrid-demo.vercel.app/
- **Issues:** https://github.com/KRZK-Apps/omnigrid/issues

## License

MIT © KRZK Apps
