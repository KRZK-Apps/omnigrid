import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Grid } from "@omnigrid/core";
import type { ColumnDef, SlotMount, SlotRenderContext, UIInputControl } from "@omnigrid/core";
import { QuickFilterPlugin } from "./index";

interface Person {
    id: number;
    firstName: string;
    lastName: string;
    role: string;
    department: string;
}

const testColumns: ColumnDef<Person>[] = [
    { id: "id", field: "id", header: "ID", width: 50 },
    { id: "firstName", field: "firstName", header: "First Name", width: 100 },
    { id: "lastName", field: "lastName", header: "Last Name", width: 100 },
    {
        id: "fullName",
        header: "Full Name",
        width: 150,
        valueGetter: (row: Person): string => `${row.firstName} ${row.lastName}`,
    },
    { id: "role", field: "role", header: "Role", width: 100 },
    { id: "department", field: "department", header: "Department", width: 100, searchable: false },
];

const testData: Person[] = [
    { id: 1, firstName: "Alice", lastName: "Smith", role: "Engineer", department: "R&D" },
    { id: 2, firstName: "Bob", lastName: "Jones", role: "Designer", department: "UX" },
    { id: 3, firstName: "Charlie", lastName: "Brown", role: "Product Manager", department: "R&D" },
    { id: 4, firstName: "Diana", lastName: "Prince", role: "DevOps", department: "Infrastructure" },
];

describe("QuickFilterPlugin", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("mounts a text field into the top outer slot by default", () => {
        const plugin = new QuickFilterPlugin<Person>();
        const grid = new Grid<Person>({ columns: testColumns, data: testData, plugins: [plugin] });

        const mounts: SlotMount<Person>[] = grid.getSlotMounts("top");
        expect(mounts).toHaveLength(1);
        expect(mounts[0].id).toBe("omnigrid-quick-filter");

        const context: SlotRenderContext<Person> = { api: grid, state: grid.getState(), slot: "top" };
        const descriptor = (typeof mounts[0].content === "function" ? mounts[0].content(context) : mounts[0].content) as UIInputControl;

        expect(descriptor.id).toBe("omnigrid-quick-filter-input");
        expect(descriptor.type).toBe("text");
        expect(descriptor.debounceMs).toBe(150);
        expect(descriptor.value).toBe("");
    });

    it("mounts to the bottom/down slot when configured", () => {
        const bottomPlugin = new QuickFilterPlugin<Person>({ slot: "bottom" });
        const grid1 = new Grid<Person>({ columns: testColumns, data: testData, plugins: [bottomPlugin] });
        expect(grid1.getSlotMounts("bottom")).toHaveLength(1);

        const downPlugin = new QuickFilterPlugin<Person>({ slot: "down" });
        const grid2 = new Grid<Person>({ columns: testColumns, data: testData, plugins: [downPlugin] });
        expect(grid2.getSlotMounts("down")).toHaveLength(1);
        expect(grid2.getSlotMounts("bottom")).toHaveLength(1);
    });

    it("performs debounced input processing with configurable debounceMs", () => {
        const plugin = new QuickFilterPlugin<Person>({ debounceMs: 200 });
        const grid = new Grid<Person>({ columns: testColumns, data: testData, plugins: [plugin] });

        plugin.setQueryDebounced("alice");
        expect(grid.getQuickFilter()).toBe("");
        expect(grid.getProcessedData()).toHaveLength(4);

        vi.advanceTimersByTime(100);
        expect(grid.getQuickFilter()).toBe("");

        vi.advanceTimersByTime(105);
        expect(grid.getQuickFilter()).toBe("alice");
        expect(grid.getProcessedData()).toHaveLength(1);
        expect(grid.getProcessedData()[0].firstName).toBe("Alice");
    });

    it("parses multi-term search queries separated by commas", () => {
        const plugin = new QuickFilterPlugin<Person>();
        const grid = new Grid<Person>({ columns: testColumns, data: testData, plugins: [plugin] });

        plugin.setQuery("alice, jones");
        expect(grid.getProcessedData().map((p: Person) => p.firstName)).toEqual(["Alice", "Bob"]);

        plugin.setQuery("DevOps, brown");
        expect(grid.getProcessedData().map((p: Person) => p.firstName)).toEqual(["Charlie", "Diana"]);
    });

    it("matches case-insensitively", () => {
        const plugin = new QuickFilterPlugin<Person>();
        const grid = new Grid<Person>({ columns: testColumns, data: testData, plugins: [plugin] });

        plugin.setQuery("ALICE");
        expect(grid.getProcessedData()).toHaveLength(1);
        expect(grid.getProcessedData()[0].firstName).toBe("Alice");

        plugin.setQuery("smITH");
        expect(grid.getProcessedData()).toHaveLength(1);
        expect(grid.getProcessedData()[0].lastName).toBe("Smith");
    });

    it("completely ignores columns where searchable is false", () => {
        const plugin = new QuickFilterPlugin<Person>();
        const grid = new Grid<Person>({ columns: testColumns, data: testData, plugins: [plugin] });

        // department is "R&D" for Alice and Charlie, but department has searchable: false
        plugin.setQuery("R&D");
        expect(grid.getProcessedData()).toHaveLength(0);

        // Infrastructure is department for Diana, searchable: false
        plugin.setQuery("Infrastructure");
        expect(grid.getProcessedData()).toHaveLength(0);
    });

    it("utilizes column valueGetter if present", () => {
        const plugin = new QuickFilterPlugin<Person>();
        const grid = new Grid<Person>({ columns: testColumns, data: testData, plugins: [plugin] });

        // fullName is generated by valueGetter: `${row.firstName} ${row.lastName}`
        plugin.setQuery("Alice Smith");
        expect(grid.getProcessedData()).toHaveLength(1);
        expect(grid.getProcessedData()[0].firstName).toBe("Alice");
    });

    it("unmounts its slot and resets query on plugin cleanup", () => {
        const plugin = new QuickFilterPlugin<Person>({ initialValue: "Bob" });
        const grid = new Grid<Person>({ columns: testColumns, data: testData, plugins: [plugin] });

        expect(grid.getQuickFilter()).toBe("Bob");
        expect(grid.getSlotMounts("top")).toHaveLength(1);

        grid.setPlugins([]);
        expect(grid.getQuickFilter()).toBe("");
        expect(grid.getSlotMounts("top")).toHaveLength(0);
        expect(grid.getProcessedData()).toHaveLength(4);
    });

    it("synchronizes with external setQuickFilter calls", () => {
        const plugin = new QuickFilterPlugin<Person>();
        const grid = new Grid<Person>({ columns: testColumns, data: testData, plugins: [plugin] });

        grid.setQuickFilter("Diana");
        expect(plugin.getQuery()).toBe("Diana");

        const descriptor: UIInputControl = plugin.describe();
        expect(descriptor.value).toBe("Diana");
    });

    it("provides static parsing and matching methods", () => {
        expect(QuickFilterPlugin.parseTerms(" Alice,  BOB , Charlie ")).toEqual(["alice", "bob", "charlie"]);
        expect(QuickFilterPlugin.parseTerms("")).toEqual([]);

        expect(QuickFilterPlugin.matchesRow(testData[0], ["alice"], testColumns)).toBe(true);
        expect(QuickFilterPlugin.matchesRow(testData[0], ["r&d"], testColumns)).toBe(false); // searchable: false
        expect(QuickFilterPlugin.matchesRow(testData[0], ["smith"], testColumns)).toBe(true);
    });
});
