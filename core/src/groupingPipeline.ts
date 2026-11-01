import type {
    AggregationFunc,
    DataRowNode,
    GroupRowNode,
    RowId,
    TreeRowNode,
} from "./types";

/** Internal mutable node used while building the group tree. */
interface BuildGroupNode<T> extends GroupRowNode<T> {
    /** Leaf rows grouped directly under this node. */
    leaves: DataRowNode<T>[];
}

function isBuildGroupNode<T>(node: TreeRowNode<T>): node is BuildGroupNode<T> {
    return (node as GroupRowNode<T>).type === 'group';
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
        type: 'group',
        id: '__root__',
        field: '',
        key: '',
        level: -1,
        expanded: true,
        childrenCount: 0,
        aggregations: {},
        children: [],
        leaves: [],
    } as unknown as BuildGroupNode<T>;

    for (let index = 0; index < data.length; index += 1) {
        const row = data[index];
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
            type: 'leaf',
            id: getRowId(row, rowIndex),
            data: row,
            level,
            parent: node,
        });
        return;
    }

    const field = groupBy[level];
    const key = String((row as Record<string, unknown>)[field] ?? '');
    const groupId = `${node.id}/${field}:${key}`;

    let child = node.children.find(
        (c): c is BuildGroupNode<T> => c.type === 'group' && c.field === field && c.key === key,
    ) as BuildGroupNode<T> | undefined;

    if (!child) {
        child = {
            type: 'group',
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
 * @param root - Root group node from `buildGroupTree`.
 * @param expandedGroups - Current expanded state keyed by group id.
 * @returns The flattened `TreeRowNode[]` in pre-order.
 * @api
 */
export function flattenTree<T>(
    root: BuildGroupNode<T> | null,
    expandedGroups: Record<string, boolean>,
): TreeRowNode<T>[] {
    const result: TreeRowNode<T>[] = [];
    if (!root) return result;

    for (const child of root.children) {
        if (child.type === 'group') {
            flattenGroup(child as BuildGroupNode<T>, result, expandedGroups);
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
): void {
    const expanded = expandedGroups[node.id] !== false;
    const flat: GroupRowNode<T> = {
        type: 'group',
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
        if (child.type === 'group') {
            flattenGroup(child as BuildGroupNode<T>, result, expandedGroups);
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
 * @param aggregations - Column id -> aggregation function map, provided by an
 *   aggregation plugin (e.g. `@omnigrid/aggregation-plugin`).
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
                let values = leafValues[columnId];
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
            const childValues = visit(child);
            for (const [columnId, values] of Object.entries(childValues)) {
                let target = leafValues[columnId];
                if (!target) {
                    target = [];
                    leafValues[columnId] = target;
                }
                target.push(...values);
            }
        }

        // Resolve aggregates for this group.
        node.childrenCount = descendantLeafCount(node);
        const aggregations: Record<string, unknown> = {};
        for (const [columnId, func] of aggFuncs) {
            const values = leafValues[columnId] ?? [];
            aggregations[columnId] = resolveAggregation(func, values);
        }
        node.aggregations = aggregations;

        return leafValues;
    }
}

function descendantLeafCount<T>(node: BuildGroupNode<T>): number {
    let count = node.leaves.length;
    for (const child of node.children) {
        if (child.type === 'leaf') count += 1;
        else count += descendantLeafCount(child as BuildGroupNode<T>);
    }
    return count;
}

function resolveAggregation<T>(func: AggregationFunc<T>, values: unknown[]): unknown {
    if (typeof func === 'function') return func(values);

    const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

    switch (func) {
        case 'count':
            return values.length;
        case 'sum':
            return nums.reduce((total, v) => total + v, 0);
        case 'avg':
            return nums.length > 0 ? nums.reduce((total, v) => total + v, 0) / nums.length : undefined;
        case 'min':
            return nums.length > 0 ? Math.min(...nums) : undefined;
        case 'max':
            return nums.length > 0 ? Math.max(...nums) : undefined;
        default:
            return undefined;
    }
}
