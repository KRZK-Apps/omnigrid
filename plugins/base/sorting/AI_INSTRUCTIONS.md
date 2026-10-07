# @omnigrid/sorting-plugin — package instructions

Read the repository-root [`../../../AI_INSTRUCTIONS.md`](../../../AI_INSTRUCTIONS.md) first.

## Purpose

Headless column sorting: registers a pure data processor and subscribes to `headerClick`.
This plugin is the **reference implementation** of the plugin contract — copy its structure.

## Reference pattern (applicable to all plugins)

- `register(api)` returns a cleanup that unregisters the processor and the event listener
  (see `src/index.ts`); never mutate core internals.
- The transform is pure and synchronous:
  `api.registerDataProcessor((data) => this.sortData(data))`.
- Sorting metadata lives on **leaf** columns (`sortable`, `sortState`); a column can be a group —
  always narrow with `flattenColumns` / `isColumnGroup` from `@omnigrid/core`.
- Header interaction: `api.on("headerClick", ({ columnId, multiSort }) => …)`; cycle state
  `asc → desc → none`, `multiSort` composes a model of multiple columns.
- Public API (`getSortModel()`, `setSortModel()`, `clearSort()`) is annotated with `@api` doc
  comments (demo plugin docs are generated from them).
- Types for the sort model live in `src/types.ts` and are re-exported.

## Rules

- No DOM, no React — the plugin only declares its model and hooks the pipeline.
- Sort indicators / header markup are provided by the core slot + icons system, not by this plugin.

## Tests

`npm test` (vitest, node env). Reference: `src/sorting.test.ts`.