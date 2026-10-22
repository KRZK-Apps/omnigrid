import type { ColumnLeafDef, PooledRow } from "@omnigrid/core";

import type { ContentBridge } from "./content";
import { type PooledCellRenderInfo, type PooledRowCallbacks, PooledRowPane } from "./pooledRow";

interface Row {
    name: string;
    age: number;
}

/* ------------------------------ Fake DOM ------------------------------ */

/**
 * Minimal CSSStyleDeclaration stand-in: supports both direct property
 * assignment (`style.position = "absolute"`) and CSSOM methods
 * (`setProperty` / `removeProperty`) used by PooledRowPane.
 */
class FakeStyle {
    [key: string]: unknown;

    public setProperty(name: string, value: string): void {
        (this as Record<string, unknown>)[name] = value;
    }

    public removeProperty(name: string): void {
        delete (this as Record<string, unknown>)[name];
    }
}

class FakeClassList {
    private readonly classes = new Set<string>();

    public add(name: string): void {
        this.classes.add(name);
    }

    public remove(name: string): void {
        this.classes.delete(name);
    }

    public contains(name: string): boolean {
        return this.classes.has(name);
    }
}

class FakeElement {
    public readonly style = new FakeStyle();
    public readonly classList = new FakeClassList();
    public readonly dataset: Record<string, string> = {};
    public readonly children: FakeElement[] = [];
    public className = "";
    public textContent = "";
    public innerHTML = "";

    public get childElementCount(): number {
        return this.children.length;
    }

    public setAttribute(_name: string, _value: string): void {
        // No-op: attributes are not asserted.
    }

    public addEventListener(_type: string, _handler: (event: unknown) => void): void {
        // No-op: interaction is not under test.
    }

    public appendChild(child: FakeElement): void {
        this.children.push(child);
    }

    public replaceChildren(): void {
        this.children.length = 0;
        this.textContent = "";
        this.innerHTML = "";
    }

    public matches(_selector: string): boolean {
        return false;
    }
}

/** Minimal ResizeObserver stand-in: the pane only needs observe/disconnect. */
class FakeResizeObserver {
    public observe(): void {
        // No-op: the fake DOM has no layout.
    }

    public unobserve(): void {
        // No-op: the fake DOM has no layout.
    }

    public disconnect(): void {
        // No-op: the fake DOM has no layout.
    }
}

function installFakeDocument(): void {
    (globalThis as Record<string, unknown>).document = {
        createElement: () => new FakeElement(),
    };
    (globalThis as Record<string, unknown>).ResizeObserver = FakeResizeObserver;
    if (typeof globalThis.requestAnimationFrame !== "function") {
        (globalThis as Record<string, unknown>).requestAnimationFrame = (callback: (time: number) => void): number =>
            setTimeout(() => callback(0), 0) as unknown as number;
    }
}

/* ------------------------------ Harness ------------------------------ */

interface Harness {
    pane: PooledRowPane<Row>;
    host: FakeElement;
    createRootCalls: FakeElement[];
    renderCalls: unknown[][];
    placeholders: Array<PooledCellRenderInfo<Row> | null>;
}

interface MakeOptions {
    /** Cell value served as complex (root-rendered) content — simulates a React cellRenderer. */
    complexContent?: boolean;
    /** Value returned by renderCellPlaceholder; `undefined` = callback not provided. */
    placeholder?: string | null;
    /** Enables the variable-height mode (the grid measures the row height). */
    variableHeight?: boolean;
}

const COLUMN: ColumnLeafDef<Row> = { id: "name", field: "name", width: 120 };

function col(index: number, offset: number): { column: ColumnLeafDef<Row>; index: number; offset: number; width: number } {
    return { column: COLUMN, index, offset, width: 120 };
}

