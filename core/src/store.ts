export type StateUpdater<State> =
  | Partial<State>
  | ((state: State) => Partial<State>);

export class Store<State extends object> {
  private state: State;
  private readonly listeners = new Set<() => void>();

  public constructor(initialState: State) {
    this.state = initialState;
  }

  public getState(): State {
    return this.state;
  }

  public setState(updater: StateUpdater<State>): void {
    const update = typeof updater === 'function' ? updater(this.state) : updater;
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
}
