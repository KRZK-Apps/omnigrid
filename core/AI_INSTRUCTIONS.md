# @omnigrid/core — package instructions

Read the repository-root [`../AI_INSTRUCTIONS.md`](../AI_INSTRUCTIONS.md) first. This file adds
package-specific rules and overrides nothing.

## Purpose

The framework-agnostic engine: state store, typed event bus, data pipeline, 2D virtualization,
DOM-pool row mapping, slots, icons, and the plugin manager. Exposes `Grid<T>` (implements `GridApi<T>`).

## Hard constraints (non-negotiable)

- No DOM globals (`document`, `window`, `Event`, …), no UI framework imports, no runtime dependencies.
  Must compile and test in Node without a browser.
- Never mutate/query the DOM. Geometry and scroll flow in via API (`setViewport`, `getScrollPosition`).
- Anything optional is NOT core: sorting, filtering, pagination, selection are plugins.
  Core grows only when every grid needs the feature.

## How to add a core feature

1. Extend the contracts in `src/types.ts` first — types are the source of truth.
2. Implement in `src/grid.ts` (or a focused module, e.g. `virtualizer.ts`, `columns.ts`).
3. Export through `src/index.ts` (only this is public).
4. Add headless vitest coverage in `src/*.test.ts`.
5. Update `README.md` (contracts documentation) when public API changes.

## Public API

Only what `src/index.ts` exports is public: `Grid`, store/virtualizer building blocks, column
helpers (`flattenColumns`, `isColumnGroup`, …), types (`GridApi`, `GridOptions`, `ColumnDef`, …).
Keep the surface minimal; type exports carry the `@api`-style doc comments.

## Semantics to preserve

- Scroll position stays ephemeral (never move it into the Store).
- `revision` bumps on structural changes only.
- `registerDataProcessor` pipeline is synchronous and ordered.

## Tests

`npm test` (vitest, `environment: "node"`).