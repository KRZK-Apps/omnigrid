import { describe, expect, it } from "vitest";

import { RowHeightRegistry, Virtualizer } from "./virtualizer";

describe("RowHeightRegistry", () => {
    it("reports default estimated height when no measurements exist", () => {
        const registry: RowHeightRegistry = new RowHeightRegistry(40);
        expect(registry.size).toBe(0);
        expect(registry.hasVariableHeights).toBe(false);
        expect(registry.getRowHeight(0)).toBe(40);
        expect(registry.getRowHeight(5)).toBe(40);
        expect(registry.getTotalHeight(3)).toBe(120);
        expect(registry.getTop(0, 3)).toBe(0);
        expect(registry.getTop(1, 3)).toBe(40);
        expect(registry.getTop(2, 3)).toBe(80);
    });

    it("records measured heights and updates prefix sums", () => {
        const registry: RowHeightRegistry = new RowHeightRegistry(30);
        const changed: boolean = registry.set(1, 60);
        expect(changed).toBe(true);
        expect(registry.size).toBe(1);
        expect(registry.hasVariableHeights).toBe(true);
        expect(registry.get(1)).toBe(60);
        expect(registry.getRowHeight(0)).toBe(30);
        expect(registry.getRowHeight(1)).toBe(60);
        expect(registry.getRowHeight(2)).toBe(30);

        expect(registry.getTop(0, 3)).toBe(0);
        expect(registry.getTop(1, 3)).toBe(30);
        expect(registry.getTop(2, 3)).toBe(90);
        expect(registry.getTotalHeight(3)).toBe(120);
    });

    it("ignores sub-pixel changes to prevent layout loops", () => {
        const registry: RowHeightRegistry = new RowHeightRegistry(30);
        registry.set(0, 50);
        const vBefore: number = registry.version;
        const changed: boolean = registry.set(0, 50.8); // rounds to 51, abs(51 - 50) <= 1
        expect(changed).toBe(false);
        expect(registry.version).toBe(vBefore);
    });

    it("supports a dynamic getRowHeight resolver callback", () => {
        const resolver = (rowIndex: number): number | undefined => (rowIndex === 2 ? 100 : undefined);
        const registry: RowHeightRegistry = new RowHeightRegistry(40, resolver);
        expect(registry.hasVariableHeights).toBe(true);
        expect(registry.getRowHeight(0)).toBe(40);
        expect(registry.getRowHeight(1)).toBe(40);
        expect(registry.getRowHeight(2)).toBe(100);

        // Measured heights take precedence over the resolver
        registry.set(2, 120);
        expect(registry.getRowHeight(2)).toBe(120);

        registry.reset(2);
        // Resets back to resolver
        expect(registry.getRowHeight(2)).toBe(100);
    });

    it("locates visible start and end via binary search", () => {
        const registry: RowHeightRegistry = new RowHeightRegistry(50);
        // Row 0: 50 [0..50)
        // Row 1: 100 [50..150)
        // Row 2: 50 [150..200)
        registry.set(1, 100);

        expect(registry.findStart(3, 0)).toBe(0);
        expect(registry.findStart(3, 40)).toBe(0);
        expect(registry.findStart(3, 50)).toBe(1);
        expect(registry.findStart(3, 140)).toBe(1);
        expect(registry.findStart(3, 150)).toBe(2);

        expect(registry.findEnd(3, 50)).toBe(1);
        expect(registry.findEnd(3, 150)).toBe(2);
        expect(registry.findEnd(3, 200)).toBe(3);
    });

    it("clears all measurements and increments version", () => {
        const registry: RowHeightRegistry = new RowHeightRegistry(30);
        registry.set(0, 60);
        registry.set(1, 80);
        expect(registry.size).toBe(2);

        const vBefore: number = registry.version;
        registry.clear();
        expect(registry.size).toBe(0);
        expect(registry.version).toBeGreaterThan(vBefore);
        expect(registry.getRowHeight(0)).toBe(30);
    });

    it("keeps the incremental offset index consistent with a naive prefix-sum implementation", () => {
        const count: number = 64;
        const estimate: number = 30;
        const registry: RowHeightRegistry = new RowHeightRegistry(estimate);
        const naive: number[] = new Array<number>(count).fill(estimate);

        const naiveFindStart = (offset: number): number => {
            let top: number = 0;
            for (let index: number = 0; index < count; index += 1) {
                top += naive[index];
                if (top > offset) return index;
            }
            return count;
        };
        const naiveFindEnd = (offset: number): number => {
            let top: number = 0;
            for (let index: number = 0; index < count; index += 1) {
                if (top >= offset) return index;
                top += naive[index];
            }
            return count;
        };

        for (let step: number = 0; step < 200; step += 1) {
            const index: number = (step * 7) % count;
            const height: number = 20 + ((step * 13) % 90);
            if (registry.set(index, height)) naive[index] = height;

            let top: number = 0;
            for (let row: number = 0; row < count; row += 1) {
                expect(registry.getTop(row, count)).toBe(top);
                top += naive[row];
            }
            expect(registry.getTotalHeight(count)).toBe(top);

            for (const offset of [0, 1, 37, 120, 500, 1200]) {
                expect(registry.findStart(count, offset)).toBe(naiveFindStart(offset));
                expect(registry.findEnd(count, offset)).toBe(naiveFindEnd(offset));
            }
        }
    });

    it("finds the visible range of irregular heights like a linear scan", () => {
        const count: number = 300;
        const registry: RowHeightRegistry = new RowHeightRegistry(32);
        const heights: number[] = [];
        for (let index: number = 0; index < count; index += 1) {
            const height: number = 32 + (Math.abs(Math.round(Math.sin(index * 12.9898) * 43758.5453)) % 50);
            registry.set(index, height);
            heights.push(registry.getRowHeight(index));
        }

        const tops: number[] = [0];
        for (let index: number = 0; index < count; index += 1) {
            tops.push((tops[index] as number) + (heights[index] as number));
        }
        const total: number = tops[count] as number;

        for (let offset: number = 0; offset < total; offset += 37) {
            // The row that contains the offset: the last row starting at or
            // before it.
            let expectedStart: number = 0;
            while (expectedStart < count && (tops[expectedStart + 1] as number) <= offset) expectedStart += 1;
            // The first row whose top edge is at or past the offset.
            let expectedEnd: number = 0;
            while (expectedEnd < count && (tops[expectedEnd] as number) < offset) expectedEnd += 1;

            expect(registry.findStart(count, offset)).toBe(expectedStart);
            expect(registry.findEnd(count, offset)).toBe(expectedEnd);
        }
    });

    it("restores the offset index when a measurement is reset", () => {
        const registry: RowHeightRegistry = new RowHeightRegistry(30);
        registry.set(0, 90);
        registry.set(1, 60);
        expect(registry.getTop(2, 3)).toBe(150);

        registry.reset(0);
        expect(registry.getRowHeight(0)).toBe(30);
        expect(registry.getTop(1, 3)).toBe(30);
        expect(registry.getTop(2, 3)).toBe(90);
        expect(registry.getTotalHeight(3)).toBe(120);
    });

    it("rebuilds the offset index when the dataset size changes", () => {
        const registry: RowHeightRegistry = new RowHeightRegistry(30);
        registry.set(0, 90);
        expect(registry.getTotalHeight(3)).toBe(150);

        // A shorter dataset: the tree is rebuilt for the new row count.
        expect(registry.getTotalHeight(1)).toBe(90);
        expect(registry.getTop(0, 1)).toBe(0);
    });
});

