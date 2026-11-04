import type { DataRowNode, PooledRow, RowRenderParams } from "@omnigrid/core";

type RowRenderInput<T> = Pick<PooledRow<T>, "type" | "rowId" | "index" | "data">;

function isDataRowNode<T>(row: unknown): row is DataRowNode<T> {
    if (typeof row !== "object" || row === null || !("type" in row) || row.type !== "leaf" || !("data" in row) || !("level" in row) || !("parent" in row)) {
        return false;
    }
    const parent: unknown = row.parent;
    return (
        typeof row.level === "number" &&
        typeof parent === "object" &&
        parent !== null &&
        "type" in parent &&
        parent.type === "group"
    );
}

/** Converts a pooled row to the public shape used by row callbacks and events. */
export function getRowRenderParams<T>(row: RowRenderInput<T>): RowRenderParams<T> {
    if (row.type === "group") {
        return { id: row.rowId, index: row.index, rowType: "group", isCollapsedGroup: false };
    }
    const node: DataRowNode<T> | undefined = isDataRowNode<T>(row.data) ? row.data : undefined;
    return {
        id: row.rowId,
        index: row.index,
        rowType: "leaf",
        data: node ? node.data : row.data,
        isCollapsedGroup: node?.collapsedGroup !== undefined,
        parentGroup: node?.parentGroup,
    };
}
