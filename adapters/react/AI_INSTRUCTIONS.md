# @omnigrid/react — package instructions

Read the repository-root [`../../AI_INSTRUCTIONS.md`](../../AI_INSTRUCTIONS.md) first. This file adds
package-specific rules.

## Purpose

The React adapter: renders the headless `Grid` into the DOM. This is the ONLY package in this
repository that may touch the DOM.

## Rules

- NEVER re-implement sorting / filtering / grouping / pagination / virtualization — delegate to core.
- Do not re-render on scroll: subscribe to structural changes (revision-based), not scroll frames.
  Feed scroll to the core imperatively via `Grid.setViewport`.
- Rows come from the DOM pool: create/bind/transform/recycle through `DomPoolBindings`;
  position rows with `transform: translateY(...)`.
- Cell content: mount framework components into pooled cells via isolated `ReactDOM.createRoot`
  portals (see `reactRoot.ts`) — only for cells entering the viewport.
- Slots: implement the `SlotContent` materialization protocol (text / html / node / component /
  framework-native) and render mounted slots; the `slotComponents` registry serves `{ type: "component" }`.
- Keep the exported API minimal: `OmniGrid`, `useGrid`, `GridProps`, `SlotRendererRegistry`,
  plus re-exports of core types (`ColumnDef`, …) for consumer convenience.

## Rough file map

- `OmniGrid.tsx` — main component: row layers (DOM pools), header, slots, viewport wiring.
- `useGrid.ts` — core lifecycle (`useSyncExternalStore`) + geometry feeding.
- `pooledRow.tsx`, `reactRoot.ts`, `content.ts`, `groupHeader.ts` — rendering support.

## Tests

`npm test` (vitest, React environment). Keep at least one test per public entry point.