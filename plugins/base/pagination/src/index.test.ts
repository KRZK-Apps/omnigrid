import { Grid } from "@omnigrid/core";
import type { ColumnDef, SlotContent, SlotNodeContent } from "@omnigrid/core";
import { describe, expect, it } from "vitest";

import { PaginationPlugin } from "./index";

interface Row {
    value: number;
}

function getPager<T>(grid: Grid<T>): SlotNodeContent<T> {
    grid.getProcessedData();
    const mount = grid.getSlotMounts("bottom")[0];
    if (!mount || typeof mount.content !== "function") {
        throw new Error("Pagination slot was not mounted");
    }
    const content: SlotContent = mount.content({ api: grid, state: grid.getState(), slot: "bottom" });
    if (!content || typeof content !== "object" || !("type" in content) || content.type !== "node") {
        throw new Error("Pagination slot did not return a node");
    }
    return content as SlotNodeContent<T>;
}

function asSlotNode<T>(content: SlotContent): SlotNodeContent<T> {
    if (!content || typeof content !== "object" || !("type" in content) || content.type !== "node") {
        throw new Error("Expected a slot node");
    }
    return content as SlotNodeContent<T>;
}

describe("PaginationPlugin icons", () => {
    it("renders icon-only controls for first, previous, next, and last pages", () => {
        const columns: ColumnDef<Row>[] = [{ id: "value", field: "value", header: "Value" }];
        const grid = new Grid<Row>({
            columns,
            data: Array.from({ length: 25 }, (_, value) => ({ value })),
            plugins: [new PaginationPlugin<Row>({ pageSize: 10 })],
        });
        const pager = getPager(grid);
        const navigation = pager.children?.[0] as SlotNodeContent<Row>;
        const controls = navigation.children?.filter((child): child is SlotNodeContent<Row> =>
            typeof child === "object" && child !== null && "tag" in child && child.tag === "button",
        );

        expect(controls).toHaveLength(4);
        expect(controls?.map((control) => control.attrs?.["aria-label"])).toEqual([
            "First page",
            "Previous page",
            "Next page",
            "Last page",
        ]);
        expect(controls?.map((control) => control.children?.[0])).toMatchObject([
            { type: "node", tag: "svg", attrs: { class: "omnigrid-icon omnigrid-icon-chevron-first" } },
            { type: "node", tag: "svg", attrs: { class: "omnigrid-icon omnigrid-icon-chevron-left" } },
            { type: "node", tag: "svg", attrs: { class: "omnigrid-icon omnigrid-icon-chevron-right" } },
            { type: "node", tag: "svg", attrs: { class: "omnigrid-icon omnigrid-icon-chevron-last" } },
        ]);
    });

    it("allows each pager control icon to be replaced through plugin options", () => {
        const customIcon: SlotNodeContent<Row> = { type: "node", tag: "svg", attrs: { "data-custom": "true" } };
        const grid = new Grid<Row>({
            columns: [{ id: "value", field: "value", header: "Value" }],
            data: [{ value: 1 }],
            plugins: [new PaginationPlugin<Row>({ icons: { prev: customIcon } })],
        });
        const pager = getPager(grid);
        const navigation = pager.children?.[0] as SlotNodeContent<Row>;
        const controls = navigation.children?.filter((child): child is SlotNodeContent<Row> =>
            typeof child === "object" && child !== null && "tag" in child && child.tag === "button",
        );

        expect(controls?.[1].children?.[0]).toBe(customIcon);
    });
});

