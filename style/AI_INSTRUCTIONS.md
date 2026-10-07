# @omnigrid/style — package instructions

Read the repository-root [`../AI_INSTRUCTIONS.md`](../AI_INSTRUCTIONS.md) first.

## Purpose

Required structural CSS for every OmniGrid grid: layout and component rules. Colors are NOT defined
here — they come from a theme package via CSS custom properties.

## Rules

- All selectors use the `omnigrid-` prefix (`.omnigrid`, `.omnigrid-row`, `.omnigrid-header-cell`,
  `.omnigrid-icon-button`, …) and the ARIA roles used by the adapter (`[role="cell"]`, …).
- Geometry: the virtualized viewport uses absolute positioning; rows are moved with
  `transform: translateY(...)` — never layer geometry on `top` in CSS.
- Layout/value tokens are consumed from `--omnigrid-*` variables set by themes and the adapter;
  do not hard-code pixel/color values that belong to a theme.
- Semantic classes (`omnigrid-row-selected`, `omnigrid-row-unselectable`, `omnigrid-row-hover`)
  only apply theming hooks:
  ```css
  .omnigrid-row-selected [role="cell"] { background: var(--omnigrid-cell-selected-background); }
  ```
  The plugin adds the class; the theme owns the color.
- Package `src/index.css` (entry) + `src/index.js` (re-export for `import "@omnigrid/style"`).

## Build

`npm run build` — copies/proceses the CSS into `dist/`. Structural styles are consumed automatically
by `@omnigrid/react`. No tests required (static CSS), but keep valid CSS and Prettier formatting.