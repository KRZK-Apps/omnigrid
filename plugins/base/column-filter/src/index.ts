import type {
    ColumnDataType,
    ColumnFilterType,
    ColumnLeafDef,
    FilterCondition,
    FilterOperator,
    GridApi,
    GridPlugin,
    UIControlDescriptor,
    UIMultiSelectOption,
    UIPopupAnchor,
    UIPopupDescriptor,
    UISelectOption,
} from "@omnigrid/core";
import { flattenColumns } from "@omnigrid/core";
import { inferColumnDataType, resolveFilterType } from "./inference";
import { ALL_OPERATOR_LABELS, DATE_OPERATORS, NUMBER_OPERATORS, TEXT_OPERATORS } from "./operators";

export { inferColumnDataType, resolveFilterType } from "./inference";
export { ALL_OPERATOR_LABELS, DATE_OPERATORS, NUMBER_OPERATORS, TEXT_OPERATORS } from "./operators";

const POPUP_PREFIX: string = "omnigrid-filter:";

function isValueless(operator: FilterOperator): boolean {
    return operator === "blank" || operator === "notBlank" || operator === "isEmpty" || operator === "isNotEmpty";
}

function toText(value: unknown): string {
    return value === undefined || value === null ? "" : String(value);
}

/** Configuration for the filtering plugin. */
export interface ColumnFilterPluginOptions {
    /** Debounce applied by the adapter to text inputs before the filter is applied. @default 250 */
    debounceMs?: number;
}

/** Adds a declarative column filter popup on top of the core filter engine. */
export class ColumnFilterPlugin<T> implements GridPlugin<T> {
    public readonly name = "@omnigrid/column-filter-plugin";
    private api?: GridApi<T>;
    private anchor?: UIPopupAnchor;
    /** Operator chosen in the popup before any value was typed (no condition exists yet). */
    private draftOperator?: FilterOperator;
    /** Last multi-select choice per column, kept while the filter is null ("all" or "none" selected). */
    private multiSelectDraft: Map<string, string[]> = new Map();
    /** Set to true when Enter was pressed in a text input; `apply` closes the popup instead of reopening it. */
    private closeAfterApply = false;
    private readonly debounceMs?: number;

    public constructor(options: ColumnFilterPluginOptions = {}) {
        this.debounceMs = options.debounceMs;
    }

    public register(api: GridApi<T>): () => void {
        this.api = api;
        const unregisterMenu: () => void = api.registerFilterMenu();
        const unsubscribe: () => void = api.on("filterMenuRequest", ({ columnId, anchor }) => {
            if (api.getPopup()?.id === `${POPUP_PREFIX}${columnId}`) {
                api.closePopup();
                return;
            }
            this.openColumnFilter(columnId, anchor);
        });
        return () => {
            unsubscribe();
            unregisterMenu();
            if (api.getPopup()?.id.startsWith(POPUP_PREFIX)) api.closePopup();
            this.api = undefined;
        };
    }

    /**
     * Opens the filter popup for a column; calling it again updates the popup in place.
     * Columns with `filterable: false` are ignored.
     * @param columnId - Column id (or field) to filter.
     * @param anchor - Viewport-relative rectangle the popup attaches to.
     * @api
     */
    public openColumnFilter(columnId: string, anchor?: UIPopupAnchor): void {
        if (!this.api) return;
        const column = flattenColumns(this.api.getState().columns).find((item) => item.id === columnId);
        if (column?.filterable === false) return;
        if (anchor) {
            this.anchor = anchor;
            this.draftOperator = undefined;
            this.multiSelectDraft.delete(columnId);
        }
        this.api.openPopup(this.describe(this.api, columnId));
    }

    /**
     * Closes the filter popup, if open.
     * @api
     */
    public closeColumnFilter(): void {
        if (this.api?.getPopup()?.id.startsWith(POPUP_PREFIX)) this.api.closePopup();
    }

    private describe(api: GridApi<T>, columnId: string): UIPopupDescriptor {
        const columns = flattenColumns(api.getState().columns);
        const column = columns.find((item) => item.id === columnId);
        const rawData = api.getState().data;
        const dataType: ColumnDataType = column ? inferColumnDataType(column, rawData) : "text";
        const hasOptions: boolean = !!(column?.filterOptions && column.filterOptions.length > 0);
        const filterType: ColumnFilterType = column ? resolveFilterType(column, dataType, hasOptions) : "text";

        if (filterType === "custom") {
            if (!column?.filterTypeId) {
                return this.describeComparableFilter(api, columnId, column, "text", TEXT_OPERATORS, "contains");
            }
            // Custom filters will be registered via plugin options in a future refactor
            return this.describeComparableFilter(api, columnId, column, "text", TEXT_OPERATORS, "contains");
        }

        switch (filterType) {
            case "boolean":
                return this.describeBooleanFilter(api, columnId);
            case "set":
                return this.describeSetFilter(api, columnId, column);
            case "date":
                return this.describeComparableFilter(api, columnId, column, "date", DATE_OPERATORS, "equals");
            case "number":
                return this.describeComparableFilter(api, columnId, column, "number", NUMBER_OPERATORS, "equals");
            case "text":
            default:
                return this.describeComparableFilter(api, columnId, column, "text", TEXT_OPERATORS, "contains");
        }
    }

