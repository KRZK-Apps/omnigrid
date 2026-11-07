import { describe, expect, it } from "vitest";

import { isTextOverflowed } from "./cellTooltip";

describe("isTextOverflowed", () => {
    it("ignores subpixel differences between text and container bounds", () => {
        expect(isTextOverflowed(76.112518, 76.112503)).toBe(false);
    });

    it("detects text extending beyond the container", () => {
        expect(isTextOverflowed(468, 280)).toBe(true);
    });
});
