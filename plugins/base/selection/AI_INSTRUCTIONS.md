# @omnigrid/selection-plugin — package instructions

Read the repository-root [`../../../AI_INSTRUCTIONS.md`](../../../AI_INSTRUCTIONS.md) first.

## Purpose

Headless row/cell selection: subscribes to `rowClick`, adds the selection checkbox column via the
`CheckboxControl` render protocol, and marks rows with CSS classes.

## Rules

- Selection state lives INSIDE the plugin (NOT in core `GridState`). Expose it synchronously via
  `getSelectionState()`, `getSelectedRowIds()`, `getSelectedRows()`.
- Subscribe with `api.on("rowClick", …)`; honor `shiftKey` (range) and `ctrlKey` (toggle) modifiers.
- Gate selection with `isRowSelectable(row, index)`; respect `mode: "single" | "multiple"`,
  `checkboxOnly`, `replaceSelectionOnClick`.
- Mark rows with classes ONLY — constants `SELECTED_ROW_CLASS = "omnigrid-row-selected"` and
  `UNSELECTABLE_ROW_CLASS = "omnigrid-row-unselectable"` — and expose them via `getRowClass()`.
  Concrete colors belong to the active THEME (`--omnigrid-cell-selected-background`,
  `--omnigrid-cell-unselectable-*`, `--omnigrid-checkbox-accent`); never hard-code colors here.
- Checkboxes render through the headless `CheckboxRenderParams` / `CheckboxControl` protocol
  (`onChange({ shiftKey, ctrlKey })`, `ariaLabel`, `indeterminate`, …).
- `register()` returns a full cleanup (unsubscribe events, restore columns).
- Public API is documented with `@api` doc comments.

## Tests

`npm test` (vitest, node env). Reference: `src/selection.test.ts`.