import type { ColumnGroupDef, ColumnGroupViewport, ViewportData } from "@omnigrid/core";

/** A virtual leaf column in table space (any horizontal partition). */
export type VirtualColumn<T> = ViewportData<T>["columns"][number];

/**
 * One group header cell ("segment") inside a single horizontal pane.
 *
 * Coordinates are pane-local: `left` is the group's absolute table offset
 * minus the pane's `originX` (same convention as the leaf header cells).
 */
export interface GroupHeaderSegment<T> {
    group: ColumnGroupDef<T>;
    left: number;
    width: number;
    /** Number of leaf columns covered by this segment (for `aria-colspan`). */
    columnCount: number;
}

/**
 * Computes the group cells for ONE header row (one depth level) of ONE
 * horizontal pane (`columns` are the pane's virtual leaf columns).
 *
 * Groups address the flat visible leaf order via `startIndex` / `endIndex`
 * (`ColumnGroupViewport`), and the pane's columns expose the same index
 * space (`item.index`), so only the overlapping part of a group is rendered
 * in each pane.
 *
 * A group is emitted as a SINGLE cell only while its leaves are consecutive
 * in the pane itself. If the group crosses a pane boundary (e.g. a child is
 * pinned left while the rest scrolls), or its leaves are interleaved with
 * columns of another pane, the cell is split into adjacent segments — the
 * same visual behavior as AG Grid's per-strip group headers.
 */
export function computeGroupSegments<T>(
    columnGroups: ColumnGroupViewport<T>[],
    columns: VirtualColumn<T>[],
    depth: number,
    originX: number,
): GroupHeaderSegment<T>[] {
    const segments: GroupHeaderSegment<T>[] = [];

    for (const groupView of columnGroups) {
        if (groupView.depth !== depth) continue;

        let start: number | null = null;
        let end = 0;
        let columnCount = 0;
        let prevIndex: number | null = null;

        const flush = (): void => {
            if (start === null) return;
            segments.push({ group: groupView.group, left: start - originX, width: end - start, columnCount });
        };

        for (const item of columns) {
            const inside = item.index >= groupView.startIndex && item.index < groupView.endIndex;
            if (inside) {
                if (start === null) {
                    start = item.offset;
                    end = item.offset + item.width;
                    columnCount = 1;
                } else if (prevIndex === item.index - 1) {
                    // Consecutive leaf in this pane → extend the current cell.
                    end = item.offset + item.width;
                    columnCount += 1;
                } else {
                    // Leaves are consecutive in the group but NOT in this pane
                    // (a child lives in another pane in between) → split cell.
                    flush();
                    start = item.offset;
                    end = item.offset + item.width;
                    columnCount = 1;
                }
                prevIndex = item.index;
            } else if (start !== null) {
                flush();
                start = null;
                end = 0;
                columnCount = 0;
                prevIndex = null;
            }
        }

        flush();
    }

    return segments;
}