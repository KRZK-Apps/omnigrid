import type {
    AggregationFunc,
    DataRowNode,
    GroupRowNode,
    RowId,
    TreeRowNode,
} from "@omnigrid/core";

/** Internal mutable node used while building the group tree. */
export interface BuildGroupNode<T> extends GroupRowNode<T> {
    /** Leaf rows grouped directly under this node. */
    leaves: DataRowNode<T>[];
}

function isBuildGroupNode<T>(node: TreeRowNode<T>): node is BuildGroupNode<T> {
    return (node as GroupRowNode<T>).type === "group";
}

/** Counts total leaf descendants in a group's subtree. */
function countTotalLeaves<T>(node: BuildGroupNode<T>): number {
    let count = node.leaves.length;
    for (const child of node.children) {
        if (child.type === "group") {
            count += countTotalLeaves(child as BuildGroupNode<T>);
        }
    }
    return count;
}

/**
 * Builds a group tree from flat data.
 *
 * Rows are inserted level by level according to `groupBy`. The result is a
 * rooted tree whose root is a synthetic group (level -1). Use
 * `flattenTree` to obtain the linear `TreeRowNode[]` consumed by the
 * virtualizer.
 *
 * @param data - Filtered/sorted flat row data.
 * @param groupBy - Grouping fields in nesting order.
 * @param expandedGroups - Initial expanded state keyed by group id.
 * @param getRowId - Stable row id resolver.
 * @returns The root group node, or `null` when `groupBy` is empty.
 * @api
 */
export function buildGroupTree<T>(
    data: T[],
    groupBy: string[],
    expandedGroups: Record<string, boolean>,
    getRowId: (row: T, index: number) => RowId,
): BuildGroupNode<T> | null {
    if (!groupBy || groupBy.length === 0) return null;

    const root: BuildGroupNode<T> = {
        type: "group",
        id: "__root__",
        field: "",
        key: "",
        level: -1,
        expanded: true,
        childrenCount: 0,
        aggregations: {},
        children: [],
        leaves: [],
    } as unknown as BuildGroupNode<T>;

    for (let index: number = 0; index < data.length; index += 1) {
        const row: T = data[index];
        insertRow(root, row, groupBy, 0, index, getRowId, expandedGroups);
    }

    return root;
}

function insertRow<T>(
    node: BuildGroupNode<T>,
    row: T,
    groupBy: string[],
    level: number,
    rowIndex: number,
    getRowId: (row: T, index: number) => RowId,
    expandedGroups: Record<string, boolean>,
): void {
    if (level === groupBy.length) {
        node.leaves.push({
            type: "leaf",
            id: getRowId(row, rowIndex),
            data: row,
            level,
            parent: node,
        });
        return;
    }

    const field: string = groupBy[level];
    const key: string = String((row as Record<string, unknown>)[field] ?? "");
    const groupId: string = `${node.id}/${field}:${key}`;

    let child: BuildGroupNode<T> | undefined = node.children.find(
        (c): c is BuildGroupNode<T> => c.type === "group" && c.field === field && c.key === key,
    ) as BuildGroupNode<T> | undefined;

    if (!child) {
        child = {
            type: "group",
            id: groupId,
            field,
            key,
            level,
            expanded: expandedGroups[groupId] !== false,
            childrenCount: 0,
            aggregations: {},
            children: [],
            leaves: [],
            parent: node,
        } as unknown as BuildGroupNode<T>;
        node.children.push(child);
    }

    insertRow(child, row, groupBy, level + 1, rowIndex, getRowId, expandedGroups);
}

/**
 * Flattens a group tree into the linear array consumed by the virtualizer.
 *
 * Only expanded groups contribute their descendants to the output; a collapsed
 * group appears as a single row. Group `expanded` is re-derived from
 * `expandedGroups` on every call, so toggling a group only requires re-flatten
 * (no tree rebuild).
 *
 * When `collapseSingleChildGroups` is `true`, groups that resolve to exactly
 * one leaf row are rendered as a plain row instead of a collapsible group row.
 *
 * @param root - Root group node from `buildGroupTree`.
 * @param expandedGroups - Current expanded state keyed by group id.
 * @param collapseSingleChildGroups - Whether to collapse single-child groups.
 * @returns The flattened `TreeRowNode[]` in pre-order.
 * @api
 */
export function flattenTree<T>(
    root: BuildGroupNode<T> | null,
    expandedGroups: Record<string, boolean>,
    collapseSingleChildGroups: boolean = false,
): TreeRowNode<T>[] {
    const result: TreeRowNode<T>[] = [];
    if (!root) return result;

    for (const child of root.children) {
        if (child.type === "group") {
            flattenGroup(child as BuildGroupNode<T>, result, expandedGroups, collapseSingleChildGroups);
        } else {
            result.push(child);
        }
    }

    return result;
}

