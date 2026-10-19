# @omnigrid/quick-filter-plugin

Headless quick filter plugin for OmniGrid. Mounts a search input into the top or bottom slot of the grid and filters rows across all searchable columns.

## Features

- **Multi-term search**: Splits query strings by commas (e.g. `"Alice, Engineer"`) for case-insensitive matching across columns.
- **Searchable opt-out**: Columns with `searchable: false` are completely excluded.
- **Computed cell support**: Automatically evaluates `valueGetter` when present.
- **Debounced input**: Configurable debounce interval (default 150ms).
- **Slot placement**: Mounts into `"top"`, `"bottom"` (`"down"`), `"bodyTop"`, or `"bodyBottom"`.

## Installation

```bash
npm install @omnigrid/quick-filter-plugin
```

## Usage

```typescript
import { Grid } from "@omnigrid/core";
import { QuickFilterPlugin } from "@omnigrid/quick-filter-plugin";

const plugin = new QuickFilterPlugin({
    slot: "top",
    debounceMs: 150,
    placeholder: "Quick filter...",
});

const grid = new Grid({
    columns: [
        { id: "name", field: "name", header: "Name" },
        { id: "secret", field: "secret", header: "Secret", searchable: false },
    ],
    data,
    plugins: [plugin],
});
```
