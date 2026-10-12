import { describe, expect, it, vi } from "vitest";

import { Grid } from "./grid";
import type { ColumnDef, OverlayState } from "./types";
import { evaluateAutoOverlay } from "./overlays";

interface Row {
    name: string;
}

const COLUMNS: ColumnDef<Row>[] = [{ id: "name", field: "name", header: "Name", width: 100 }];

describe("evaluateAutoOverlay", () => {
    it("returns 'loading' when loading is active, regardless of data", () => {
        expect(evaluateAutoOverlay({ loading: true, rawData: [], processedData: [] })).toBe("loading");
        expect(evaluateAutoOverlay({ loading: true, rawData: [{ name: "a" }], processedData: [{ name: "a" }] })).toBe("loading");
    });

    it("returns 'noRows' when both raw and processed data are empty and not loading", () => {
        expect(evaluateAutoOverlay({ loading: false, rawData: [], processedData: [] })).toBe("noRows");
    });

    it("returns 'error' when a data load failed", () => {
        expect(evaluateAutoOverlay({ loading: false, error: new Error("offline"), rawData: [], processedData: [] })).toBe("error");
    });

    it("returns 'noMatchingRows' when processed data is empty but raw data exists", () => {
        expect(evaluateAutoOverlay({ loading: false, rawData: [{ name: "a" }, { name: "b" }], processedData: [] })).toBe("noMatchingRows");
    });

    it("returns null when processed data is non-empty", () => {
        expect(evaluateAutoOverlay({ loading: false, rawData: [{ name: "a" }], processedData: [{ name: "a" }] })).toBe(null);
    });
});

describe("Grid overlay — automatic evaluation", () => {
    it("shows loading while initial data is undefined", () => {
        const grid = new Grid<Row>({ columns: COLUMNS });
        expect(grid.getOverlayState().type).toBe("loading");

        grid.setData([]);
        expect(grid.getOverlayState().type).toBe("noRows");
    });

    it("shows noRows overlay when data is initially empty", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [] });
        expect(grid.getOverlayState()).toEqual({ type: "noRows", scope: "bodyOnly", blockScroll: false });
    });

    it("shows no overlay when data is present", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [{ name: "a" }] });
        expect(grid.getOverlayState()).toEqual({ type: null });
    });

    it("shows loading overlay when loading option is set", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [], loading: true });
        expect(grid.getOverlayState()).toEqual({ type: "loading", scope: "bodyOnly", blockScroll: false });
    });

    it("shows noRows overlay when data is set to empty after having data", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [{ name: "a" }] });
        expect(grid.getOverlayState().type).toBe(null);
        grid.setData([]);
        expect(grid.getOverlayState().type).toBe("noRows");
    });

    it("shows loading overlay when setLoading(true) is called, hiding noRows", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [] });
        expect(grid.getOverlayState().type).toBe("noRows");
        grid.setLoading(true);
        expect(grid.getOverlayState().type).toBe("loading");
        grid.setLoading(false);
        expect(grid.getOverlayState().type).toBe("noRows");
    });

    it("shows an automatic error overlay when loading completes with an error", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [{ name: "a" }], loading: true });
        const error: Error = new Error("Network unavailable");
        grid.setLoading(false, error);

        expect(grid.getOverlayState()).toEqual({ type: "error", scope: "full", blockScroll: false, payload: error });
        grid.setData([{ name: "a" }]);
        expect(grid.getOverlayState().type).toBe(null);
    });

    it("keeps the loading overlay active while data is null", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: null });
        expect(grid.getOverlayState().type).toBe("loading");
        grid.setData(null);
        expect(grid.getOverlayState().type).toBe("loading");
    });

    it("shows noMatchingRows when a data processor filters everything out", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [{ name: "a" }, { name: "b" }] });
        expect(grid.getOverlayState().type).toBe(null);

        grid.registerDataProcessor((data) => data.filter((row) => row.name === "nonexistent"));
        expect(grid.getOverlayState()).toEqual({ type: "noMatchingRows", scope: "bodyOnly", blockScroll: false });
    });

    it("hides noMatchingRows when the filter is removed and data reappears", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [{ name: "a" }, { name: "b" }] });
        const unregister = grid.registerDataProcessor((data) => data.filter((row) => row.name === "nonexistent"));
        expect(grid.getOverlayState().type).toBe("noMatchingRows");

        unregister();
        expect(grid.getOverlayState().type).toBe(null);
    });

    it("re-evaluates to null overlay when loading completes with data", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [], loading: true });
        expect(grid.getOverlayState().type).toBe("loading");

        grid.setLoading(false);
        expect(grid.getOverlayState().type).toBe("noRows");

        grid.setData([{ name: "a" }]);
        expect(grid.getOverlayState().type).toBe(null);
    });
});