describe("PaginationPlugin control blocks", () => {
    it("shows navigation by default and renders the optional blocks when enabled", () => {
        const defaultGrid = new Grid<Row>({
            columns: [{ id: "value", field: "value", header: "Value" }],
            data: [{ value: 1 }],
            plugins: [new PaginationPlugin<Row>()],
        });
        expect(getPager(defaultGrid).children).toHaveLength(1);
        expect(getPager(defaultGrid).children?.[0]).toMatchObject({
            type: "node",
            attrs: { class: "omnigrid-control-group" },
        });
        expect((getPager(defaultGrid).children?.[0] as SlotNodeContent<Row>).children?.[2]).toMatchObject({
            type: "html",
            html: "Page <b>1</b> of 1",
        });

        const grid = new Grid<Row>({
            columns: [{ id: "value", field: "value", header: "Value" }],
            data: Array.from({ length: 25 }, (_, value) => ({ value })),
            plugins: [new PaginationPlugin<Row>({ pageSize: 10, panels: ["rowInfo", "pageSize", "navigation"] })],
        });
        const pager = getPager(grid);
        const children = pager.children ?? [];

        expect(children).toHaveLength(3);
        expect(children[0]).toMatchObject({ type: "html", html: "Rows 1–10 of 25" });
        expect(children[1]).toMatchObject({ type: "node", tag: "div", attrs: { class: "omnigrid-popup-control" } });
        expect(children[2]).toMatchObject({ type: "node", tag: "div", attrs: { class: "omnigrid-control-group" } });
        const pageSizeControl = (children[1] as SlotNodeContent<Row>).children?.[0] as SlotNodeContent<Row>;
        expect(pageSizeControl).toMatchObject({
            tag: "button",
            attrs: { "aria-label": "Page Size:", "aria-expanded": false },
            children: ["Page Size: 10"],
        });

        const plugin = new PaginationPlugin<Row>({ pageSize: 10, panels: ["rowInfo"] });
        const secondPageGrid = new Grid<Row>({
            columns: [{ id: "value", field: "value", header: "Value" }],
            data: Array.from({ length: 25 }, (_, value) => ({ value })),
            plugins: [plugin],
        });
        secondPageGrid.getProcessedData();
        plugin.goToPage(2);
        expect(getPager(secondPageGrid).children?.find((child) =>
            typeof child === "object" && child !== null && "key" in child && child.key === "rowInfo",
        )).toMatchObject({ type: "html", html: "Rows 11–20 of 25" });
    });

    it("allows panels to be selected and their order to be configured", () => {
        const grid = new Grid<Row>({
            columns: [{ id: "value", field: "value", header: "Value" }],
            data: [{ value: 1 }],
            plugins: [
                new PaginationPlugin<Row>({
                    panels: ["navigation", "rowInfo", "pageSize"],
                }),
            ],
        });
        const children = getPager(grid).children ?? [];

        expect(children).toHaveLength(3);
        expect(children[0]).toMatchObject({ type: "node", attrs: { class: "omnigrid-control-group" } });
        expect(children[1]).toMatchObject({ type: "html" });
        expect(children[2]).toMatchObject({ type: "node", attrs: { class: "omnigrid-popup-control" } });
    });

    it("opens the page-size menu above the control and resets to page one on selection", () => {
        const plugin = new PaginationPlugin<Row>({
            pageSize: 10,
            panels: ["pageSize", "navigation"],
        });
        const grid = new Grid<Row>({
            columns: [{ id: "value", field: "value", header: "Value" }],
            data: Array.from({ length: 25 }, (_, value) => ({ value })),
            plugins: [plugin],
        });
        grid.getProcessedData();
        plugin.goToPage(2);

        let pageSizeBlock = getPager(grid).children?.[0] as SlotNodeContent<Row>;
        const trigger = pageSizeBlock.children?.[0] as SlotNodeContent<Row>;
        trigger.on?.click?.({ api: grid, state: grid.getState(), slot: "bottom" }, {});
        pageSizeBlock = getPager(grid).children?.[0] as SlotNodeContent<Row>;
        const menu = pageSizeBlock.children?.[1] as SlotNodeContent<Row>;
        expect(menu.attrs).toMatchObject({ class: "omnigrid-popup-menu", role: "listbox" });
        const option = menu.children?.map(asSlotNode<Row>).find((child) => child.children?.[0] === "20");
        option?.on?.click?.({ api: grid, state: grid.getState(), slot: "bottom" }, {});

        expect(plugin.getState()).toMatchObject({ page: 1, pageSize: 20, totalPages: 2 });
    });

    it("shows the configurable-width quick-jump field and jumps on Enter", () => {
        const defaultWidthGrid = new Grid<Row>({
            columns: [{ id: "value", field: "value", header: "Value" }],
            data: [{ value: 1 }],
            plugins: [new PaginationPlugin<Row>({ quickJump: true })],
        });
        const defaultNavigation = getPager(defaultWidthGrid).children?.[0] as SlotNodeContent<Row>;
        const defaultPageControl = defaultNavigation.children
            ?.map(asSlotNode<Row>)
            .find((child) => child.tag === "div" && child.attrs?.class === "omnigrid-control-group");
        expect((defaultPageControl?.children?.[0] as SlotNodeContent<Row>).attrs?.size).toBe(2);

        const plugin = new PaginationPlugin<Row>({ quickJump: true, pageInputCharacters: 3 });
        const grid = new Grid<Row>({
            columns: [{ id: "value", field: "value", header: "Value" }],
            data: Array.from({ length: 300 }, (_, value) => ({ value })),
            plugins: [plugin],
        });
        grid.getProcessedData();
        const navigation = getPager(grid).children?.[0] as SlotNodeContent<Row>;
        const pageControl = navigation.children
            ?.map(asSlotNode<Row>)
            .find((child) => child.tag === "div" && child.attrs?.class === "omnigrid-control-group");
        const pageInput = pageControl?.children?.[0] as SlotNodeContent<Row>;
        expect(pageInput.attrs).toMatchObject({ type: "text", inputMode: "numeric", size: 3 });

        pageInput.on?.keydown?.({ api: grid, state: grid.getState(), slot: "bottom" }, { value: "4", key: "Enter" });

        expect(plugin.getState().page).toBe(4);
        const updatedNavigation = getPager(grid).children?.[0] as SlotNodeContent<Row>;
        const updatedPageControl = updatedNavigation.children
            ?.map(asSlotNode<Row>)
            .find((child) => child.tag === "div" && child.attrs?.class === "omnigrid-control-group");
        expect((updatedPageControl?.children?.[0] as SlotNodeContent<Row>).attrs?.value).toBe("4");
    });
});
