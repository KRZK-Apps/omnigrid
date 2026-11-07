import { describe, expect, it } from "vitest";

import { clampPopupLeft } from "./popup";

describe("clampPopupLeft", () => {
    it("keeps a popup inside the grid when bottom-end placement overflows left", () => {
        expect(clampPopupLeft(180, 320, 308, 992)).toBe(308);
    });

    it("keeps a popup inside the grid when bottom-start placement overflows right", () => {
        expect(clampPopupLeft(800, 320, 308, 992)).toBe(672);
    });

    it("preserves the requested position when it already fits", () => {
        expect(clampPopupLeft(400, 320, 308, 992)).toBe(400);
    });
});
