# @omnigrid/grouping-plugin

Headless row grouping plugin for OmniGrid. Collapses rows that share a value on grouped fields into expandable group rows, computes group aggregations, and exposes grouping methods on `GridApi`.

## What it provides

- Multi-level grouping by one or more fields, rendered as a single Group column or per-level columns
- Expand / collapse per group, expand all / collapse all, and initial expanded-state control
- Optional group child counts and group-key visibility
- `collapseSingleChildGroups` to render single-child groups as plain rows
- Group aggregations via `@omnigrid/aggregation-plugin` integration
- Programmatic API through `GridApi` (`setGroupBy`, `toggleGroup`, `expandAll`, `collapseAll`, `getGroupedRows`, …)

## Usage

```ts
import { Grid } from "@omnigrid/core";
import { GroupingPlugin } from "@omnigrid/grouping-plugin";

const grouping = new GroupingPlugin<Row>({
    groupBy: ["region", "department"],
    groupColumnMode: "single",
    collapseSingleChildGroups: false,
});

const grid = new Grid({
    columns,
    data,
    plugins: [grouping],
});
```

## Links

- **Source:** https://github.com/KRZK-Apps/omnigrid/tree/main/plugins/base/grouping
- **Demo:** https://omnigrid.cc/demo/react/plugins/base/grouping
- **Issues:** https://github.com/KRZK-Apps/omnigrid/issues

## License

MIT © KRZK Apps