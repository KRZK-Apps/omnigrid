import type {
    ColumnDef,
    ColumnGroupDef,
    ColumnGroupViewport,
    ColumnLeafDef,
} from "./types";

/**
 * Runtime narrowing: does the column definition describe a GROUP
 * (it carries `children`) rather than a leaf column?
 */
export function isColumnGroup<T>(column: ColumnDef<T>): column is ColumnGroupDef<T> {
    return "children" in column;
}

/** Inverse of `isColumnGroup` — handy for filters over the flat working set. */
export function isColumnLeaf<T>(column: ColumnDef<T>): column is ColumnLeafDef<T> {
    return !isColumnGroup(column);
}

/**
 * Depth-first flattening of the hierarchical column definitions into the
 * flat array of LEAF columns.
 *
 * This is the working set for virtualization: the Virtualizer and all
 * viewport geometry operate on `ColumnLeafDef<T>` only and never see group
 * nodes. Order is preserved (pre-order traversal), so grouped children stay
 * in place. `hidden` leaves are NOT filtered here — visibility filtering is
 * the caller's concern.
 */
export function flattenColumns<T>(columns: ColumnDef<T>[]): ColumnLeafDef<T>[] {
    const result: ColumnLeafDef<T>[] = [];

    for (const column of columns) {
        if (isColumnGroup(column)) {
            if (column.children.length > 0) result.push(...flattenColumns(column.children));
        } else {
            result.push(column);
        }
    }

    return result;
}

/**
 * Projects every group onto the flat VISIBLE leaf layout.
 *
 * For each group (in pre-order) returns its span over the visible leaf
 * indices: `[startIndex, endIndex)` is the range of leaf columns the group
 * header covers on its header row. The indices address the same flat
 * ordering as the `index` on `ViewportData` columns — computed by walking
 * the hierarchy while counting leaves for which `isVisible` returns true.
 *
 * Groups that contain no visible leaves are omitted. `depth` is the nesting
 * level (top-level groups are 0), letting the adapter reconstruct the group
 * tree when rendering stacked header rows.
 */
export function getColumnGroups<T>(
    columns: ColumnDef<T>[],
    isVisible: (leaf: ColumnLeafDef<T>) => boolean = () => true,
): ColumnGroupViewport<T>[] {
    const result: ColumnGroupViewport<T>[] = [];
    let leafIndex = 0;

    const walk = (nodes: ColumnDef<T>[], depth: number): void => {
        for (const node of nodes) {
            if (isColumnGroup(node)) {
                // Emit BEFORE walking children (pre-order): the adapter can
                // reconstruct the group tree with a depth stack because every
                // parent is seen before its nested children.
                const entry: ColumnGroupViewport<T> = {
                    group: node,
                    startIndex: leafIndex,
                    endIndex: leafIndex,
                    depth,
                };
                result.push(entry);
                walk(node.children, depth + 1);
                entry.endIndex = leafIndex;
                // Drop groups that ended up covering no visible leaves.
                if (entry.endIndex <= entry.startIndex) result.pop();
            } else if (isVisible(node)) {
                leafIndex += 1;
            }
        }
    };

    walk(columns, 0);
    return result;
}