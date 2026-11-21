# @omnigrid/column-filter-plugin

Headless column-filter popup for OmniGrid. Filtering itself lives in `@omnigrid/core`
(`grid.setFilterModel`, `grid.setColumnFilter`, `grid.clearFilters`); this plugin only
describes a filter menu with framework-agnostic `UIPopupDescriptor`s and opens it via
`grid.openPopup`, so any adapter (React, ...) can render it.

## Usage

```ts
import { Grid } from "@omnigrid/core";
import { ColumnFilterPlugin } from "@omnigrid/column-filter-plugin";

const filtering = new ColumnFilterPlugin<Row>();
const grid = new Grid({ columns, data, plugins: [filtering] });
filtering.openColumnFilter("name", { x: 120, y: 40, height: 32 });
```

## Links

- **Source:** https://github.com/KRZK-Apps/omnigrid/tree/main/plugins/base/column-filter
- **Demo:** https://omnigrid.cc/demo/react/plugins/base/filtering/column-filter
- **Issues:** https://github.com/KRZK-Apps/omnigrid/issues

## License

MIT © KRZK Apps