function flattenGroup<T>(
    node: BuildGroupNode<T>,
    result: TreeRowNode<T>[],
    expandedGroups: Record<string, boolean>,
    collapseSingleChildGroups: boolean = false,
): void {
    const totalLeaves: number = countTotalLeaves(node);
    const hasChildGroups: boolean = node.children.some((c) => c.type === "group");

    // Collapse only the lowest-level groups: exactly one leaf descendant and
    // no child groups. Upper levels always render as group rows with chevrons.
    if (collapseSingleChildGroups && totalLeaves === 1 && !hasChildGroups) {
        for (const leaf of node.leaves) result.push(leaf);
        return;
    }

    const expanded: boolean = expandedGroups[node.id] !== false;
    const flat: GroupRowNode<T> = {
        type: "group",
        id: node.id,
        field: node.field,
        key: node.key,
        level: node.level,
        expanded,
        childrenCount: node.childrenCount,
        aggregations: node.aggregations,
        children: [],
    };
    result.push(flat);

    if (!expanded) return;

    for (const child of node.children) {
        if (child.type === "group") {
            flattenGroup(child as BuildGroupNode<T>, result, expandedGroups, collapseSingleChildGroups);
        } else {
            result.push(child);
        }
    }

    // Leaf rows live in `leaves` (kept separate from sub-groups so
    // computeAggregations does not double-count them).
    for (const leaf of node.leaves) result.push(leaf);
}

/**
 * Computes per-column aggregates for every group in the tree (bottom-up).
 *
 * Aggregates cover all descendant leaf rows. Results are written into each
 * group node's `aggregations` map and `childrenCount`.
 *
 * @param root - Root group node.
 * @param aggregations - Column id -> aggregation function map registered via
 *   the grid aggregation API.
 * @api
 */
export function computeAggregations<T>(
    root: BuildGroupNode<T> | null,
    aggregations: Record<string, AggregationFunc<T>>,
): void {
    if (!root) return;

    const aggFuncs = new Map<string, AggregationFunc<T>>(Object.entries(aggregations));

    visit(root);

    function visit<TNode extends BuildGroupNode<T>>(node: TNode): { [columnId: string]: unknown[] } {
        const leafValues: { [columnId: string]: unknown[] } = {};

        // Direct leaf values.
        for (const leaf of node.leaves) {
            for (const [columnId, func] of aggFuncs) {
                let values: unknown[] | undefined = leafValues[columnId];
                if (!values) {
                    values = [];
                    leafValues[columnId] = values;
                }
                values.push(leaf.data[columnId as keyof T]);
            }
        }

        // Descendant group values.
        for (const child of node.children) {
            if (!isBuildGroupNode(child)) continue;
            const childValues: { [columnId: string]: unknown[] } = visit(child);
            for (const [columnId, values] of Object.entries(childValues)) {
                let target: unknown[] | undefined = leafValues[columnId];
                if (!target) {
                    target = [];
                    leafValues[columnId] = target;
                }
                target.push(...values);
            }
        }

        // Apply aggregation functions to accumulated values.
        for (const [columnId, func] of aggFuncs) {
            const values: unknown[] = leafValues[columnId] ?? [];
            if (typeof func === "function") {
                node.aggregations[columnId] = func(values);
            } else if (func === "sum") {
                node.aggregations[columnId] = values.reduce((sum: number, v: unknown) => sum + (Number(v) || 0), 0);
            } else if (func === "avg") {
                const numeric = values.filter((v: unknown): v is number => typeof v === "number" && !Number.isNaN(v));
                node.aggregations[columnId] = numeric.length > 0 ? numeric.reduce((sum: number, v: number) => sum + v, 0) / numeric.length : 0;
            } else if (func === "min") {
                const numeric = values.filter((v: unknown): v is number => typeof v === "number" && !Number.isNaN(v));
                node.aggregations[columnId] = numeric.length > 0 ? Math.min(...numeric) : undefined;
            } else if (func === "max") {
                const numeric = values.filter((v: unknown): v is number => typeof v === "number" && !Number.isNaN(v));
                node.aggregations[columnId] = numeric.length > 0 ? Math.max(...numeric) : undefined;
            } else if (func === "count") {
                node.aggregations[columnId] = values.length;
            }
        }

        node.childrenCount = node.leaves.length + node.children.reduce((sum: number, child) => sum + (isBuildGroupNode(child) ? child.childrenCount : 1), 0);

        return leafValues;
    }
}