function makeHarness(options: MakeOptions = {}): Harness {
    installFakeDocument();

    const createRootCalls: FakeElement[] = [];
    const renderCalls: unknown[][] = [];
    const placeholders: Array<PooledCellRenderInfo<Row> | null> = [];

    const bridge: ContentBridge<Row> = { registry: {}, context: () => ({}) as never };
    const callbacks: PooledRowCallbacks<Row> = {
        rowHeight: 32,
        renderCellContent: (info) => {
            if (options.complexContent) return { kind: "badge", label: info.data.name };
            return info.data.name;
        },
        resolveRowClasses: () => undefined,
        resolveRowStyle: () => undefined,
        resolveCellClasses: () => undefined,
        resolveCellStyle: () => undefined,
        onRowClick: () => {},
        onRowHover: () => {},
        onCellClick: () => {},
        createRoot: (container) => {
            createRootCalls.push(container as unknown as FakeElement);
            return {
                render: (content: unknown) => renderCalls.push([content]),
                unmount: () => {},
            };
        },
    };
    if (options.placeholder !== undefined) {
        callbacks.renderCellPlaceholder = (info) => {
            placeholders.push(info);
            return options.placeholder ?? null;
        };
    }
    if (options.variableHeight) {
        callbacks.onRowHeightChange = () => {};
    }

    const host = new FakeElement();
    const pane = new PooledRowPane<Row>(host as unknown as HTMLDivElement, callbacks, bridge);
    return { pane, host, createRootCalls, renderCalls, placeholders };
}

function row(index: number, data: Row): PooledRow<Row> {
    return { index, rowId: index, data, offsetY: index * 32, height: 32, width: 120 };
}

function firstCell(host: FakeElement): FakeElement {
    return host.children[0];
}

describe("PooledRowPane — staging placeholder for root-rendered cells", () => {
    it("paints the placeholder synchronously into a blank cell before the async root commit", () => {
        const { pane, host, createRootCalls, renderCalls, placeholders } = makeHarness({
            complexContent: true,
            placeholder: "Alice",
        });

        pane.bind(row(0, { name: "Alice", age: 30 }), [col(0, 0)], 0);

        // Staging: the scalar preview is visible IMMEDIATELY (no React commit yet)…
        expect(firstCell(host).textContent).toBe("Alice");
        // …while the real content is scheduled through an isolated root.
        expect(createRootCalls).toHaveLength(1);
        expect(renderCalls).toHaveLength(1);
        expect(placeholders).toHaveLength(1);
        expect(placeholders[0]?.rowIndex).toBe(0);
    });

    it("does not stage a placeholder when the cell already holds a committed root", () => {
        const { pane, host, createRootCalls, renderCalls, placeholders } = makeHarness({
            complexContent: true,
            placeholder: "preview",
        });

        pane.bind(row(0, { name: "Alice", age: 30 }), [col(0, 0)], 0);
        expect(createRootCalls).toHaveLength(1);

        // Simulate the async commit having landed (React content in the cell).
        firstCell(host).textContent = "committed-badge";
        placeholders.length = 0;

        pane.bind(row(1, { name: "Bob", age: 40 }), [col(0, 0)], 0);

        // Rebind goes through the SAME root — no second root, no staging.
        expect(createRootCalls).toHaveLength(1);
        expect(renderCalls).toHaveLength(2);
        expect(placeholders).toHaveLength(0);
        // The cell keeps its previous content until the new commit lands — never empty.
        expect(firstCell(host).textContent).toBe("committed-badge");
    });

    it("skips staging when renderCellPlaceholder returns null but still renders the root content", () => {
        const { pane, host, createRootCalls, renderCalls } = makeHarness({
            complexContent: true,
            placeholder: null,
        });

        pane.bind(row(0, { name: "Alice", age: 30 }), [col(0, 0)], 0);

        expect(firstCell(host).textContent).toBe("");
        expect(createRootCalls).toHaveLength(1);
        expect(renderCalls).toHaveLength(1);
    });

    it("skips staging entirely when the callback is not provided (backward compatibility)", () => {
        const { pane, host, createRootCalls } = makeHarness({ complexContent: true });

        pane.bind(row(0, { name: "Alice", age: 30 }), [col(0, 0)], 0);

        expect(firstCell(host).textContent).toBe("");
        expect(createRootCalls).toHaveLength(1);
    });

    it("does not involve the placeholder on the scalar fast path", () => {
        const { pane, host, createRootCalls, renderCalls, placeholders } = makeHarness({
            complexContent: false,
            placeholder: "never",
        });

        pane.bind(row(0, { name: "Alice", age: 30 }), [col(0, 0)], 0);

        expect(firstCell(host).textContent).toBe("Alice");
        expect(createRootCalls).toHaveLength(0);
        expect(renderCalls).toHaveLength(0);
        expect(placeholders).toHaveLength(0);
    });
});

