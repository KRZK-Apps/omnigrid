# OmniGrid AI Coding & Plugin Development Instructions

You are working on **OmniGrid**, a high-performance, framework-agnostic headless data grid library with a modular plugin system. 

## 1. Core Architectural Principles

- **Headless Architecture:** The core engine is completely decoupled from any UI rendering layer (React, Vue, Svelte, etc.). The core manages data, state, sorting, filtering, and geometry, but **never** mutates the DOM directly.
- **Pure TypeScript Core:** `packages/core` contains the State Manager, Data Processing Pipeline, Virtualization Engine, and Event Bus. 
- **Performance First:** Implement 2D virtualization, CSS variables for reactive sizing, and DOM-recycling patterns where applicable[cite: 1]. Avoid heavy re-renders in core logic.
- **Monorepo Structure:**
  - `packages/core`: Framework-agnostic engine.
  - `packages/plugins/base`: Free, standard plugins (e.g., Pagination, Sorting, Filtering).
  - `packages/plugins/pro`: Commercial, paid plugins utilizing local cryptographic license verification[cite: 1].
  - `packages/react`: Thin UI adapter layer for React[cite: 1].

---

## 2. Plugin Development Guidelines

Every plugin (whether Base or Pro) must follow strict architectural contracts to ensure interoperability and performance.

### A. Plugin Interface & Lifecycle
A plugin must implement the `GridPlugin<T>` interface, exposing a `register` method that returns an unregister/cleanup function:

```typescript
import type { GridApi, GridPlugin } from "@omnigrid/core";

export interface MyPluginOptions {
    // Plugin-specific options with sensible defaults
}

export class MyPlugin<T> implements GridPlugin<T> {
    public readonly name = "@omnigrid/plugin-name";
    private api: GridApi<T> | undefined;

    public constructor(private options: MyPluginOptions = {}) {}

    public register(api: GridApi<T>): () => void {
        this.api = api;

        // 1. Register data processors, event listeners, or mount slots here
        const unregisterProcessor = api.registerDataProcessor((data) => this.processData(data));
        const unregisterEvent = api.on("someEvent", (e) => this.handleEvent(e));

        // 2. Return cleanup function
        return () => {
            unregisterProcessor();
            unregisterEvent();
            this.api = undefined;
        };
    }

    private processData(data: T[]): T[] {
        // Transform data if necessary (e.g., pagination, filtering, sorting)
        return data;
    }

    private handleEvent(e: any): void {
        // Handle grid events
    }
}