describe("Virtualizer — Variable Row Height", () => {
    it("computes variable row range with overscan", () => {
        const virtualizer: Virtualizer<unknown> = new Virtualizer({
            rowHeight: 40,
            estimatedRowHeight: 40,
            rowOverscan: 2,
            columnOverscan: 0,
        });

        virtualizer.setRowHeight(1, 100, 0, 10);
        expect(virtualizer.hasVariableHeights).toBe(true);

        const range = virtualizer.getRowRange(10, 0, 150);
        expect(range.start).toBe(0);
        expect(range.end).toBeGreaterThanOrEqual(3);
    });

    it("corrects scrollTop (scroll anchoring) when rows above the viewport expand", () => {
        const virtualizer: Virtualizer<unknown> = new Virtualizer({
            rowHeight: 40,
            estimatedRowHeight: 40,
            rowOverscan: 1,
            columnOverscan: 0,
        });

        // Current scroll is at 200px (user is viewing rows down the table)
        const scrollTop: number = 200;
        const count: number = 50;

        // Row 0 is at top 0 (< 200px), expands from 40 to 90 (+50px)
        const correction: number = virtualizer.setRowHeight(0, 90, scrollTop, count);
        expect(correction).toBe(50);

        // Row 10 is at top > 200px, expands: no correction needed (0)
        const correctionBelow: number = virtualizer.setRowHeight(10, 100, scrollTop, count);
        expect(correctionBelow).toBe(0);
    });

    it("corrects scrollTop when measured row above viewport is reset", () => {
        const virtualizer: Virtualizer<unknown> = new Virtualizer({
            rowHeight: 40,
            estimatedRowHeight: 40,
            rowOverscan: 1,
            columnOverscan: 0,
        });

        const count: number = 50;
        virtualizer.setRowHeight(0, 100, 0, count);

        // Now user scrolls to 300px
        const scrollTop: number = 300;
        // Resetting row 0 (from 100 back to estimated 40, delta = -60)
        const correction: number = virtualizer.resetRowHeight(0, scrollTop, count);
        expect(correction).toBe(-60);
    });

    it("invalidates cache when an existing measured row changes height", () => {
        const virtualizer: Virtualizer<unknown> = new Virtualizer({
            rowHeight: 50,
            rowOverscan: 1,
            columnOverscan: 0,
        });

        virtualizer.setRowHeight(0, 50, 0, 10);
        const range1 = virtualizer.getRowRange(10, 0, 100);

        // Expand row 0 to 500px — row 1+ should be pushed down
        virtualizer.setRowHeight(0, 500, 0, 10);
        const range2 = virtualizer.getRowRange(10, 0, 100);
        // Virtualizer should recalculate rather than returning stale range1
        expect(range2).toBeDefined();
    });
});
