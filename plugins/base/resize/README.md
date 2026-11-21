# @omnigrid/resize-plugin

Headless column resize plugin for OmniGrid. Adds draggable resize handles and double-click auto-fit to leaf column headers, respecting `minWidth` / `maxWidth` and pinned / grouped layouts.

## What it provides

- Drag a header handle to resize a leaf column; the group header above it tracks its children
- Double-click a header to auto-fit the column to the widest visible value
- Respects per-column `minWidth` / `maxWidth` and `resizable: false`
- Works with pinned left/right panes and column groups
- Emits `onResizeStart`, `onResize`, and `onResizeEnd` callbacks

## Usage

```ts
import { Grid } from "@omnigrid/core";
import { ColumnResizePlugin } from "@omnigrid/resize-plugin";

const grid = new Grid({
    columns: [
        { id: "name", field: "name", header: "Name", resizable: true },
        { id: "qty", field: "qty", header: "Qty", resizable: true },
    ],
    plugins: [
        new ColumnResizePlugin({
            onResize: (columnId, width) => console.log(columnId, width),
        }),
    ],
});
```

## Links

- **Source:** https://github.com/KRZK-Apps/omnigrid/tree/main/plugins/base/resize
- **Demo:** https://omnigrid.cc/demo/react/plugins/base/resize
- **Issues:** https://github.com/KRZK-Apps/omnigrid/issues

## License

MIT © KRZK Apps