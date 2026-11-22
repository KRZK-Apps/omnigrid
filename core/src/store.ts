/**
 * A partial state patch, or a reducer that derives one from the current state.
 *
 * @api
 */
export type StateUpdater<State> =
    | Partial<State>
    | ((state: State) => Partial<State>);

/**
 * Options for {@link Store.setState}.
 *
 * @api
 */
export interface SetStateOptions {
    /**
     * Notify subscribers even when the patch does not change any field.
     *
     * Used for forced repaints — e.g. a geometry refresh or a slot/header
     * change — where the Store state itself is unchanged but subscribers must
     * re-read it to repaint.
     * @default false
     */
    force?: boolean;
}

/**
 * Minimal observable state container.
 *
 * `setState` performs a shallow, per-key equality check and only notifies
 * subscribers when at least one field actually changes (by reference). This
 * suppresses the redundant notifications caused by empty patches
 * (`setState({})`) and repeated writes of the same value. Callers that need an
 * unconditional notification pass `{ force: true }`.
 *
 * @api
 */
export class Store<State extends object> {
    private state: State;
    private readonly listeners = new Set<() => void>();

    public constructor(initialState: State) {
        this.state = initialState;
    }

    public getState(): State {
        return this.state;
    }

    public setState(updater: StateUpdater<State>, options?: SetStateOptions): void {
        const update: Partial<State> = typeof updater === "function" ? updater(this.state) : updater;
        if (options?.force !== true && !Store.hasChanges(this.state, update)) {
            return;
        }
        this.state = { ...this.state, ...update };
        this.listeners.forEach((listener) => listener());
    }

    public subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    public clear(): void {
        this.listeners.clear();
    }

    private static hasChanges<State extends object>(previous: State, patch: Partial<State>): boolean {
        for (const key of Object.keys(patch) as Array<keyof State>) {
            if (!Object.is(previous[key], patch[key])) return true;
        }
        return false;
    }
}
