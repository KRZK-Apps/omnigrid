# @omnigrid/react

React adapter and renderer for OmniGrid. Renders the headless core engine into the DOM using React.

## What it provides

- **`<OmniGrid />`** — React component that accepts `GridOptions` and renders a fully virtualized, 2D scrolled data grid
- **`useGrid()`** — hook that creates and manages a `GridCore` instance with full lifecycle handling
- **Cell / Row pooling** — reusable React content via DOM-pool integration for minimal re-renders
- **Styles and default theme** — required structural styles and light/dark default colors are included automatically
- **`transpilePackages`-ready** — works out of the box with Next.js and other bundlers

## Usage

```tsx
import { OmniGrid } from "@omnigrid/react";
import { useMemo } from "react";

const columns = useMemo(() => [...], []);
const data = [...];

<OmniGrid columns={columns} data={data} />;
```

## Overlays

The adapter renders body-only overlays below the sticky header. While one is active, vertical
scrolling and its scrollbar are disabled; horizontal scrolling remains available for
`noMatchingRows` (or when `blockScroll: false`). Use `scope: "full"` to cover the header and
body as well.

```tsx
import { OmniGrid, type OverlayComponentProps } from "@omnigrid/react";

function LoadError<T>({ message }: OverlayComponentProps<T>) {
    return <div role="alert">{message ?? "Unable to load rows"}</div>;
}

<OmniGrid
    columns={columns}
    data={data}
    overlayComponents={{ error: LoadError }}
    onGridReady={(grid) => grid.showOverlay({ type: "error", message: "Please retry" })}
/>;
```

To customize the table's color style, install a compatible `@omnigrid/*-theme`
package and import it in the application after `@omnigrid/react`. Theme packages
include their own light and dark variants; they are not light/dark mode toggles.

## Links

- **Source:** https://github.com/KRZK-Apps/omnigrid/tree/main/adapters/react
- **Demo:** https://omnigrid-demo.vercel.app/
- **Issues:** https://github.com/KRZK-Apps/omnigrid/issues

## License

MIT © KRZK Apps
