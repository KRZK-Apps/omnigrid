import type { ColumnDef, ColumnDropPosition, GridApi, GridPlugin } from "@omnigrid/core";
import { flattenColumns, isColumnGroup } from "@omnigrid/core";

/** Configuration for the column-reordering plugin. @api */
export interface ColumnReorderPluginOptions<T> {
    /** Called with the updated column definitions after a successful reorder. @api */
    onChange?: (columns: ColumnDef<T>[]) => void;
}

interface RemovedColumn<T> {
    columns: ColumnDef<T>[];
    column?: ColumnDef<T>;
}

interface InsertedColumn<T> {
    columns: ColumnDef<T>[];
    inserted: boolean;
}

function removeColumn<T>(columns: ColumnDef<T>[], columnId: string): RemovedColumn<T> {
    const updatedColumns: ColumnDef<T>[] = [];
    let removedColumn: ColumnDef<T> | undefined;

    for (const column of columns) {
        if (column.id === columnId) {
            removedColumn = column;
        } else if (isColumnGroup(column)) {
            const nested: RemovedColumn<T> = removeColumn(column.children, columnId);
            if (nested.column) {
                removedColumn = nested.column;
                if (nested.columns.length > 0) {
                    updatedColumns.push({ ...column, children: nested.columns });
                }
            } else {
                updatedColumns.push(column);
            }
        } else {
            updatedColumns.push(column);
        }
    }

    return { columns: updatedColumns, column: removedColumn };
}

function insertRelative<T>(
    columns: ColumnDef<T>[],
    targetColumnId: string,
    movingColumn: ColumnDef<T>,
    position: ColumnDropPosition,
): InsertedColumn<T> {
    const updatedColumns: ColumnDef<T>[] = [];

    for (let index: number = 0; index < columns.length; index += 1) {
        const column: ColumnDef<T> = columns[index];
        if (column.id === targetColumnId) {
            if (position === "before") updatedColumns.push(movingColumn);
            updatedColumns.push(column);
            if (position === "after") updatedColumns.push(movingColumn);
            updatedColumns.push(...columns.slice(index + 1));
            return { columns: updatedColumns, inserted: true };
        } else if (isColumnGroup(column)) {
            const nested: InsertedColumn<T> = insertRelative(column.children, targetColumnId, movingColumn, position);
            if (nested.inserted) {
                updatedColumns.push({ ...column, children: nested.columns }, ...columns.slice(index + 1));
                return { columns: updatedColumns, inserted: true };
            }
            updatedColumns.push(column);
        } else {
            updatedColumns.push(column);
        }
    }

    return { columns: updatedColumns, inserted: false };
}

function findColumn<T>(columns: ColumnDef<T>[], columnId: string): ColumnDef<T> | undefined {
    for (const column of columns) {
        if (column.id === columnId) return column;
        if (isColumnGroup(column)) {
            const nestedColumn: ColumnDef<T> | undefined = findColumn(column.children, columnId);
            if (nestedColumn) return nestedColumn;
        }
    }

    return undefined;
}

function getTrailingGroupId<T>(
    columns: ColumnDef<T>[],
    targetColumnId: string,
    position: ColumnDropPosition,
): string | undefined {
    if (position !== "after" || flattenColumns(columns).at(-1)?.id !== targetColumnId) return undefined;

    const lastColumn: ColumnDef<T> | undefined = columns.at(-1);
    return lastColumn && isColumnGroup(lastColumn) ? lastColumn.id : undefined;
}

function hasSameOrder<T>(left: ColumnDef<T>[], right: ColumnDef<T>[]): boolean {
    if (left.length !== right.length) return false;

    for (let index: number = 0; index < left.length; index += 1) {
        const leftColumn: ColumnDef<T> = left[index];
        const rightColumn: ColumnDef<T> = right[index];
        if (leftColumn.id !== rightColumn.id || isColumnGroup(leftColumn) !== isColumnGroup(rightColumn)) return false;
        if (isColumnGroup(leftColumn) && isColumnGroup(rightColumn) && !hasSameOrder(leftColumn.children, rightColumn.children)) {
            return false;
        }
    }

    return true;
}

