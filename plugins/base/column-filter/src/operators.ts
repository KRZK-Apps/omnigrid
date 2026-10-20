import type { FilterOperator } from "@omnigrid/core";

export const ALL_OPERATOR_LABELS: Record<FilterOperator, string> = {
    contains: "Contains",
    notContains: "Does not contain",
    equals: "Equals",
    notEqual: "Does not equal",
    startsWith: "Starts with",
    endsWith: "Ends with",
    greaterThan: "Greater than",
    greaterThanOrEqual: "Greater than or equal",
    lessThan: "Less than",
    lessThanOrEqual: "Less than or equal",
    inRange: "In range",
    in: "In list",
    blank: "Is empty",
    notBlank: "Is not empty",
    isEmpty: "Is empty",
    isNotEmpty: "Is not empty",
};

export const TEXT_OPERATORS: FilterOperator[] = [
    "contains",
    "equals",
    "startsWith",
    "endsWith",
    "notContains",
    "isEmpty",
    "isNotEmpty",
];

export const NUMBER_OPERATORS: FilterOperator[] = [
    "equals",
    "notEqual",
    "greaterThan",
    "greaterThanOrEqual",
    "lessThan",
    "lessThanOrEqual",
    "inRange",
    "isEmpty",
    "isNotEmpty",
];

export const DATE_OPERATORS: FilterOperator[] = [
    "equals",
    "notEqual",
    "greaterThan",
    "lessThan",
    "inRange",
    "isEmpty",
    "isNotEmpty",
];
