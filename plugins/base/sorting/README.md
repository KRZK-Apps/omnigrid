# @omnigrid/sorting-plugin

Headless column sorting plugin for OmniGrid.

## What it provides

- Single- and multi-column sorting (Shift+Click headers)
- Configurable sort directions (`asc`, `desc`, `none`)
- Accessor-based or custom comparator support
- Visual sort indicators via slot system

## Usage

```ts
import { sortingPlugin } from "@omnigrid/sorting-plugin";

const grid = new Grid({
  plugins: [sortingPlugin()],
  // ...
});
```

## Links

- **Source:** https://github.com/KRZK-Apps/omnigrid/tree/main/plugins/base/sorting
- **Demo:** https://omnigrid-demo.vercel.app/
- **Issues:** https://github.com/KRZK-Apps/omnigrid/issues

## License

MIT © KRZK Apps
