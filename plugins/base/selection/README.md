# @omnigrid/selection-plugin

Headless row/column selection plugin for OmniGrid.

## What it provides

- Row selection (single, multi, range, checkbox toggle)
- Cell selection with range drag
- Keyboard navigation support (Shift+Click, Ctrl+Click)
- API to read/modify selection state programmatically

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
