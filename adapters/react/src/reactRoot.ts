import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

/**
 * Reusable React root, mounted in an isolated DOM element (a cell in the
 * pool). One root lives as long as the cell exists: on scroll, React does NOT
 * recreate the node — it only updates content via `root.render`.
 */
export interface CellRoot {
    render(content: ReactNode): void;
    unmount(): void;
}

export function createCellRoot(container: Element): CellRoot {
    const root = createRoot(container);
    return {
        render: (content) => root.render(content),
        unmount: () => root.render(null),
    };
}
