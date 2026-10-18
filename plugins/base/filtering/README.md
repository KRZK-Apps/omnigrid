# @omnigrid/filtering-plugin

Headless column-filter popup for OmniGrid. Filtering itself lives in `@omnigrid/core`
(`grid.setFilterModel`, `grid.setColumnFilter`, `grid.clearFilters`); this plugin only
describes a filter menu with framework-agnostic `UIPopupDescriptor`s and opens it via
`grid.openPopup`, so any adapter (React, ...) can render it.

```ts
const filtering = new FilteringPlugin<Row>();
const grid = new Grid({ columns, data, plugins: [filtering] });
filtering.openColumnFilter("name", { x: 120, y: 40, height: 32 });
```
