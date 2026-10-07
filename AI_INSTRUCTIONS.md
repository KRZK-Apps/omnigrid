# AI Agent Instructions — OmniGrid Monorepo

Ground rules for any agent (or human) editing this repository. Read this file before touching code.
It is the single source of truth; `.cursorrules` at the repository root is a short pointer to it.

## 1. Repository layout

This repo publishes the installable `@omnigrid/*` packages. Each package may carry its own
`AI_INSTRUCTIONS.md` — when present, read it together with this file.

| Path | Package(s) | Responsibility |
|------|-----------|----------------|
| `core/` | `@omnigrid/core` | Framework-agnostic engine: state, events, data pipeline, 2D virtualization, DOM-pool mapping, slots, icons, plugins. MIT, zero deps. |
| `adapters/react/` | `@omnigrid/react` | Thin React adapter/renderer. The only layer that may touch the DOM. |
| `plugins/base/sorting/` | `@omnigrid/sorting-plugin` | Free MIT plugin: column sorting. |
| `plugins/base/selection/` | `@omnigrid/selection-plugin` | Free MIT plugin: row/cell selection + checkbox column. |
| `plugins/base/pagination/` | `@omnigrid/pagination-plugin` | Free MIT plugin: client/server pagination + pager in a slot. |
| `plugins/pro/` | — | Empty public **stub**; commercial code lives in the private `omnigrid-pro/` repo (excluded from workspaces to avoid a naming clash). |
| `style/` | `@omnigrid/style` | Structural CSS consumed via `--omnigrid-*` theme variables. |
| `themes/default/`, `themes/mint/` | `@omnigrid/default-theme`, `@omnigrid/mint-theme` | Colors via CSS custom properties (light + dark). |


Packages communicate through their published `@omnigrid/*` package exports only — no cross-folder
relative imports outside a package.

## 2. The one architecture rule: Core is headless

`omnigrid/core` MUST:

- NOT import DOM globals (`document`, `window`, `Event`, `HTMLElement`, …) — core runs in Node tests without a browser;
- NOT import any UI framework (React / Vue / Svelte) — not even types;
- NOT mutate or query the DOM — viewport dimensions and scroll feed in through explicit API calls (`setViewport`, `getScrollPosition`), DOM effects happen through adapter-injected bindings;
- NOT import any runtime dependency (package has zero deps).

All code that touches the DOM belongs exclusively in `omnigrid/adapters/react/**`
(and future `adapters/vue`, `adapters/svelte`, …).

## 3. Adapters are thin

An adapter is allowed to:

- create a `Grid` instance from `GridOptions`;
- subscribe to structural changes (revision-based) and feed viewport geometry / row measurements into the core;
- provide `DomPoolBindings` (create/bind/transform/recycle row nodes) and render cell/header/slot content natively.

The adapter MUST NOT re-implement sorting, filtering, grouping, pagination, or virtualization.
Any such logic inside a UI adapter is a bug. Adapters must not re-render on scroll frames —
scroll position is ephemeral in the core (see §4).

## 4. State model: Store vs ephemeral

- `GridState<T>` (`getState()`): `{ data, columns, viewport, rowHeight, rowOverscan, columnOverscan }` — observable;
  mutations notify store subscribers and emit `stateChange`.
- **Scroll position is ephemeral.** `scrollTop`/`scrollLeft` are NOT in the Store; scroll-only
  `setViewport({ scrollTop, scrollLeft })` updates bypass Store notification. Read via `getScrollPosition()`.
  Do not move scroll into the Store.
- `getRevision()` — monotonic counter bumped on structural changes (setData / setColumns / refresh).
  Adapters use it to decide "must rebind DOM". Presentation hints (row/cell classes, styles, slot mounts)
  are applied on the viewport commit.

## 5. The Data Pipeline

`raw data → data processors (filter → sort → group → paginate) → processed data → virtual viewport`.

- Plugins attach pure, synchronous transforms via `api.registerDataProcessor((data: T[]) => T[])`,
  executed in registration order. The sorting plugin is the reference implementation.
- `getProcessedData()` returns the current processed array; `getViewportData()` virtualizes it.
- Caches are invalidated on `setData`, `setColumns`, and processor registration/removal.
- Pipeline stages are plugin responsibilities, not core features.

## 6. Writing plugins

Every plugin implements the core contract:

```ts
import type { GridApi, GridPlugin } from "@omnigrid/core";

class MyPlugin<T> implements GridPlugin<T> {
    readonly name = "@omnigrid/my-plugin";      // unique, namespaced
    register(api: GridApi<T>): () => void {
        const offEvent = api.on("headerClick", (e) => this.toggle(e.columnId));
        const offProcessor = api.registerDataProcessor((data) => this.transform(data));
        const mount = api.slots.mount("bottom", (ctx) => this.renderControls(ctx));
        return () => { offEvent(); offProcessor(); mount.unmount(); };  // full cleanup
    }
}
```

Rules:

- Plugin source MUST stay framework-agnostic: it imports only from `@omnigrid/core` (types + helpers like
  `flattenColumns`, `isColumnGroup`) — never adapters, never DOM APIs.
- Interact with the grid exclusively through `GridApi`: `on(...)` events, `registerDataProcessor(...)`,
  `slots.mount(...)`, `icons.register(...)`, `getState()` / `setData(...)` / `setColumns(...)`.
- `register()` must be safe to call once per grid and MUST return a cleanup that tears down every
  subscription/mount it created (mirror the unregister pattern in the sorting plugin).
- Construct one plugin instance per grid (pattern used across the demo: `useMemo(() => new MyPlugin<T>(), [])`)
  and pass it via `options.plugins`.
- Public methods and options get `@api` doc comments — plugin API pages on the demo site are generated
  from them (`npm run generate:plugin-docs`, run in the workspace).
- Every plugin ships a vitest suite (headless, no DOM).
- Base plugins: MIT, live under `plugins/base/*`. Pro plugins: commercial, private repo,
  see §9. `getRowClass` / `getRowStyle` only return class/style *hints*; actual colors live in themes.
## 7. Slot Architecture

- Zones: `top | bottom | left | right`. Within a slot, content is ordered by `priority` (ascending)
  and aligned by `position` (`"start" | "center" | "end"`).
- Plugins mount **headless descriptors**, never raw DOM:

```ts
api.slots.mount("bottom", () => ({
    type: "node",
    tag: "button",
    attrs: { type: "button", class: "omnigrid-icon-button" },
    on: { click: () => this.nextPage() },
    children: [api.icons.get("chevron-right")],
}), { id: "next-btn", priority: 10, position: "start" });
```

- Content protocol (`SlotContent`), materialized by the adapter:
  - `string | number` → plain text;
  - `{ type: "html", html }` → HTML fragment (via `innerHTML`);
  - `{ type: "node", tag, attrs, on, children }` → declarative DOM node (no framework required);
  - `{ type: "component", kind, payload }` → native component from the adapter `slotComponents` registry;
  - any other object → framework-native value (in React: a `ReactNode`).
- A plugin must not imperatively create DOM; declare content and let the adapter render it.

## 8. Styling

- Positioning uses absolute coordinates + `transform: translateY(...)` for row recycling; column widths
  flow through CSS variables so resizing needs no per-cell DOM rewrite.
- Shared structural styles live in `style/`; themes (`themes/*`) own colors via CSS custom properties
  (prefix `--omnigrid-*`). Public class prefix: `omnigrid-`.
- Core code never emits styles or touches the DOM.

## 9. Pro plugins & license validation

Pro = commercial plugins in the private `omnigrid-pro/` repo (a sibling of this repository), package
`@omnigrid/plugin-pro` (license `SEE LICENSE IN LICENSE.PRO.md`). `plugins/pro/` in THIS repo is a
stub and must stay empty of logic.

License model — **offline, local cryptographic validation**:

- The license is a signed token issued by the licensing service and transferred to the customer at
  purchase time, e.g. `base64(payload) + "." + base64(signature)`.
- Payload: `{ licensee, tier, pluginIds: string[], issuedAt, expiresAt }`. Signature: **Ed25519**
  over the payload bytes. The Pro package embeds the **public** verification key.
- Verification happens **at load / `register()` time, locally**, via the Web Crypto API
  (`crypto.subtle.verify`). **No network calls at runtime** — offline-friendly, no telemetry, no latency.
- Constructor contract: `new SomeProPlugin({ licenseKey: string, ...options })`. Verify in the
  constructor; on any failure throw `OmniGridLicenseError` (exported from the Pro package) and never
  register/enable the premium feature. The base grid keeps functioning.
- Never embed private keys, never add license logic to `@omnigrid/core`, `@omnigrid/react`, or base
  plugins — core stays MIT and license-agnostic. Shared validation helpers (token parsing / signature
  check) belong inside the private Pro repo only.

## 10. Testing & quality gates

- `npm test` runs vitest for core, every base plugin, and react. Core/plugin tests must run DOM-less.
- New features require unit tests; reference suites:
  `core/src/*.test.ts`, `plugins/base/sorting/src/sorting.test.ts`,
  `plugins/base/selection/src/selection.test.ts`, `plugins/base/pagination/src/index.test.ts`.
- Run `tsc` build (`npm run build` per package, or workspace `npm run build:all`) to validate TypeScript
  across packages and `npm run generate:plugin-docs` (workspace) when public API doc comments change.

## 11. Conventions

- Strict TypeScript (`strict: true` in every package), ESNext modules, no `any` leaks on public API.
- Keep Prettier/ESLint settings; follow the existing style (arrow functions, 4-space indent in TS).
- Public API = TypeScript interfaces + `@api` doc comments. Update package READMEs and
  `AI_INSTRUCTIONS.md` files when public contracts change.
- Before implementing, read `core/README.md` and the existing types — the architecture is encoded
  in the current contracts, and new code must extend them consistently.