# @omnigrid/selection-plugin

Headless row/column selection plugin for OmniGrid.

## What it provides

- Row selection (single, multi, range, checkbox toggle)
- Cell selection with range drag
- Keyboard navigation support (Shift+Click, Ctrl+Click)
- API to read/modify selection state programmatically

## Styling

Selected rows receive the `omnigrid-row-selected` CSS class. The plugin does
**not** set inline colors — the concrete selected-row color is owned by the
active theme (for example, `@omnigrid/default-theme` and `@omnigrid/mint-theme`
define `--omnigrid-cell-selected-background` for light and dark modes).

## Usage

```ts
import { selectionPlugin } from "@omnigrid/selection-plugin";

const grid = new Grid({
  plugins: [selectionPlugin()],
  // ...
});
```

## Links

- **Source:** https://github.com/KRZK-Apps/omnigrid/tree/main/plugins/base/selection
- **Demo:** https://omnigrid-demo.vercel.app/
- **Issues:** https://github.com/KRZK-Apps/omnigrid/issues

## License

MIT © KRZK Apps
