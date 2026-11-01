import type { GroupRowRenderer, TreeRowNode } from "@omnigrid/core";

declare module "@omnigrid/core" {
    interface PluginStateExtensions<T> {
        /** Fields the rows are currently grouped by (empty = no grouping). */
        groupBy?: string[];
        /** Expanded state of groups, keyed by group id. */
        expandedGroups?: Record<string, boolean>;
        /** Group column render mode: `'single'` (one Group column) or `'perLevel'` (one column per group level). */
        groupColumnMode?: "single" | "perLevel";
        /** Header text for the Group column in `'single'` mode. */
        groupColumnHeader?: string;
        /** Whether group rows display the number of child rows. */
        showChildCount?: boolean;
        /** Custom renderer for group rows. */
        groupRowRenderer?: GroupRowRenderer<T>;
    }

    interface PluginApiExtensions<T> {
        /** Sets the grouping fields (nesting order) and resets expanded state. */
        setGroupBy: (fields: string[] | null | undefined, expandedGroups?: Record<string, boolean>) => void;
        /** Toggles the expanded state of a single group by its stable id. */
        toggleGroup: (groupId: string) => void;
        /** Expands every group. */
        expandAll: () => void;
        /** Collapses every group. */
        collapseAll: () => void;
        /** Replaces the expanded-state map for groups. */
        setExpandedGroups: (expandedGroups: Record<string, boolean>) => void;
        /** Configures the group column UI mode and header. */
        setGroupColumnConfig: (config: { mode: "single" | "perLevel"; header?: string; showChildCount?: boolean; groupRowRenderer?: any }) => void;
        /** Returns the flattened TreeRowNode[] consumed by the virtualizer. */
        getGroupedRows: () => TreeRowNode<T>[];
    }
}

/** Initial grouping configuration for {@link GroupingPlugin}. */
export interface GroupingPluginOptions<T> {
    /** Grouping fields in nesting order (e.g. `["region", "department"]`). @default [] */
    groupBy?: string[];
    /** Initial expanded state keyed by stable group id. @default all groups expanded */
    expandedGroups?: Record<string, boolean>;
    /**
     * Group column render mode. `'single'` renders one Group column that shows the
     * group hierarchy with expand/collapse chevrons. `'perLevel'` renders one column
     * per group level, each showing that level's groups with chevrons. @default 'single'
     */
    groupColumnMode?: 'single' | 'perLevel';
    /** Header text for the Group column in `'single'` mode. @default 'Group' */
    groupColumnHeader?: string;
    /**
     * Whether group cells render the group key value and children count.
     * When `false`, group cells show only the expand/collapse chevron and
     * indentation — useful when the column already displays the value via
     * another mechanism or when space is at a premium. Applies to both
     * `'single'` and `'perLevel'` modes. @default true
     */
    showGroupValues?: boolean;
}

/** Column UI configuration managed by the grouping plugin. */
export interface GroupingColumnConfig {
    mode: 'single' | 'perLevel';
    header: string;
    showGroupValues: boolean;
    showChildCount: boolean;
    groupRowRenderer?: (params: any) => unknown;
}

/** Row shape used in grouping examples and tests. */
export interface GroupingRow {
    id: number;
    region: string;
    department: string;
    sales: number;
}