    private describeComparableFilter(
        api: GridApi<T>,
        columnId: string,
        column: ColumnLeafDef<T> | undefined,
        inputType: "text" | "number" | "date",
        standardOperators: FilterOperator[],
        defaultOperator: FilterOperator,
    ): UIPopupDescriptor {
        const current: FilterCondition | undefined = api.getFilterModel()[columnId]?.conditions[0];
        const allowed = column?.allowedOperators ?? standardOperators;
        const initialOperator = allowed.includes(defaultOperator) ? defaultOperator : allowed[0];
        const operator: FilterOperator = current?.operator ?? this.draftOperator ?? initialOperator;

        const apply = (next: FilterCondition): void => {
            api.setColumnFilter(columnId, next);
            if (this.closeAfterApply) {
                this.closeAfterApply = false;
                api.closePopup();
            } else {
                this.openColumnFilter(columnId);
            }
        };

        const selectOptions: UISelectOption[] = allowed.map((op) => ({
            value: op,
            label: ALL_OPERATOR_LABELS[op] ?? op,
        }));

        const controls: UIControlDescriptor[] = [
            {
                id: "operator",
                type: "select",
                label: "Condition",
                value: operator,
                options: selectOptions,
                onChange: (value: string) => {
                    const next = value as FilterOperator;
                    this.draftOperator = next;
                    if (isValueless(next) || current?.value !== undefined || current?.valueTo !== undefined) {
                        apply({ ...current, operator: next, value: isValueless(next) ? undefined : current?.value });
                    } else {
                        this.openColumnFilter(columnId);
                    }
                },
            },
        ];

        if (!isValueless(operator)) {
            controls.push({
                id: "value",
                type: inputType,
                label: operator === "inRange" ? "From" : "Value",
                value: toText(current?.value),
                debounceMs: this.debounceMs,
                onChange: (value: string) => apply({ ...current, operator, value: value || undefined }),
                onEnter: () => {
                    this.closeAfterApply = true;
                },
            });
            if (operator === "inRange") {
                controls.push({
                    id: "valueTo",
                    type: inputType,
                    label: "To",
                    value: toText(current?.valueTo),
                    debounceMs: this.debounceMs,
                    onChange: (valueTo: string) => apply({ ...current, operator, valueTo: valueTo || undefined }),
                    onEnter: () => {
                        this.closeAfterApply = true;
                    },
                });
            }
        }

        return { id: `${POPUP_PREFIX}${columnId}`, anchor: this.anchor, placement: "bottom-end", controls };
    }

    private describeBooleanFilter(api: GridApi<T>, columnId: string): UIPopupDescriptor {
        const current: FilterCondition | undefined = api.getFilterModel()[columnId]?.conditions[0];
        let selectValue = "all";
        if (current) {
            if (current.value === true) selectValue = "true";
            else if (current.value === false) selectValue = "false";
        }

        const controls: UIControlDescriptor[] = [
            {
                id: "boolean-select",
                type: "select",
                label: "Filter",
                value: selectValue,
                options: [
                    { value: "all", label: "All" },
                    { value: "true", label: "Yes" },
                    { value: "false", label: "No" },
                ],
                onChange: (value: string) => {
                    if (value === "all") {
                        api.setColumnFilter(columnId, null);
                    } else {
                        api.setColumnFilter(columnId, { operator: "equals", value: value === "true" });
                    }
                    this.openColumnFilter(columnId);
                },
            },
        ];

        return { id: `${POPUP_PREFIX}${columnId}`, anchor: this.anchor, placement: "bottom-end", controls };
    }

    private describeSetFilter(
        api: GridApi<T>,
        columnId: string,
        column: ColumnLeafDef<T> | undefined,
    ): UIPopupDescriptor {
        const draft = this.multiSelectDraft.get(columnId);
        const current: FilterCondition | undefined = api.getFilterModel()[columnId]?.conditions[0];
        const selectedValues: unknown[] =
            draft !== undefined
                ? draft
                : current && current.operator === "in" && Array.isArray(current.value)
                  ? current.value
                  : current && current.value !== undefined
                    ? [current.value]
                    : [];

        let items: Array<{ value: string; label: string }> = [];
        if (column?.filterOptions && column.filterOptions.length > 0) {
            items = column.filterOptions.map((opt) => ({
                value: String(opt.value),
                label: opt.label,
            }));
        } else {
            const rawData = api.getState().data;
            const unique = new Set<string>();
            for (const row of rawData) {
                if (!row || !column) continue;
                let val: unknown;
                if (column.valueGetter) val = column.valueGetter(row);
                else if (column.field) val = (row as Record<string, unknown>)[column.field as string];
                if (val !== undefined && val !== null && val !== "") {
                    unique.add(String(val));
                }
            }
            items = Array.from(unique)
                .sort()
                .map((val) => ({ value: val, label: val }));
        }

        const selectedStringSet = new Set(selectedValues.map((v) => String(v)));

        const multiSelectOptions: UIMultiSelectOption[] = items.map((item) => ({
            value: item.value,
            label: item.label,
            checked: selectedStringSet.has(item.value),
        }));

        const controls: UIControlDescriptor[] = [
            {
                id: "multi-select",
                type: "multi-select",
                label: "Select values",
                options: multiSelectOptions,
                onChange: (newSelected: string[]) => {
                    this.multiSelectDraft.set(columnId, newSelected);
                    if (newSelected.length === 0 || newSelected.length === items.length) {
                        api.setColumnFilter(columnId, null);
                    } else {
                        api.setColumnFilter(columnId, { operator: "in", value: newSelected });
                    }
                    this.openColumnFilter(columnId);
                },
            },
        ];

        return { id: `${POPUP_PREFIX}${columnId}`, anchor: this.anchor, placement: "bottom-end", controls };
    }
}

