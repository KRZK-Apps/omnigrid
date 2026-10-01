# @omnigrid/pagination-plugin

Headless pagination plugin for OmniGrid. Mounts a pager into the bottom slot.

## What it provides

- Client-side pagination with configurable page sizes
- Pager component rendered into the bottom slot
- API to navigate pages, set page size, and read current pagination state

## Usage

```ts
import { paginationPlugin } from "@omnigrid/pagination-plugin";

const grid = new Grid({
  plugins: [paginationPlugin({ pageSize: 50 })],
  // ...
});
```

## Links

- **Source:** https://github.com/KRZK-Apps/omnigrid/tree/main/plugins/base/pagination
- **Demo:** https://omnigrid-demo.vercel.app/
- **Issues:** https://github.com/KRZK-Apps/omnigrid/issues

## License

MIT © KRZK Apps
