# @omnigrid/mint-theme — package instructions

Read the repository-root [`../../../AI_INSTRUCTIONS.md`](../../../AI_INSTRUCTIONS.md) first.
Identical rules apply to `themes/default/`.

## Purpose

Color theme for OmniGrid: defines the `--omnigrid-*` CSS custom properties for light and dark
variants. No layout or geometry.

## Rules

- Define ALL variables consumed by `@omnigrid/style`, `@omnigrid/react`, and the base plugins:
  `--omnigrid-grid-background`, `--omnigrid-grid-border`, `--omnigrid-cell-*` (background, border,
  color, hover, selected, unselectable), `--omnigrid-checkbox-accent`, `--omnigrid-header-*`,
  `--omnigrid-slot-background`, `--omnigrid-button-*` (see the existing theme for the full set).
- Ship light (default `:root`) and dark (`.dark` selector) variants in `src/index.css`.
- Never add structural rules or hard-coded layout — only colors.
- Package is imported by the consumer AFTER `@omnigrid/react` (or `@omnigrid/style`) so its
  variables override nothing and simply supply values.

## Build

`npm run build` — compiles the theme to `dist/`. No tests required.