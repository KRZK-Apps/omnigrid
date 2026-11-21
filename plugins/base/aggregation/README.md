# @omnigrid/aggregation-plugin

Headless column aggregation plugin for OmniGrid. Computes per-group aggregates for columns that declare an `aggFunc`, integrating with the row grouping plugin.

## What it provides

- Built-in functions: `"sum"`, `"avg"`, `"min"`, `"max"`, `"count"`
- Custom aggregation functions per column
- Per-group aggregates surfaced to group row renderers
- Works alongside `@omnigrid/grouping-plugin`

## Usage

```ts
import { Grid } from "@omnigrid/core";
import { AggregationPlugin } from "@omnigrid/aggregation-plugin";
import { GroupingPlugin } from "@omnigrid/grouping-plugin";

const columns = [
    { id: "region", field: "region", header: "Region" },
    { id: "sales", field: "sales", header: "Sales", aggFunc: "sum" },
];

const grid = new Grid({
    columns,
    data,
    plugins: [
        new GroupingPlugin({ groupBy: ["region"] }),
        new AggregationPlugin(),
    ],
});
```

## Links

- **Source:** https://github.com/KRZK-Apps/omnigrid/tree/main/plugins/base/aggregation
- **Demo:** https://omnigrid.cc/demo/react/plugins/base/aggregation
- **Issues:** https://github.com/KRZK-Apps/omnigrid/issues

## License

MIT © KRZK Apps