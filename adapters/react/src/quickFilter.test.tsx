import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Grid } from "@omnigrid/core";
import type { ColumnDef, SlotRenderContext, UIInputControl } from "@omnigrid/core";
import { QuickFilterPlugin } from "@omnigrid/quick-filter-plugin";

import { contentToReactNode } from "./content";
import { OmniGrid } from "./OmniGrid";

interface User {
    id: number;
    name: string;
    email: string;
    city: string;
    notes?: string;
}

const columns: ColumnDef<User>[] = [
    { id: "id", field: "id", header: "ID", width: 60 },
    { id: "name", field: "name", header: "Name", width: 120 },
    { id: "email", field: "email", header: "Email", width: 180 },
    { id: "city", field: "city", header: "City", width: 120 },
    { id: "notes", field: "notes", header: "Notes", width: 100, searchable: false },
];

const users: User[] = [
    { id: 1, name: "Alice Adams", email: "alice@example.com", city: "New York", notes: "VIP" },
    { id: 2, name: "Bob Baker", email: "bob@example.com", city: "London", notes: "VIP" },
    { id: 3, name: "Charlie Clark", email: "charlie@example.com", city: "Paris", notes: "Standard" },
];

describe("QuickFilterPlugin React integration", () => {
    it("renders the quick filter descriptor into React elements via contentToReactNode", () => {
        const plugin = new QuickFilterPlugin<User>({ placeholder: "Filter users..." });
        const grid = new Grid<User>({ columns, data: users, plugins: [plugin] });
        const descriptor: UIInputControl = plugin.describe();

        const context: SlotRenderContext<User> = { api: grid, state: grid.getState(), slot: "top" };
        const reactNode = contentToReactNode(descriptor, {
            registry: {},
            context: (): SlotRenderContext<User> => context,
        });

        const html: string = renderToStaticMarkup(createElement("div", null, reactNode));
        expect(html).toContain("omnigrid-control omnigrid-control-text");
        expect(html).toContain("omnigrid-control-input");
        expect(html).toContain('placeholder="Filter users..."');
        expect(html).toContain('type="text"');
        // The filter icon from the core icon registry renders before the input body.
        expect(html).toContain("omnigrid-control-body");
        expect(html).toContain('class="omnigrid-icon omnigrid-icon-filter"');
        expect(html).toContain("M22 3H2l8 9.46V19l4 2v-8.54L22 3z");
        expect(html.indexOf("omnigrid-icon-filter")).toBeLessThan(html.indexOf("omnigrid-control-input"));
    });

    it("renders QuickFilterPlugin in the top slot of OmniGrid by default", () => {
        const plugin = new QuickFilterPlugin<User>({ placeholder: "Quick search..." });
        const html: string = renderToStaticMarkup(
            createElement(OmniGrid<User>, {
                columns,
                data: users,
                plugins: [plugin],
            }),
        );

        expect(html).toContain("omnigrid-slot-top");
        expect(html).toContain("omnigrid-control-input");
        expect(html).toContain('placeholder="Quick search..."');
        // Icon resolved via the grid's icon registry inside the rendered slot.
        expect(html).toContain('class="omnigrid-icon omnigrid-icon-filter"');
        expect(html.indexOf("omnigrid-icon-filter")).toBeLessThan(html.indexOf("omnigrid-control-input"));
    });

    it("renders QuickFilterPlugin in bodyTop slot without breaking layout", () => {
        const plugin = new QuickFilterPlugin<User>({ slot: "bodyTop" });
        const html: string = renderToStaticMarkup(
            createElement(OmniGrid<User>, {
                columns,
                data: users,
                plugins: [plugin],
            }),
        );

        expect(html).toContain("omnigrid-slot-bodyTop");
        expect(html).toContain("omnigrid-control-input");
    });

    it("renders QuickFilterPlugin in bottom slot when slot is bottom or down", () => {
        const bottomPlugin = new QuickFilterPlugin<User>({ slot: "bottom" });
        const html1: string = renderToStaticMarkup(
            createElement(OmniGrid<User>, {
                columns,
                data: users,
                plugins: [bottomPlugin],
            }),
        );
        expect(html1).toContain("omnigrid-slot-bottom");

        const downPlugin = new QuickFilterPlugin<User>({ slot: "down" });
        const html2: string = renderToStaticMarkup(
            createElement(OmniGrid<User>, {
                columns,
                data: users,
                plugins: [downPlugin],
            }),
        );
        expect(html2).toContain("omnigrid-slot-bottom");
    });

    it("renders QuickFilterPlugin in bodyBottom slot", () => {
        const plugin = new QuickFilterPlugin<User>({ slot: "bodyBottom" });
        const html: string = renderToStaticMarkup(
            createElement(OmniGrid<User>, {
                columns,
                data: users,
                plugins: [plugin],
            }),
        );

        expect(html).toContain("omnigrid-slot-bodyBottom");
        expect(html).toContain("omnigrid-control-input");
    });

    it("preserves 2D virtualization row calculations when quick filter is applied", () => {
        const plugin = new QuickFilterPlugin<User>({ initialValue: "London" });
        const grid = new Grid<User>({ columns, data: users, plugins: [plugin] });

        expect(grid.getProcessedData()).toHaveLength(1);
        expect(grid.getProcessedData()[0].name).toBe("Bob Baker");
        expect(grid.getQuickFilter()).toBe("London");

        const viewportData = grid.getViewportData();
        expect(viewportData.totalHeight).toBe(1 * grid.getState().rowHeight);

        const html: string = renderToStaticMarkup(
            createElement(OmniGrid<User>, {
                columns,
                data: users,
                plugins: [plugin],
            }),
        );
        expect(html).toContain("omnigrid-slot-top");
        expect(html).toContain('value="London"');
    });

    it("ignores non-searchable columns during filtering in React component", () => {
        const plugin = new QuickFilterPlugin<User>({ initialValue: "VIP" });
        const grid = new Grid<User>({ columns, data: users, plugins: [plugin] });

        // "VIP" only exists in the 'notes' column which has searchable: false
        expect(grid.getProcessedData()).toHaveLength(0);

        const html: string = renderToStaticMarkup(
            createElement(OmniGrid<User>, {
                columns,
                data: users,
                plugins: [plugin],
            }),
        );
        expect(html).toContain('value="VIP"');
    });
});
