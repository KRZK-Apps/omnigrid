import { describe, expect, it } from "vitest";

import { IconRegistry } from "./icons";

describe("IconRegistry", () => {
    it("provides core chevrons and sorting arrows as declarative SVG nodes", () => {
        const icons = new IconRegistry<{}>();

        for (const name of [
            "chevron-left",
            "chevron-right",
            "chevron-up",
            "chevron-down",
            "chevron-first",
            "chevron-last",
            "arrow-up",
            "arrow-down",
            "arrow-up-down",
        ]) {
            expect(icons.get(name)).toMatchObject({
                type: "node",
                tag: "svg",
                attrs: { class: `omnigrid-icon omnigrid-icon-${name}` },
            });
        }
    });

    it("restores the prior icon when overrides are removed out of order", () => {
        const icons = new IconRegistry<{}>();
        const original = icons.get("chevron-left");
        const firstOverride = { type: "node", tag: "svg", attrs: { id: "first" } } as const;
        const secondOverride = { type: "node", tag: "svg", attrs: { id: "second" } } as const;
        const unregisterFirst = icons.register("chevron-left", firstOverride);
        const unregisterSecond = icons.register("chevron-left", secondOverride);

        unregisterFirst();
        unregisterSecond();

        expect(icons.get("chevron-left")).toEqual(original);
    });

    it("removes plugin-only icons when unregistered", () => {
        const icons = new IconRegistry<{}>();
        const unregister = icons.register("custom", { type: "node", tag: "svg" });

        expect(icons.has("custom")).toBe(true);
        unregister();
        expect(icons.has("custom")).toBe(false);
        expect(() => icons.get("custom")).toThrow("Unknown OmniGrid icon: custom");
    });
});
