import type { CellSpan, CellSpanningParams, ColumnDef, ColumnGroupDef, ColumnGroupViewport, ColumnLeafDef, RowId, RowNode, RowSpanLayout } from "./types";

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
 * Applies the grid-level `wrapText` flag to every leaf column that does not
 * define it explicitly — a column-level `wrapText` always wins.
 *
 * Returns the input untouched when the grid-level flag is not set.
 */
export function applyWrapText<T>(columns: ColumnDef<T>[], wrapText: boolean | undefined): ColumnDef<T>[] {
    if (wrapText === undefined) return columns;

    const walk = (nodes: ColumnDef<T>[]): ColumnDef<T>[] =>
        nodes.map((node) => {
            if (isColumnGroup(node)) {
                return { ...node, children: walk(node.children) };
            }
            return node.wrapText === undefined ? { ...node, wrapText } : node;
        });

    return walk(columns);
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

/**
 * Resolves the raw cell value from a row object using `valueGetter` or `field`.
 *
 * @param row - The row data object.
 * @param column - The leaf column definition.
 * @returns The resolved cell value, or undefined if not accessible.
 * @api
 */
export function getCellValue<T>(row: T, column: ColumnLeafDef<T>): unknown {
    if (column.valueGetter) return column.valueGetter(row);
    if (column.field) return (row as Record<string, unknown>)[column.field as string];
    return undefined;
}

/**
 * Builds the `CellSpanningParams` context for a single row.
 *
 * Shared by every span entry point so resolver functions always observe the
 * same row identity (`id` / `index` / `data` shape as `RowNode`).
 *
 * @param data - Raw row data object.
 * @param index - Zero-based index of the row in the processed dataset.
 * @param getRowId - Stable id resolver (defaults to the row index).
 * @param column - Column definition being evaluated.
 * @returns Span context handed to `colSpan` resolver functions.
 * @api
 */
export function getCellSpanningParams<T>(
    data: T,
    index: number,
    getRowId: (row: T, index: number) => RowId,
    column: ColumnLeafDef<T>,
): CellSpanningParams<T> {
    const node: RowNode<T> = { id: getRowId(data, index), index, data };
    return { data, node, column };
}

/**
 * Resolves the normalized horizontal span of one cell.
 *
 * Static numbers are used directly; functions are evaluated with
 * `getCellSpanningParams`. The result is floored to an integer, clamped to
 * `>= 1`, and clipped so the span never runs past `columnCount` leaves.
 * Resolver exceptions fall back to `1` (no merge) so a single bad callback
 * cannot break the viewport.
 *
 * @param data - Raw row data object.
 * @param index - Zero-based row index in the processed dataset.
 * @param getRowId - Stable id resolver.
 * @param column - Column definition being evaluated.
 * @param columnIndex - Position of the column in the visible leaf layout.
 * @param columnCount - Total number of visible leaves in the pin group.
 * @returns Normalized span width in columns (`1` = no merge).
 * @api
 */
export function resolveColSpan<T>(
    data: T,
    index: number,
    getRowId: (row: T, index: number) => RowId,
    column: ColumnLeafDef<T>,
    columnIndex: number,
    columnCount: number,
): number {
    const declared: ColumnLeafDef<T>["colSpan"] = column.colSpan;
    if (declared === undefined) return 1;
    let raw: number = 1;
    if (typeof declared === "function") {
        try {
            raw = declared(getCellSpanningParams(data, index, getRowId, column));
        } catch {
            return 1;
        }
    } else {
        raw = declared;
    }
    if (!Number.isFinite(raw)) return 1;
    const span: number = Math.floor(raw);
    if (span <= 1) return 1;
    const remaining: number = columnCount - columnIndex;
    if (remaining <= 1) return 1;
    return Math.min(span, remaining);
}

/**
 * Resolves the per-row span layout for a pin group of visible leaves.
 *
 * Walks the leaves left to right: span origins keep their (possibly
 * resolver-computed) width and mark the following `span - 1` leaves as
 * covered; covered leaves contribute zero width so adapters can skip them
 * without overlap. Pixel geometry is aggregated from the pre-computed
 * `offsets` items (`offset`/`size` per leaf), so a span origin's width is
 * the exact sum of its covered columns and its `left` matches the starting
 * column.
 *
 * Static-heavy rows short-circuit: when no visible leaf declares `colSpan`,
 * the layout is the identity mapping (no resolver runs).
 *
 * @param data - Raw row data object.
 * @param index - Zero-based row index in the processed dataset.
 * @param getRowId - Stable id resolver.
 * @param columns - Visible leaves of one pin group (scrollable or pinned).
 * @param offsets - Pre-computed `VirtualItem` geometry for `columns`.
 * @returns Per-row span layout for the group.
 * @api
 */
export function getRowSpans<T>(
    data: T,
    index: number,
    getRowId: (row: T, index: number) => RowId,
    columns: ColumnLeafDef<T>[],
    offsets: { offset: number; size: number }[],
): RowSpanLayout {
    const count: number = columns.length;
    const spans: CellSpan[] = new Array<CellSpan>(count);
    const widths: number[] = new Array<number>(count);
    const layoutOffsets: number[] = new Array<number>(count);

    let hasSpan: boolean = false;
    for (let i: number = 0; i < count; i += 1) {
        if (columns[i].colSpan !== undefined) {
            hasSpan = true;
            break;
        }
    }
    if (!hasSpan) {
        for (let i: number = 0; i < count; i += 1) {
            spans[i] = { span: 1, covered: false };
            widths[i] = offsets[i]?.size ?? 0;
            layoutOffsets[i] = offsets[i]?.offset ?? 0;
        }
        return { spans, widths, offsets: layoutOffsets };
    }

    let i: number = 0;
    while (i < count) {
        const span: number = resolveColSpan(data, index, getRowId, columns[i], i, count);
        if (span <= 1) {
            spans[i] = { span: 1, covered: false };
            widths[i] = offsets[i]?.size ?? 0;
            layoutOffsets[i] = offsets[i]?.offset ?? 0;
            i += 1;
            continue;
        }
        const originOffset: number = offsets[i]?.offset ?? 0;
        const end: number = Math.min(count, i + span);
        let total: number = 0;
        for (let k: number = i; k < end; k += 1) total += offsets[k]?.size ?? 0;
        spans[i] = { span: end - i, covered: false };
        widths[i] = total;
        layoutOffsets[i] = originOffset;
        for (let k: number = i + 1; k < end; k += 1) {
            spans[k] = { span: 1, covered: true };
            widths[k] = 0;
            layoutOffsets[k] = originOffset;
        }
        i = end;
    }
    return { spans, widths, offsets: layoutOffsets };
}