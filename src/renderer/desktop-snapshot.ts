import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { DesktopApi, Snapshot } from "../bridge/index.js";
import { applyUpdate, type DesktopState } from "./snapshot-state.js";

/** The stream and explicit snapshot refreshes share one revision-aware owner. */
export class SnapshotStore {
  private state: DesktopState | undefined;
  private listeners = new Set<() => void>();
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  accept = (update: Snapshot) => this.publish(applyUpdate(this.state, update));
  private publish(next: DesktopState) {
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  start(api: Pick<DesktopApi, "subscribe" | "snapshot">, fail: (message: string) => void) {
    let disposed = false;
    let initialized = false;
    const buffered: Snapshot[] = [];
    const off = api.subscribe((update) => {
      if (disposed) return;
      if (!initialized) buffered.push(update);
      else this.accept(update);
    });
    void api
      .snapshot()
      .then((initial) => {
        if (disposed) return;
        let next = applyUpdate(this.state, initial);
        for (const update of buffered) next = applyUpdate(next, update);
        buffered.length = 0;
        initialized = true;
        this.publish(next);
      })
      .catch((cause: unknown) => {
        if (disposed) return;
        disposed = true;
        buffered.length = 0;
        off();
        fail(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      if (!disposed) off();
      disposed = true;
      buffered.length = 0;
    };
  }
}

export function useDesktopSnapshot(api: DesktopApi, fail: (message: string) => void) {
  const store = useMemo(() => new SnapshotStore(), []);
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  useEffect(() => store.start(api, fail), [api, fail, store]);
  return { state, accept: store.accept };
}
