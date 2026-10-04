import type { SlotNodeContent } from "./types";

export type IconName =
    | "chevron-left"
    | "chevron-right"
    | "chevron-up"
    | "chevron-down"
    | "chevron-first"
    | "chevron-last"
    | "arrow-up"
    | "arrow-down"
    | "arrow-up-down";

export type IconDefinition<T> = SlotNodeContent<T> | (() => SlotNodeContent<T>);

type IconPath = {
    tag: "path";
    attrs: { d: string };
};

interface IconEntry<T> {
    render: () => SlotNodeContent<T>;
    previous?: IconEntry<T>;
    active: boolean;
}

const DEFAULT_ICON_PATHS: Record<IconName, IconPath[]> = {
    "chevron-left": [{ tag: "path", attrs: { d: "m15 18-6-6 6-6" } }],
    "chevron-right": [{ tag: "path", attrs: { d: "m9 18 6-6-6-6" } }],
    "chevron-up": [{ tag: "path", attrs: { d: "m18 15-6-6-6 6" } }],
    "chevron-down": [{ tag: "path", attrs: { d: "m6 9 6 6 6-6" } }],
    "chevron-first": [
        { tag: "path", attrs: { d: "m17 18-6-6 6-6" } },
        { tag: "path", attrs: { d: "M7 6v12" } },
    ],
    "chevron-last": [
        { tag: "path", attrs: { d: "m7 18 6-6-6-6" } },
        { tag: "path", attrs: { d: "M17 6v12" } },
    ],
    "arrow-up": [
        { tag: "path", attrs: { d: "M12 19V5" } },
        { tag: "path", attrs: { d: "m5 12 7-7 7 7" } },
    ],
    "arrow-down": [
        { tag: "path", attrs: { d: "M12 5v14" } },
        { tag: "path", attrs: { d: "m19 12-7 7-7-7" } },
    ],
    "arrow-up-down": [
        { tag: "path", attrs: { d: "m3 16 4 4 4-4" } },
        { tag: "path", attrs: { d: "M7 20V4" } },
        { tag: "path", attrs: { d: "m21 8-4-4-4 4" } },
        { tag: "path", attrs: { d: "M17 4v16" } },
    ],
};

function createSvgIcon<T>(name: string, paths: IconPath[]): SlotNodeContent<T> {
    return {
        type: "node",
        tag: "svg",
        attrs: {
            class: `omnigrid-icon omnigrid-icon-${name}`,
            width: "16",
            height: "16",
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: "2",
            strokeLinecap: "round",
            strokeLinejoin: "round",
            "aria-hidden": "true",
        },
        children: paths.map(({ tag, attrs }) => ({ type: "node", tag, attrs })),
    };
}

/** Framework-agnostic registry of declarative SVG slot nodes. */
export class IconRegistry<T> {
    private readonly definitions = new Map<string, IconEntry<T>>();

    public constructor() {
        for (const [name, paths] of Object.entries(DEFAULT_ICON_PATHS) as [IconName, IconPath[]][]) {
            this.definitions.set(name, {
                render: () => createSvgIcon<T>(name, paths),
                active: true,
            });
        }
    }

    public has(name: string): boolean {
        return this.definitions.has(name);
    }

    public get(name: string): SlotNodeContent<T> {
        const definition = this.definitions.get(name);
        if (!definition) throw new Error(`Unknown OmniGrid icon: ${name}`);
        return definition.render();
    }

    /** Registers or replaces an icon. Unregistering restores any previous definition. */
    public register(name: string, icon: IconDefinition<T>): () => void {
        const definition: IconEntry<T> = {
            render: typeof icon === "function" ? icon : () => icon,
            previous: this.definitions.get(name),
            active: true,
        };
        this.definitions.set(name, definition);

        return () => {
            definition.active = false;
            if (this.definitions.get(name) !== definition) return;

            let previous = definition.previous;
            while (previous && !previous.active) previous = previous.previous;
            if (previous) this.definitions.set(name, previous);
            else this.definitions.delete(name);
        };
    }
}
