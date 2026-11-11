# @omnigrid/column-reorder-plugin

Headless drag-and-drop column reordering for OmniGrid.

Set `movable: true` on leaf columns or groups that can be dragged. Marking a group movable moves its
entire subtree. To enable it for every leaf column, use `defaultColumnDef: { movable: true }`. A drop
positions the dragged column or group before or after the target header. Leaf columns can move between
groups, but cannot move between pinned regions. Dropping after the last leaf in the final group inserts
the dragged column after that group.

Set `lockPosition: "start"` on a column or group to keep its leaf columns at the beginning of the
column order. Drops that would place another column before them are ignored.

```ts
import { ColumnReorderPlugin } from "@omnigrid/column-reorder-plugin";

const grid = new Grid({
    columns: [
        { id: "name", field: "name", header: "Name", movable: true },
        { id: "status", field: "status", header: "Status", movable: true },
    ],
    plugins: [new ColumnReorderPlugin()],
});
```

Use the optional `onChange` callback to persist the updated column definitions. The plugin also
exposes `moveColumn(sourceColumnId, targetColumnId, position)` for programmatic reordering.

## License

MIT © KRZK Apps
