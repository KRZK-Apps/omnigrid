# @omnigrid/selection-plugin

Headless row/column selection plugin for OmniGrid.

## What it provides

- Row selection (single, multi, range, checkbox toggle)
- Disabled rows marked by `isRowSelectable` with the `omnigrid-row-unselectable` class
- Cell selection with range drag
- Keyboard navigation support (Shift+Click, Ctrl+Click)
- API to read/modify selection state programmatically

## Styling

Selected rows receive the `omnigrid-row-selected` CSS class. The plugin does
**not** set inline colors — the concrete selected-row color is owned by the
active theme (for example, `@omnigrid/default-theme` and `@omnigrid/mint-theme`
define `--omnigrid-cell-selected-background` and `--omnigrid-checkbox-accent`
for light and dark modes). Rows rejected by `isRowSelectable` receive
`omnigrid-row-unselectable` and use theme-provided muted background and text
colors via `--omnigrid-cell-unselectable-background` and
`--omnigrid-cell-unselectable-color`.

## Usage

```ts
import { SelectionPlugin } from "@omnigrid/selection-plugin";

const plugin = new SelectionPlugin({
  mode: "multiple",
  onSelectionChange: ({ selectedRowIds, selectedRows }) => {
    console.log("Selected count:", selectedRows.length);
    console.log("Selected IDs:", selectedRowIds);
    console.log("Selected records:", selectedRows);
  },
});

// Read the current selection at any time:
const selection = plugin.getSelectionState();
```

`onSelectionChange` runs when selection changes and receives the current row
IDs and row records. `getSelectedRowIds()`, `getSelectedRows()`, and
`getSelectionState()` provide synchronous access to the current selection.

## Links

- **Source:** https://github.com/KRZK-Apps/omnigrid/tree/main/plugins/base/selection
- **Demo:** https://omnigrid-demo.vercel.app/
- **Issues:** https://github.com/KRZK-Apps/omnigrid/issues

## License

MIT © KRZK Apps
