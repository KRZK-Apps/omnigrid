import type {
    CellRenderParams,
    ColumnGroupDef,
    ColumnLeafDef,
    ColumnStyle,
    ColumnStyleParams,
    HeaderGroupRenderParams,
    HeaderRenderParams,
    HeaderStyle,
    RowStyle,
} from "@omnigrid/core";

/**
 * Pre-resolved presentation (classes and inline styles) for a column data body.
 * Evaluated once per column across the dataset, then applied to each rendered cell in O(1).
 *
 * @api
 */
export interface ResolvedColumnPresentation {
    /** Space-separated CSS class names for the column body. */
    classes: string;
    /** Combined inline styles for the column body. */
    style: ColumnStyle;
}

/**
 * Resolves column-level presentation once for the entire column across the entire dataset.
 *
 * Evaluates `getColumnStyle`, `getColumnClass`, and `columnClassRules`.
 *
 * @param column - Leaf column definition.
 * @param params - Contextual column presentation parameters with full column values.
 * @returns Pre-resolved classes and styles for the column.
 * @api
 */
export function resolveColumnPresentation<T>(
    column: ColumnLeafDef<T>,
    params: ColumnStyleParams<T>,
): ResolvedColumnPresentation {
    const dynamicColumnClass: string | undefined = column.getColumnClass?.(params);
    const ruleClasses: string[] = Object.entries(column.columnClassRules ?? {})
        .filter(([, predicate]: [string, (p: ColumnStyleParams<T>) => boolean]) => predicate(params))
        .map(([ruleClass]: [string, (p: ColumnStyleParams<T>) => boolean]) => ruleClass);

    const classes: string = [...ruleClasses, dynamicColumnClass].filter(Boolean).join(" ");

    const style: ColumnStyle = {
        ...(column.getColumnStyle?.(params) ?? {}),
    };

    return { classes, style };
}

/**
 * Resolves the combined CSS classes for a leaf cell by combining the precomputed
 * column classes with per-cell class definitions.
 *
 * Precedence / concatenation order:
 * 1. Precomputed column classes (`getColumnClass`, `columnClassRules`)
 * 2. `cellClass` (static or function)
 * 3. `cellClassRules`
 * 4. `getCellClass`
 *
 * @param column - Leaf column definition.
 * @param params - Contextual cell render parameters.
 * @param precomputedColumnClasses - Pre-resolved column classes (optional).
 * @returns Space-separated list of CSS class names.
 * @api
 */
export function resolveCellClasses<T>(
    column: ColumnLeafDef<T>,
    params: CellRenderParams<T>,
    precomputedColumnClasses?: string,
): string {
    const columnClasses: string | undefined = precomputedColumnClasses;

    const cellClass: string | undefined = typeof column.cellClass === "function" ? column.cellClass(params) : column.cellClass;
    const dynamicCellClass: string | undefined = column.getCellClass?.(params);
    const cellRuleClasses: string[] = Object.entries(column.cellClassRules ?? {})
        .filter(([, predicate]: [string, (p: CellRenderParams<T>) => boolean]) => predicate(params))
        .map(([ruleClass]: [string, (p: CellRenderParams<T>) => boolean]) => ruleClass);

    return [columnClasses, cellClass, ...cellRuleClasses, dynamicCellClass]
        .filter(Boolean)
        .join(" ");
}

/**
 * Resolves the inline styles for a leaf cell by cascading precomputed column styles
 * and cell-level style definitions. Cell-level styles take precedence over column styles.
 *
 * Merge order:
 * 1. Precomputed column style (`getColumnStyle`)
 * 2. `cellStyle`
 * 3. `getCellStyle`
 *
 * @param column - Leaf column definition.
 * @param params - Contextual cell render parameters.
 * @param precomputedColumnStyle - Pre-resolved column style (optional).
 * @returns Combined inline style object.
 * @api
 */
export function resolveCellStyle<T>(
    column: ColumnLeafDef<T>,
    params: CellRenderParams<T>,
    precomputedColumnStyle?: ColumnStyle,
): RowStyle {
    const baseColumnStyle: ColumnStyle | undefined = precomputedColumnStyle;
    return {
        ...(baseColumnStyle ?? {}),
        ...(column.cellStyle ?? {}),
        ...(column.getCellStyle?.(params) ?? {}),
    };
}

/**
 * Resolves the CSS classes for a leaf column header cell.
 *
 * @param column - Leaf column definition.
 * @param params - Contextual header render parameters.
 * @param fullHeight - Whether the header cell spans multiple group rows.
 * @returns Space-separated list of CSS class names.
 * @api
 */
export function resolveHeaderClasses<T>(
    column: ColumnLeafDef<T>,
    params: HeaderRenderParams<T>,
    fullHeight: boolean = false,
): string {
    const headerClass: string | undefined = typeof column.headerClass === "function" ? column.headerClass(params) : column.headerClass;
    const dynamicHeaderClass: string | undefined = column.getHeaderClass?.(params);
    const ruleClasses: string[] = Object.entries(column.headerClassRules ?? {})
        .filter(([, predicate]: [string, (p: HeaderRenderParams<T>) => boolean]) => predicate(params))
        .map(([ruleClass]: [string, (p: HeaderRenderParams<T>) => boolean]) => ruleClass);

    return [
        "omnigrid-header-cell",
        fullHeight ? "omnigrid-header-cell-full-height" : undefined,
        headerClass,
        ...ruleClasses,
        dynamicHeaderClass,
    ]
        .filter(Boolean)
        .join(" ");
}

/**
 * Resolves the inline styles for a leaf column header cell.
 *
 * @param column - Leaf column definition.
 * @param params - Contextual header render parameters.
 * @returns Combined header style object.
 * @api
 */
export function resolveHeaderStyle<T>(column: ColumnLeafDef<T>, params: HeaderRenderParams<T>): HeaderStyle {
    return {
        ...(column.headerStyle ?? {}),
        ...(column.getHeaderStyle?.(params) ?? {}),
    };
}

/**
 * Resolves the CSS classes for a column group header cell.
 *
 * @param group - Column group definition.
 * @param params - Contextual group header render parameters.
 * @returns Space-separated list of CSS class names.
 * @api
 */
export function resolveGroupHeaderClasses<T>(
    group: ColumnGroupDef<T>,
    params: HeaderGroupRenderParams<T>,
): string {
    const groupClass: string | undefined = typeof group.headerClass === "function" ? group.headerClass(params) : group.headerClass;
    const dynamicGroupClass: string | undefined = group.getHeaderClass?.(params);
    const ruleClasses: string[] = Object.entries(group.headerClassRules ?? {})
        .filter(([, predicate]: [string, (p: HeaderGroupRenderParams<T>) => boolean]) => predicate(params))
        .map(([ruleClass]: [string, (p: HeaderGroupRenderParams<T>) => boolean]) => ruleClass);

    return [
        "omnigrid-header-cell",
        "omnigrid-header-group-cell",
        groupClass,
        ...ruleClasses,
        dynamicGroupClass,
    ]
        .filter(Boolean)
        .join(" ");
}

/**
 * Resolves the inline styles for a column group header cell.
 *
 * @param group - Column group definition.
 * @param params - Contextual group header render parameters.
 * @returns Combined group header style object.
 * @api
 */
export function resolveGroupHeaderStyle<T>(
    group: ColumnGroupDef<T>,
    params: HeaderGroupRenderParams<T>,
): HeaderStyle {
    return {
        ...(group.headerStyle ?? {}),
        ...(group.getHeaderStyle?.(params) ?? {}),
    };
}
