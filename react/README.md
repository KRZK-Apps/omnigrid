# @omnigrid/react

React adapter and renderer for OmniGrid. Renders the headless core engine into the DOM using React.

## What it provides

- **`<OmniGrid />`** — React component that accepts `GridOptions` and renders a fully virtualized, 2D scrolled data grid
- **`useGrid()`** — hook that creates and manages a `GridCore` instance with full lifecycle handling
- **Cell / Row pooling** — reusable React content via DOM-pool integration for minimal re-renders
- **`transpilePackages`-ready** — works out of the box with Next.js and other bundlers

## Usage

```tsx
import { OmniGrid } from "@omnigrid/react";
import { useMemo } from "react";

const columns = useMemo(() => [...], []);
const data = [...];

<OmniGrid columns={columns} data={data} />;
```

## Links

- **Source:** https://github.com/KRZK-Apps/omnigrid/tree/main/react
- **Demo:** https://omnigrid-demo.vercel.app/
- **Issues:** https://github.com/KRZK-Apps/omnigrid/issues

## License

MIT © KRZK Apps
