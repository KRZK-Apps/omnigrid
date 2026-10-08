# @omnigrid/sorting-plugin — package instructions

Read the repository-root [`../../../AI_INSTRUCTIONS.md`](../../../AI_INSTRUCTIONS.md) first.

## Purpose

Headless column sorting: optionally registers a data processor and subscribes to `headerClick`.
This plugin is the **reference implementation** of the plugin contract — copy its structure.

## Reference pattern (applicable to all plugins)

- `register(api)` returns a cleanup that unregisters the processor and the event listener
  (see `src/index.ts`); never mutate core internals.
- Client mode registers a pure synchronous transform:
  `api.registerDataProcessor((data) => this.sortData(data))`; server mode must not
  register a processor and instead reports changes through `sortingChanged` and `onChange`.
- Sorting metadata lives on **leaf** columns (`sortable`, `sortState`, `sortIndex`); a column can be a group —
  always narrow with `flattenColumns` / `isColumnGroup` from `@omnigrid/core`.
- Header interaction: `api.on("headerClick", ({ columnId, multiSort }) => …)`; `tristate`
  controls whether the cycle includes `none`, and `multiSort` composes a model of multiple columns.
- Public API (`getSortModel()`, `setSortModel()`, `clearSort()`) is annotated with `@api` doc
  comments (demo plugin docs are generated from them).
- Types for the sort model live in `src/types.ts` and are re-exported.

## Rules

- No DOM, no React — the plugin only declares its model and hooks the pipeline.
- Sort indicators / header markup are provided by the core slot + icons system, not by this plugin.

## Tests

`npm test` (vitest, node env). Reference: `src/sorting.test.ts`.