describe("PooledRowPane — column spanning", () => {
    it("renders the span origin with the summed width and parks covered cells off-screen", () => {
        const { pane, host } = makeHarness();
        const columns = [col(0, 0), col(1, 120), col(2, 240)];
        const spans = {
            spans: [
                { span: 2, covered: false },
                { span: 1, covered: true },
                { span: 1, covered: false },
            ],
            widths: [240, 0, 120],
            offsets: [0, 0, 240],
        };

        pane.bind(row(0, { name: "Alice", age: 30 }), columns, 0, spans);

        const cells: FakeElement[] = host.children as FakeElement[];
        expect(cells).toHaveLength(3);
        // Origin: summed width of the two merged columns, aligned to the start.
        expect(cells[0].style.width).toBe("240px");
        expect(cells[0].style.transform).toBe("translate3d(0px, 0, 0)");
        // Covered leaf: parked off-screen so recycled nodes never overlap.
        expect(cells[1].style.transform).toBe("translate3d(-200000px, 0, 0)");
        // Trailing plain cell keeps its own geometry.
        expect(cells[2].style.width).toBe("120px");
        expect(cells[2].style.transform).toBe("translate3d(240px, 0, 0)");
    });

    it("rebinds content when only the span changes on the same column", () => {
        const { pane, host } = makeHarness();
        const columns = [col(0, 0), col(1, 120)];
        pane.bind(row(0, { name: "Alice", age: 30 }), columns, 0, {
            spans: [
                { span: 1, covered: false },
                { span: 1, covered: false },
            ],
            widths: [120, 120],
            offsets: [0, 120],
        });
        expect((host.children as FakeElement[])[0].style.width).toBe("120px");

        pane.bind(row(0, { name: "Alice", age: 30 }), columns, 0, {
            spans: [
                { span: 2, covered: false },
                { span: 1, covered: true },
            ],
            widths: [240, 0],
            offsets: [0, 0],
        });
        expect((host.children as FakeElement[])[0].style.width).toBe("240px");
        expect((host.children as FakeElement[])[1].style.transform).toBe("translate3d(-200000px, 0, 0)");
    });

    it("correctly offsets cells when originX is non-zero (pinned pane offset)", () => {
        const { pane, host } = makeHarness();
        const originX: number = 100;
        const columns = [col(0, 100), col(1, 220), col(2, 340)];
        const spans = {
            spans: [
                { span: 2, covered: false },
                { span: 1, covered: true },
                { span: 1, covered: false },
            ],
            widths: [240, 0, 120],
            offsets: [100, 100, 340],
        };

        pane.bind(row(0, { name: "Alice", age: 30 }), columns, originX, spans);

        const cells: FakeElement[] = host.children as FakeElement[];
        expect(cells).toHaveLength(3);
        // Origin: offset 100 - originX 100 = 0px, width 240px.
        expect(cells[0].style.width).toBe("240px");
        expect(cells[0].style.transform).toBe("translate3d(0px, 0, 0)");
        // Covered leaf: parked off-screen.
        expect(cells[1].style.transform).toBe("translate3d(-200000px, 0, 0)");
        // Trailing plain cell: offset 340 - originX 100 = 240px, width 120px.
        expect(cells[2].style.width).toBe("120px");
        expect(cells[2].style.transform).toBe("translate3d(240px, 0, 0)");
    });
});

