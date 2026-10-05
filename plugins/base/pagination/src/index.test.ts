import type { ColumnDef, SlotContent, SlotMount, SlotName, SlotNodeContent } from "@omnigrid/core";
import { Grid } from "@omnigrid/core";
import { describe, expect, it, vi } from "vitest";

import { PaginationPlugin } from "./index";

interface Row {
    value: number;
}

function getBlockContent<T>(mount: SlotMount<T>, grid: Grid<T>, slot: SlotName = "bottom"): SlotContent {
    grid.getProcessedData();
    if (typeof mount.content !== "function") {
        return mount.content;
    }
    return mount.content({ api: grid, state: grid.getState(), slot });
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
        const mounts = grid.getSlotMounts("bottom");
        expect(mounts).toHaveLength(1);
        const navigation = asSlotNode<Row>(getBlockContent(mounts[0], grid));
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
        const mounts = grid.getSlotMounts("bottom");
        const navigation = asSlotNode<Row>(getBlockContent(mounts[0], grid));
        const controls = navigation.children?.filter((child): child is SlotNodeContent<Row> =>
            typeof child === "object" && child !== null && "tag" in child && child.tag === "button",
        );

        expect(controls?.[1].children?.[0]).toBe(customIcon);
    });
});

describe("PaginationPlugin control blocks and placement", () => {
    it("shows navigation by default and renders individual mounts per block when enabled", () => {
        const defaultGrid = new Grid<Row>({
            columns: [{ id: "value", field: "value", header: "Value" }],
            data: [{ value: 1 }],
            plugins: [new PaginationPlugin<Row>()],
        });
        const defaultMounts = defaultGrid.getSlotMounts("bottom");
        expect(defaultMounts).toHaveLength(1);
        expect(defaultMounts[0].id).toBe("@omnigrid/pagination:navigation");

        const grid = new Grid<Row>({
            columns: [{ id: "value", field: "value", header: "Value" }],
            data: Array.from({ length: 25 }, (_, value) => ({ value })),
            plugins: [new PaginationPlugin<Row>({ pageSize: 10, blocks: ["rowInfo", "pageSize", "navigation"] })],
        });
        const mounts = grid.getSlotMounts("bottom");
        expect(mounts).toHaveLength(3);
        expect(mounts.map((m) => m.id)).toEqual([
            "@omnigrid/pagination:rowInfo",
            "@omnigrid/pagination:pageSize",
            "@omnigrid/pagination:navigation",
        ]);

        const rowInfoContent = getBlockContent(mounts[0], grid);
        expect(rowInfoContent).toMatchObject({ type: "html", html: "Rows 1–10 of 25" });

        const pageSizeContent = asSlotNode<Row>(getBlockContent(mounts[1], grid));
        expect(pageSizeContent).toMatchObject({ type: "node", tag: "div", attrs: { class: "omnigrid-popup-control" } });

        const navigationContent = asSlotNode<Row>(getBlockContent(mounts[2], grid));
        expect(navigationContent).toMatchObject({ type: "node", tag: "div", attrs: { class: "omnigrid-control-group" } });
    });

    it("allows placing pagination blocks in custom slots, positions, and priorities", () => {
        const grid = new Grid<Row>({
            columns: [{ id: "value", field: "value", header: "Value" }],
            data: Array.from({ length: 100 }, (_, value) => ({ value })),
            plugins: [
                new PaginationPlugin<Row>({
                    blocks: [
                        { name: "rowInfo", slot: "top", position: "start", priority: 10 },
                        { name: "pageSize", slot: "bottom", position: "start", priority: 5 },
                        { name: "navigation", slot: "bottom", position: "end", priority: 0 },
                    ],
                }),
            ],
        });

        const topMounts = grid.getSlotMounts("top");
        expect(topMounts).toHaveLength(1);
        expect(topMounts[0]).toMatchObject({
            id: "@omnigrid/pagination:rowInfo",
            slot: "top",
            position: "start",
            priority: 10,
        });

        const bottomMounts = grid.getSlotMounts("bottom");
        expect(bottomMounts).toHaveLength(2);
        expect(bottomMounts[0]).toMatchObject({
            id: "@omnigrid/pagination:navigation",
            slot: "bottom",
            position: "end",
            priority: 0,
        });
        expect(bottomMounts[1]).toMatchObject({
            id: "@omnigrid/pagination:pageSize",
            slot: "bottom",
            position: "start",
            priority: 5,
        });
    });

    it("opens the page-size menu above bottom controls and resets to page one on selection", () => {
        const plugin = new PaginationPlugin<Row>({
            pageSize: 10,
            blocks: ["pageSize", "navigation"],
        });
        const grid = new Grid<Row>({
            columns: [{ id: "value", field: "value", header: "Value" }],
            data: Array.from({ length: 25 }, (_, value) => ({ value })),
            plugins: [plugin],
        });
        grid.getProcessedData();
        plugin.goToPage(2);

        const mounts = grid.getSlotMounts("bottom");
        let pageSizeBlock = asSlotNode<Row>(getBlockContent(mounts[0], grid));
        const triggerContainer = pageSizeBlock.children?.[1] as SlotNodeContent<Row>;
        const trigger = triggerContainer.children?.[0] as SlotNodeContent<Row>;
        trigger.on?.click?.({ api: grid, state: grid.getState(), slot: "bottom" }, {});
        pageSizeBlock = asSlotNode<Row>(getBlockContent(mounts[0], grid));
        const menu = (pageSizeBlock.children?.[1] as SlotNodeContent<Row>).children?.[1] as SlotNodeContent<Row>;
        expect(menu.attrs).toMatchObject({ class: "omnigrid-popup-menu", role: "listbox" });
        expect(menu.children?.map((item) => asSlotNode<Row>(item).children?.[0])).not.toContain("Auto");
        const option = menu.children?.map(asSlotNode<Row>).find((child) => child.children?.[0] === "20");
        option?.on?.click?.({ api: grid, state: grid.getState(), slot: "bottom" }, {});

        expect(plugin.getState()).toMatchObject({ page: 1, pageSize: 20, totalPages: 2 });
        expect(() => plugin.setPageSize(0)).toThrow("Automatic pagination requires pageSize: 0 in the plugin options");
    });

    it("opens the page-size menu below controls in the top slot", () => {
        const plugin = new PaginationPlugin<Row>({ pageSize: 10, slot: "top", blocks: ["pageSize"] });
        const grid = new Grid<Row>({
            columns: [{ id: "value", field: "value", header: "Value" }],
            data: Array.from({ length: 25 }, (_, value) => ({ value })),
            plugins: [plugin],
        });
        const mount = grid.getSlotMounts("top")[0];
        const closedMenu = asSlotNode<Row>(getBlockContent(mount, grid, "top"));
        const anchor = closedMenu.children?.[1] as SlotNodeContent<Row>;
        (anchor.children?.[0] as SlotNodeContent<Row>).on?.click?.(
            { api: grid, state: grid.getState(), slot: "top" },
            {},
        );

        const openAnchor = asSlotNode<Row>(getBlockContent(mount, grid, "top")).children?.[1] as SlotNodeContent<Row>;
        const openMenu = openAnchor.children?.[1] as SlotNodeContent<Row>;
        expect(openMenu.attrs).toMatchObject({
            class: "omnigrid-popup-menu omnigrid-popup-menu-below",
            role: "listbox",
        });
    });

    it("rejects pagination blocks configured in a side slot", () => {
        // @ts-expect-error Side slots are intentionally unavailable for pagination.
        expect(() => new PaginationPlugin<Row>({ slot: "left" })).toThrow(
            "Pagination blocks can only be placed in the top or bottom slot",
        );
    });

    it("shows the configurable-width quick-jump field and jumps on Enter", () => {
        const plugin = new PaginationPlugin<Row>({ quickJump: true, pageInputCharacters: 3 });
        const grid = new Grid<Row>({
            columns: [{ id: "value", field: "value", header: "Value" }],
            data: Array.from({ length: 300 }, (_, value) => ({ value })),
            plugins: [plugin],
        });
        grid.getProcessedData();
        const mounts = grid.getSlotMounts("bottom");
        const navigation = asSlotNode<Row>(getBlockContent(mounts[0], grid));
        const pageControl = navigation.children
            ?.map(asSlotNode<Row>)
            .find((child) => child.tag === "div" && child.attrs?.class === "omnigrid-control-group");
        const pageInput = pageControl?.children?.[0] as SlotNodeContent<Row>;
        expect(pageInput.attrs).toMatchObject({ type: "text", inputMode: "numeric", size: 3 });

        pageInput.on?.keydown?.({ api: grid, state: grid.getState(), slot: "bottom" }, { value: "4", key: "Enter" });

        expect(plugin.getState().page).toBe(4);
        const updatedNavigation = asSlotNode<Row>(getBlockContent(mounts[0], grid));
        const updatedPageControl = updatedNavigation.children
            ?.map(asSlotNode<Row>)
            .find((child) => child.tag === "div" && child.attrs?.class === "omnigrid-control-group");
        expect((updatedPageControl?.children?.[0] as SlotNodeContent<Row>).attrs?.value).toBe("4");
    });

    it("uses the viewport height for automatic page size and keeps Auto first in the selector", () => {
        const plugin = new PaginationPlugin<Row>({
            pageSize: 0,
            pageSizes: [5, 2],
            blocks: ["pageSize"],
        });
        const grid = new Grid<Row>({
            columns: [
                {
                    id: "outer",
                    header: "Outer",
                    children: [
                        {
                            id: "inner",
                            header: "Inner",
                            children: [{ id: "value", field: "value", header: "Value" }],
                        },
                    ],
                },
            ],
            data: Array.from({ length: 5 }, (_, value) => ({ value })),
            rowHeight: 20,
            plugins: [plugin],
        });

        grid.setViewport({ height: 110 });
        expect(grid.getProcessedData().map((row) => row.value)).toEqual([0, 1]);
        expect(plugin.getState()).toMatchObject({ pageSize: 0, totalRows: 5, totalPages: 3 });

        const pageSizeMount = grid.getSlotMounts("bottom")[0];
        const pageSizeBlock = asSlotNode<Row>(getBlockContent(pageSizeMount, grid));
        expect(pageSizeBlock.children?.[0]).toMatchObject({ tag: "span", children: ["Page Size:"] });
        const pageSizeAnchor = pageSizeBlock.children?.[1] as SlotNodeContent<Row>;
        expect(pageSizeAnchor.attrs).toMatchObject({ class: "omnigrid-popup-anchor" });
        expect(pageSizeAnchor.children?.[0]).toMatchObject({
            tag: "button",
            attrs: { "aria-label": "Page Size: Auto" },
            children: ["Auto"],
        });
        const trigger = pageSizeAnchor.children?.[0] as SlotNodeContent<Row>;
        trigger.on?.click?.({ api: grid, state: grid.getState(), slot: "bottom" }, {});
        const openBlock = asSlotNode<Row>(getBlockContent(pageSizeMount, grid));
        const menu = (openBlock.children?.[1] as SlotNodeContent<Row>).children?.[1] as SlotNodeContent<Row>;
        expect(menu.children?.map((item) => asSlotNode<Row>(item).children?.[0])).toEqual(["Auto", "5", "2"]);

        grid.setColumns([{ id: "value", field: "value", header: "Value" }]);
        expect(grid.getProcessedData().map((row) => row.value)).toEqual([0, 1, 2, 3]);
        expect(plugin.getState()).toMatchObject({ pageSize: 0, totalRows: 5, totalPages: 2 });
    });

    it("does not slice data in server mode and requests page changes with the effective page size", () => {
        const onChange = vi.fn();
        const rows = [{ value: 1 }, { value: 2 }];
        const plugin = new PaginationPlugin<Row>({
            mode: "server",
            pageSize: 10,
            totalRows: 25,
            onChange,
        });
        const grid = new Grid<Row>({
            columns: [{ id: "value", field: "value", header: "Value" }],
            data: rows,
            plugins: [plugin],
        });

        expect(grid.getProcessedData()).toEqual(rows);
        expect(plugin.getState()).toMatchObject({ totalRows: 25, totalPages: 3 });
        plugin.goToPage(2);
        expect(onChange).toHaveBeenLastCalledWith({ page: 2, pageSize: 10 });

        plugin.setPageSize(20);
        expect(onChange).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });

        plugin.goToPage(2);
        plugin.setTotalRows(15);
        expect(plugin.getState()).toMatchObject({ page: 1, totalRows: 15, totalPages: 1 });
        expect(onChange).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
    });
});
