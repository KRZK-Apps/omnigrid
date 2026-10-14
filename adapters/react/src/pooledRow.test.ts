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

function installFakeDocument(): void {
    (globalThis as Record<string, unknown>).document = {
        createElement: () => new FakeElement(),
    };
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

/* ------------------------------ Tests ------------------------------ */

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

