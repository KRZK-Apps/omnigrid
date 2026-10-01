export class EventBus<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(payload: unknown) => void>>();

  public on<EventName extends keyof Events>(
    event: EventName,
    listener: (payload: Events[EventName]) => void,
  ): () => void {
    let eventListeners = this.listeners.get(event);
    if (!eventListeners) {
      eventListeners = new Set();
      this.listeners.set(event, eventListeners);
    }

    eventListeners.add(listener as (payload: unknown) => void);
    return () => {
      eventListeners?.delete(listener as (payload: unknown) => void);
    };
  }

  public emit<EventName extends keyof Events>(event: EventName, payload: Events[EventName]): void {
    this.listeners.get(event)?.forEach((listener) => listener(payload));
  }

  public clear(): void {
    this.listeners.clear();
  }
}
