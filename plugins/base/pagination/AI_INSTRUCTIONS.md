# @omnigrid/pagination-plugin — package instructions

Read the repository-root [`../../../AI_INSTRUCTIONS.md`](../../../AI_INSTRUCTIONS.md) first.

## Purpose

Headless pagination. Client mode slices data through a data processor; server mode only reports
page/size changes. Pager UI is declarative headless content mounted into a grid slot.

## Rules

- Client mode: register a data processor that returns the current page slice; call `api.refresh()`
  (or re-set data) so the viewport recomputes after page changes.
- Server mode: DO NOT slice data; call `onChange({ page, pageSize })`, expose `setTotalRows(total)`,
  and keep `totalRows` for page-count math.
- `pageSize: 0` = auto-fit: compute rows from the viewport height minus header rows
  (leaf header + group header rows).
- UI = Slot System only. Mount a pager into the `"top"` / `"bottom"` slot using declarative
  `SlotNodeContent` trees (buttons, inputs, text labels) and `api.icons.get("chevron-first" |
  "chevron-left" | "chevron-right" | "chevron-last")` — never raw DOM.
- Blocks (`rowInfo`, `pageSize`, `navigation`) are configured via the core `BlockConfig` type
  (`slot`, `position`, `priority`, `name`); ordering/placement is data, not code.
- Custom icons, labels, and page-size choices are plugin options; default SVG icons come from the
  core `IconRegistry` (registerable via `api.icons`).
- `register()` returns a cleanup that unmounts the slot content and unregisters the processor.

## Tests

`npm test` (vitest, node env). Reference: `src/index.test.ts`.