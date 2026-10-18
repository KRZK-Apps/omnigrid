import { Grid } from "./grid";
import { applyFilterModel } from "./filtering";
import type { ColumnDef } from "./types";
import type { UIPopupDescriptor } from "./ui";

interface Row {
    name: string;
    age: number | null;
}

const columns: ColumnDef<Row>[] = [
    { id: "name", field: "name", width: 100 },
    { id: "age", field: "age", width: 100 },
];

const rows: Row[] = [
    { name: "Alice", age: 30 },
    { name: "Bob", age: 25 },
    { name: "alfred", age: 41 },
    { name: "Carol", age: null },
];

function names(data: Row[]): string[] {
    return data.map((row) => row.name);
}

describe("applyFilterModel", () => {
    it("returns the same reference when no condition is active", () => {
        expect(applyFilterModel(rows, {}, columns)).toBe(rows);
        expect(applyFilterModel(rows, { name: { conditions: [{ operator: "contains", value: "" }] } }, columns)).toBe(rows);
    });

    it("supports text operators case-insensitively", () => {
        expect(names(applyFilterModel(rows, { name: { conditions: [{ operator: "startsWith", value: "AL" }] } }, columns))).toEqual(["Alice", "alfred"]);
        expect(names(applyFilterModel(rows, { name: { conditions: [{ operator: "endsWith", value: "ol" }] } }, columns))).toEqual(["Carol"]);
        expect(names(applyFilterModel(rows, { name: { conditions: [{ operator: "contains", value: "b" }] } }, columns))).toEqual(["Bob"]);
        expect(names(applyFilterModel(rows, { name: { conditions: [{ operator: "equals", value: "bob" }] } }, columns))).toEqual(["Bob"]);
        expect(names(applyFilterModel(rows, { name: { conditions: [{ operator: "equals", value: "bob", caseSensitive: true }] } }, columns))).toEqual([]);
    });

    it("supports numeric operators and inRange", () => {
        expect(names(applyFilterModel(rows, { age: { conditions: [{ operator: "greaterThan", value: "25" }] } }, columns))).toEqual(["Alice", "alfred"]);
        expect(names(applyFilterModel(rows, { age: { conditions: [{ operator: "lessThan", value: 30 }] } }, columns))).toEqual(["Bob"]);
        expect(names(applyFilterModel(rows, { age: { conditions: [{ operator: "inRange", value: 25, valueTo: 30 }] } }, columns))).toEqual(["Alice", "Bob"]);
    });

    it("supports blank / notBlank / in", () => {
        expect(names(applyFilterModel(rows, { age: { conditions: [{ operator: "blank" }] } }, columns))).toEqual(["Carol"]);
        expect(names(applyFilterModel(rows, { age: { conditions: [{ operator: "isEmpty" }] } }, columns))).toEqual(["Carol"]);
        expect(names(applyFilterModel(rows, { age: { conditions: [{ operator: "notBlank" }] } }, columns))).toEqual(["Alice", "Bob", "alfred"]);
        expect(names(applyFilterModel(rows, { age: { conditions: [{ operator: "isNotEmpty" }] } }, columns))).toEqual(["Alice", "Bob", "alfred"]);
        expect(names(applyFilterModel(rows, { name: { conditions: [{ operator: "in", value: ["bob", "carol"] }] } }, columns))).toEqual(["Bob", "Carol"]);
    });

    it("combines multiple conditions with and/or and columns with and", () => {
        const or = { name: { logic: "or" as const, conditions: [{ operator: "equals" as const, value: "Bob" }, { operator: "equals" as const, value: "Alice" }] } };
        expect(names(applyFilterModel(rows, or, columns))).toEqual(["Alice", "Bob"]);
        const both = { ...or, age: { conditions: [{ operator: "greaterThan" as const, value: 26 }] } };
        expect(names(applyFilterModel(rows, both, columns))).toEqual(["Alice"]);
    });
});

describe("Grid filtering", () => {
    it("filters before processors and caches until the model or data change", () => {
        const grid = new Grid<Row>({ columns, data: rows });
        const order: string[] = [];
        grid.registerDataProcessor((data) => {
            order.push(names(data).join(","));
            return data;
        });

        grid.setColumnFilter("name", { operator: "startsWith", value: "a" });
        expect(names(grid.getProcessedData())).toEqual(["Alice", "alfred"]);
        expect(order[order.length - 1]).toBe("Alice,alfred");

        const first = grid.getProcessedData();
        expect(grid.getProcessedData()).toBe(first);

        grid.setData([...rows, { name: "Anna", age: 1 }]);
        expect(names(grid.getProcessedData())).toEqual(["Alice", "alfred", "Anna"]);
    });

    it("exposes get/set/clear and emits filterChanged", () => {
        const grid = new Grid<Row>({ columns, data: rows });
        const listener = vi.fn();
        grid.on("filterChanged", listener);

        grid.setFilterModel({ age: { conditions: [{ operator: "greaterThan", value: 26 }] } });
        expect(grid.getFilterModel()).toEqual({ age: { conditions: [{ operator: "greaterThan", value: 26 }] } });
        expect(grid.getFilterModel()).not.toBe(grid.getFilterModel());

        grid.setColumnFilter("age", null);
        expect(grid.getFilterModel()).toEqual({});
        grid.setColumnFilter("name", { operator: "contains", value: "a" });
        grid.clearFilters();
        expect(grid.getFilterModel()).toEqual({});
        expect(grid.getProcessedData()).toHaveLength(4);
        expect(listener).toHaveBeenCalledTimes(4);
        grid.clearFilters();
        expect(listener).toHaveBeenCalledTimes(4);
    });

    it("shows noMatchingRows when everything is filtered out and hides it afterwards", () => {
        const grid = new Grid<Row>({ columns, data: rows });
        grid.setColumnFilter("name", { operator: "equals", value: "nobody" });
        expect(grid.getOverlayState().type).toBe("noMatchingRows");
        grid.clearFilters();
        expect(grid.getOverlayState().type).toBeNull();
    });

    it("accepts an initial filterModel", () => {
        const grid = new Grid<Row>({ columns, data: rows, filterModel: { name: { conditions: [{ operator: "equals", value: "Bob" }] } } });
        expect(names(grid.getProcessedData())).toEqual(["Bob"]);
    });
});

describe("Grid popups", () => {
    it("opens, updates, closes and notifies", () => {
        const grid = new Grid<Row>({ columns, data: rows });
        const events: Array<UIPopupDescriptor | null> = [];
        grid.on("popupChange", (popup) => events.push(popup));
        const onClose = vi.fn();
        const popup: UIPopupDescriptor = { id: "p", controls: [{ id: "b", type: "button", text: "Go", onClick: () => undefined }], onClose };

        grid.openPopup(popup);
        expect(grid.getPopup()).toBe(popup);
        grid.closePopup();
        expect(grid.getPopup()).toBeNull();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(events).toEqual([popup, null]);
        grid.closePopup();
        expect(events).toHaveLength(2);
    });
});