function getLockedStartColumnIds<T>(columns: ColumnDef<T>[]): string[] {
    const lockedIds: string[] = [];
    const visit = (nodes: ColumnDef<T>[], inheritedLock: boolean = false): void => {
        for (const column of nodes) {
            const locked: boolean = inheritedLock || column.lockPosition === "start";
            if (isColumnGroup(column)) {
                visit(column.children, locked);
            } else if (locked) {
                lockedIds.push(column.id);
            }
        }
    };

    visit(columns);
    return lockedIds;
}

function preservesLockedStartColumns<T>(columns: ColumnDef<T>[], updatedColumns: ColumnDef<T>[]): boolean {
    const lockedIds: string[] = getLockedStartColumnIds(columns);
    if (lockedIds.length === 0) return true;

    const updatedLeafIds: string[] = flattenColumns(updatedColumns).map((column) => column.id);
    return lockedIds.every((id, index) => updatedLeafIds[index] === id);
}

/**
 * Adds drag-and-drop reordering for leaf columns and groups with `movable: true`.
 *
 * @api
 */
export class ColumnReorderPlugin<T> implements GridPlugin<T> {
    /** @api */
    public readonly name = "@omnigrid/column-reorder-plugin";
    private api?: GridApi<T>;
    private readonly onChange?: (columns: ColumnDef<T>[]) => void;

    /**
     * Creates a column-reordering plugin.
     *
     * @param options - Optional callback for persisting successful column reorders.
     * @api
     */
    public constructor(options: ColumnReorderPluginOptions<T> = {}) {
        this.onChange = options.onChange;
    }

    /**
     * Subscribes to column-drop events and reorders the column definitions.
     *
     * @param api - Grid API used by this plugin.
     * @returns Cleanup callback that unregisters the drop handler.
     * @api
     */
    public register(api: GridApi<T>): () => void {
        this.api = api;
        const unsubscribe: () => void = api.on("columnDrop", ({ sourceColumnId, targetColumnId, position }) => {
            this.moveColumn(sourceColumnId, targetColumnId, position);
        });

        return () => {
            unsubscribe();
            if (this.api === api) this.api = undefined;
        };
    }

    /**
     * Moves a movable column or group before or after a target column or group.
     * Columns can move between groups but cannot cross pinned-column regions.
     * Dropping after the final leaf in the final group places the column after that group.
     *
     * @param sourceColumnId - ID of the column being moved.
     * @param targetColumnId - ID of the column that determines the new position.
     * @param position - Whether to place the moved column before or after the target.
     * @returns Whether the column order changed.
     * @api
     */
    public moveColumn(sourceColumnId: string, targetColumnId: string, position: ColumnDropPosition): boolean {
        if (!this.api || sourceColumnId === targetColumnId) return false;

        const columns: ColumnDef<T>[] = this.api.getState().columns;
        const sourceColumn: ColumnDef<T> | undefined = findColumn(columns, sourceColumnId);
        const targetColumn: ColumnDef<T> | undefined = findColumn(columns, targetColumnId);
        if (!sourceColumn || !targetColumn || sourceColumn.movable !== true) return false;
        if (!isColumnGroup(sourceColumn) && !isColumnGroup(targetColumn) && sourceColumn.pinned !== targetColumn.pinned) {
            return false;
        }

        const trailingGroupId: string | undefined = getTrailingGroupId(columns, targetColumnId, position);
        const insertionTargetId: string = trailingGroupId ?? targetColumnId;

        const removed: RemovedColumn<T> = removeColumn(columns, sourceColumnId);
        if (!removed.column) return false;

        const inserted: InsertedColumn<T> = insertRelative(removed.columns, insertionTargetId, removed.column, position);
        if (
            !inserted.inserted ||
            hasSameOrder(columns, inserted.columns) ||
            !preservesLockedStartColumns(columns, inserted.columns)
        ) {
            return false;
        }

        this.api.setColumns(inserted.columns);
        this.onChange?.(inserted.columns);
        return true;
    }
}