describe("PooledRowPane — variable row height", () => {
    it("applies dynamic row height to host and sets cell height to 100%", () => {
        const { pane, host } = makeHarness();
        const customRow: PooledRow<Row> = {
            index: 0,
            rowId: 0,
            data: { name: "Alice", age: 30 },
            offsetY: 100,
            height: 75,
            width: 300,
        };
        pane.bind(customRow, [col(0, 0)], 0);

        expect(host.style.height).toBe("75px");
        const cells: FakeElement[] = host.children as FakeElement[];
        expect(cells[0].style.height).toBe("100%");
    });

    it("clips the row to the height the virtualizer reserved for it", () => {
        const { pane, host } = makeHarness({ variableHeight: true });
        const customRow: PooledRow<Row> = {
            index: 0,
            rowId: 0,
            data: { name: "Alice", age: 30 },
            offsetY: 0,
            height: 40,
            width: 300,
        };
        pane.bind(customRow, [col(0, 0)], 0);

        // The row node must never paint outside its slot — content taller
        // than the reserved height is clipped instead of bleeding into the
        // next row (which would overlap rows while scrolling).
        expect(host.style.overflow).toBe("hidden");
        expect(host.style.minHeight).toBe("");
    });

    it("resizes the bound row without touching its content", () => {
        const { pane, host, renderCalls } = makeHarness({ variableHeight: true });
        const customRow: PooledRow<Row> = {
            index: 0,
            rowId: 0,
            data: { name: "Alice", age: 30 },
            offsetY: 0,
            height: 40,
            width: 300,
        };
        pane.bind(customRow, [col(0, 0)], 0);
        const rendersAfterBind: number = renderCalls.length;

        pane.resize(96);

        expect(host.style.height).toBe("96px");
        expect(pane.getRow()?.height).toBe(96);
        // The cell content was NOT re-rendered.
        expect(renderCalls.length).toBe(rendersAfterBind);
    });
});

describe("PooledRowPane — wrapping columns", () => {
    const WRAP_COLUMN: ColumnLeafDef<Row> = { id: "bio", field: "name", width: 120, wrapText: true };

    function wrapCol(index: number, offset: number): { column: ColumnLeafDef<Row>; index: number; offset: number; width: number } {
        return { column: WRAP_COLUMN, index, offset, width: 120 };
    }

    it("lets a wrapping cell grow with its content while the row keeps the reserved height", () => {
        const { pane, host } = makeHarness({ variableHeight: true });
        const customRow: PooledRow<Row> = {
            index: 0,
            rowId: 0,
            data: { name: "Alice", age: 30 },
            offsetY: 0,
            height: 40,
            width: 300,
        };

        pane.bind(customRow, [wrapCol(0, 0)], 0);

        const cell: FakeElement = firstCell(host);
        // The cell is sized by its content — the row height is measured from it.
        expect(cell.style.height).toBe("auto");
        expect(cell.style.minHeight).toBe("100%");
        // The text wraps instead of being truncated.
        expect(cell.style.whiteSpace).toBe("normal");
        expect(cell.style.wordBreak).toBe("break-word");
        // The wrapped block is aligned to the top of the row.
        expect(cell.style.alignItems).toBe("flex-start");
        // The row itself stays at the height the virtualizer reserved.
        expect(host.style.height).toBe("40px");
    });

    it("keeps the theme alignment and padding for plain columns", () => {
        const { pane, host } = makeHarness({ variableHeight: true });
        const customRow: PooledRow<Row> = {
            index: 0,
            rowId: 0,
            data: { name: "Alice", age: 30 },
            offsetY: 0,
            height: 40,
            width: 300,
        };

        pane.bind(customRow, [col(0, 0)], 0);

        const cell: FakeElement = firstCell(host);
        expect(cell.style.height).toBe("100%");
        expect(cell.style.minHeight).toBe("");
        // No inline alignment / padding overrides — the theme owns them.
        expect(cell.style.alignItems).toBe("");
        expect(cell.style.paddingBlock).toBe("");
        expect(cell.style.whiteSpace).toBe("nowrap");
    });

    it("resets the wrapping styles when a cell is recycled into a plain column", () => {
        const { pane, host } = makeHarness({ variableHeight: true });
        const customRow: PooledRow<Row> = {
            index: 0,
            rowId: 0,
            data: { name: "Alice", age: 30 },
            offsetY: 0,
            height: 40,
            width: 300,
        };

        pane.bind(customRow, [wrapCol(0, 0)], 0);
        // The same node is reused for a plain column.
        pane.bind({ ...customRow, index: 1 }, [col(0, 0)], 0);

        const cell: FakeElement = firstCell(host);
        expect(cell.style.height).toBe("100%");
        expect(cell.style.minHeight).toBe("");
        expect(cell.style.whiteSpace).toBe("nowrap");
        expect(cell.style.alignItems).toBe("");
        expect(cell.style.paddingBlock).toBe("");
    });
});
