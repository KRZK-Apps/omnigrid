import { describe, expect, it, vi } from "vitest";
import { DataPipeline } from "./pipeline";
import { Grid } from "./grid";
import type { GridPlugin } from "./types";

describe("DataPipeline", () => {
    it("executes processors in stage order regardless of registration order", () => {
        const pipeline = new DataPipeline<string>();

        // Register sort stage first
        pipeline.registerProcessor({
            stage: "sort",
            process: (data) => [...data].sort(),
        });

        // Register filter stage second (should execute BEFORE sort)
        pipeline.registerProcessor({
            stage: "filter",
            process: (data) => data.filter((item) => item !== "banana"),
        });

        // Register paginate stage third (should execute AFTER sort)
        pipeline.registerProcessor({
            stage: "paginate",
            process: (data) => data.slice(0, 2),
        });

        const input: string[] = ["cherry", "banana", "apple", "date"];
        const result: string[] = pipeline.process(input, {} as any);

        // Filter: ["cherry", "apple", "date"]
        // Sort: ["apple", "cherry", "date"]
        // Paginate: ["apple", "cherry"]
        expect(result).toEqual(["apple", "cherry"]);
    });

    it("respects priority within the same stage", () => {
        const pipeline = new DataPipeline<number>();

        pipeline.registerProcessor({
            stage: "sort",
            priority: 10,
            process: (data) => data.map((n) => n * 2),
        });

        pipeline.registerProcessor({
            stage: "sort",
            priority: 20, // runs first
            process: (data) => data.map((n) => n + 1),
        });

        // (n + 1) then (* 2): (5 + 1) * 2 = 12
        const result: number[] = pipeline.process([5], {} as any);
        expect(result).toEqual([12]);
    });

    it("triggers onInvalidate when processors are registered and unregistered", () => {
        const onInvalidate = vi.fn();
        const pipeline = new DataPipeline<number>(onInvalidate);

        const unregister = pipeline.registerProcessor({
            stage: "filter",
            process: (data) => data,
        });
        expect(onInvalidate).toHaveBeenCalledTimes(1);

        unregister();
        expect(onInvalidate).toHaveBeenCalledTimes(2);
    });
});

describe("Grid modular state and extension methods", () => {
    it("allows plugins to update state slices via setState", () => {
        const grid = new Grid<{ id: number }>({
            data: [{ id: 1 }, { id: 2 }],
            columns: [{ id: "id", field: "id" }],
        });

        const plugin: GridPlugin<{ id: number }> = {
            name: "test-plugin",
            register(api) {
                api.setState((prev) => ({
                    ...prev,
                    customPluginSlice: "initialized",
                } as any));
            },
        };

        grid.registerPlugin(plugin);
        expect((grid.getState() as any).customPluginSlice).toBe("initialized");

        grid.setState((prev) => ({
            ...prev,
            customPluginSlice: "updated",
        } as any));
        expect((grid.getState() as any).customPluginSlice).toBe("updated");
    });

    it("allows plugins to register dynamic methods on api and api.methods with cleanup", () => {
        const grid = new Grid<{ id: number }>({
            data: [{ id: 1 }],
            columns: [{ id: "id", field: "id" }],
        });

        let unregisterPlugin: (() => void) | undefined;
        const plugin: GridPlugin<{ id: number }> = {
            name: "methods-plugin",
            register(api) {
                const unregisterMethods = api.registerMethods({
                    greet: (name: string) => `Hello, ${name}!`,
                    calculate: (a: number, b: number) => a + b,
                });
                return unregisterMethods;
            },
        };

        unregisterPlugin = grid.registerPlugin(plugin);

        expect(typeof (grid as any).greet).toBe("function");
        expect((grid as any).greet("OmniGrid")).toBe("Hello, OmniGrid!");
        expect((grid.methods as any).calculate(2, 3)).toBe(5);

        unregisterPlugin();

        expect((grid as any).greet).toBeUndefined();
        expect((grid.methods as any).calculate).toBeUndefined();
    });
});
