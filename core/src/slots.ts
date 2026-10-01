import type {
    SlotMount,
    SlotMountOptions,
    SlotName,
    SlotProvider,
} from "./types";

export interface SlotManagerOptions<T> {
    /**
     * Called after each slot mount change. The grid uses this hook to
     * emit a `slotsChange` event and wake up the adapter.
     */
    onChange?: (slot: SlotName, mounts: SlotMount<T>[]) => void;
}

/**
 * Slot manager (`top`, `bottom`, `left`, `right`).
 *
 * Plugins mount their widgets via `api.slots.mount(...)` — the core stores
 * only a headless description (`SlotContent`) and materializes it through the
 * adapter. Order within a slot is controlled by `priority`, alignment by
 * `position`.
 */
export class SlotManager<T> {
    private readonly mounts = new Map<SlotName, SlotMount<T>[]>();
    private readonly onChange: SlotManagerOptions<T>["onChange"];
    private sequence = 0;

    public constructor(options: SlotManagerOptions<T> = {}) {
        this.onChange = options.onChange;
    }

    /**
     * Mounts content in a slot. If an `id` matches an existing mount, it is
     * replaced. Returns a handle with `unmount()`.
     */
    public mount(slot: SlotName, content: SlotProvider<T>, options: SlotMountOptions = {}): SlotMount<T> {
        const id = options.id ?? `${slot}-${++this.sequence}`;
        const priority = options.priority ?? 0;
        const position = options.position ?? "start";

        const slotMounts = (this.mounts.get(slot) ?? []).filter((existing) => existing.id !== id);
        const mount: SlotMount<T> = {
            id,
            slot,
            content,
            priority,
            position,
            unmount: () => {
                this.unmount(slot, id);
            },
        };

        slotMounts.push(mount);
        slotMounts.sort((left, right) => (left.priority === right.priority ? 0 : left.priority < right.priority ? -1 : 1));
        this.mounts.set(slot, slotMounts);

        this.onChange?.(slot, this.getMounts(slot));
        return mount;
    }

    /** Removes a mount by id within a slot. Returns true if found. */
    public unmount(slot: SlotName, id: string): boolean {
        const slotMounts = this.mounts.get(slot);
        if (!slotMounts) return false;

        const next = slotMounts.filter((existing) => existing.id !== id);
        if (next.length === slotMounts.length) return false;

        this.mounts.set(slot, next);
        if (next.length === 0) this.mounts.delete(slot);
        this.onChange?.(slot, this.getMounts(slot));
        return true;
    }

    /** Sorted copy of mounts for the slot. */
    public getMounts(slot: SlotName): SlotMount<T>[] {
        return [...(this.mounts.get(slot) ?? [])];
    }

    public hasMounts(slot: SlotName): boolean {
        return (this.mounts.get(slot)?.length ?? 0) > 0;
    }

    public clear(slot?: SlotName): void {
        if (slot) {
            if (this.mounts.delete(slot)) this.onChange?.(slot, []);
            return;
        }
        const affected = [...this.mounts.keys()];
        this.mounts.clear();
        affected.forEach((affectedSlot) => this.onChange?.(affectedSlot, []));
    }

    public size(slot?: SlotName): number {
        if (slot) return this.mounts.get(slot)?.length ?? 0;
        return [...this.mounts.values()].reduce((total, items) => total + items.length, 0);
    }
}