describe("Grid overlay — manual show/hide", () => {
    it("showOverlay displays the specified type with a payload", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [{ name: "a" }] });
        expect(grid.getOverlayState().type).toBe(null);

        grid.showOverlay({ type: "error", payload: new Error("Something went wrong") });
        expect(grid.getOverlayState()).toEqual({
            type: "error",
            scope: "full",
            blockScroll: false,
            payload: expect.any(Error),
        });
    });

    it("showOverlay accepts scope, scroll, message, and component options", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [{ name: "a" }] });
        const component: () => null = () => null;
        grid.showOverlay({
            type: "custom",
            scope: "full",
            blockScroll: false,
            message: "Unavailable",
            component,
        });

        expect(grid.getOverlayState()).toEqual({
            type: "custom",
            scope: "full",
            blockScroll: false,
            message: "Unavailable",
            component,
        });
    });

    it("defaults manual body overlays to bodyOnly and keeps error placement overridable", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [{ name: "a" }] });

        grid.showOverlay({ type: "custom" });
        expect(grid.getOverlayState()).toMatchObject({ type: "custom", scope: "bodyOnly", blockScroll: false });

        grid.showOverlay({ type: "error", scope: "bodyOnly" });
        expect(grid.getOverlayState()).toMatchObject({ type: "error", scope: "bodyOnly" });
    });

    it("showOverlay disables automatic evaluation", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [{ name: "a" }] });
        grid.showOverlay({ type: "noRows" });
        expect(grid.getOverlayState().type).toBe("noRows");

        // Even with data present and not loading, the manual overlay persists
        grid.setData([{ name: "a" }, { name: "b" }]);
        expect(grid.getOverlayState().type).toBe("noRows");
    });

    it("showOverlay with custom type and payload", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [{ name: "a" }] });
        grid.showOverlay({ type: "custom", payload: { message: "Custom content" } });
        expect(grid.getOverlayState()).toMatchObject({ type: "custom", payload: { message: "Custom content" } });
    });

    it("hideOverlay re-enables automatic evaluation", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [{ name: "a" }] });
        grid.showOverlay({ type: "error", payload: new Error("Oops") });
        expect(grid.getOverlayState().type).toBe("error");

        grid.hideOverlay();
        expect(grid.getOverlayState().type).toBe(null);
    });

    it("hideOverlay re-enables automatic evaluation and detects noRows", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [] });
        grid.showOverlay({ type: "error", payload: "manual error" });
        expect(grid.getOverlayState().type).toBe("error");

        grid.hideOverlay();
        expect(grid.getOverlayState().type).toBe("noRows");
    });

    it("hideOverlay clears the manual payload when the automatic type is unchanged", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [] });
        const listener = vi.fn();
        grid.on("overlayChange", listener);
        grid.showOverlay({ type: "noRows", payload: "manual message" });
        listener.mockClear();

        grid.hideOverlay();

        expect(grid.getOverlayState()).toEqual({ type: "noRows", scope: "bodyOnly", blockScroll: false });
        expect(grid.getState().overlay).toEqual({ type: "noRows", scope: "bodyOnly", blockScroll: false });
        expect(listener).toHaveBeenCalledWith({ type: "noRows", scope: "bodyOnly", blockScroll: false });
    });

    it("getOverlayState returns a copy, not the internal reference", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [] });
        const snapshot = grid.getOverlayState();
        snapshot.type = "error";
        snapshot.payload = "mutated";

        expect(grid.getOverlayState().type).toBe("noRows");
        expect(grid.getOverlayState().payload).toBeUndefined();
    });
});

describe("Grid overlay — events", () => {
    it("emits overlayChange when overlay type changes via setData", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [] });
        const listener = vi.fn();
        grid.on("overlayChange", listener);

        // Initial noRows is set in constructor — listener not yet registered.
        listener.mockClear();
        grid.setData([{ name: "a" }]);
        expect(listener).toHaveBeenCalledWith({ type: null });
    });

    it("emits overlayChange when showOverlay is called", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [{ name: "a" }] });
        const listener = vi.fn();
        grid.on("overlayChange", listener);

        grid.showOverlay({ type: "error", payload: "test error" });
        expect(listener).toHaveBeenCalledWith({ type: "error", scope: "full", blockScroll: false, payload: "test error" });
    });

    it("emits overlayChange when hideOverlay is called", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [] });
        const listener = vi.fn();
        grid.on("overlayChange", listener);
        grid.showOverlay({ type: "custom", payload: "manual" });
        listener.mockClear();

        grid.hideOverlay();
        expect(listener).toHaveBeenCalledWith({ type: "noRows", scope: "bodyOnly", blockScroll: false });
    });
});

describe("Grid overlay — state in GridState", () => {
    it("exposes overlay state via getState()", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [] });
        expect(grid.getState().overlay).toEqual({ type: "noRows", scope: "bodyOnly", blockScroll: false });

        grid.showOverlay({ type: "loading" });
        expect(grid.getState().overlay).toEqual({ type: "loading", scope: "bodyOnly", blockScroll: false });
    });
});

describe("Grid overlay — destroy", () => {
    it("clears overlay state on destroy", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [], loading: true });
        expect(grid.getOverlayState().type).toBe("loading");

        grid.destroy();
        expect(grid.isDestroyed()).toBe(true);
    });

    it("getOverlayState still works after destroy", () => {
        const grid = new Grid<Row>({ columns: COLUMNS, data: [] });
        grid.destroy();
        expect(grid.getOverlayState()).toEqual({ type: null });
    });
});
