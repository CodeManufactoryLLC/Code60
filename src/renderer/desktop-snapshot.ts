import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { DesktopApi, Snapshot } from "../bridge/index.js";
import { applyUpdate, type DesktopState } from "./snapshot-state.js";
import { startSnapshotStream } from "./snapshot-stream.js";

function hasGap(state: DesktopState, update: Snapshot): boolean {
  return (
    update.revision > state.snapshot.revision &&
    update.previousRevision !== undefined &&
    update.previousRevision > state.snapshot.revision
  );
}

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
  start(
    api: Pick<DesktopApi, "subscribe" | "snapshot" | "appSummary">,
    fail: (message: string) => void,
  ) {
    return startSnapshotStream({
      subscribe: (listener) => api.subscribe(listener),
      read: () => (api.appSummary ? api.appSummary() : api.snapshot()),
      current: this.snapshot,
      merge: applyUpdate,
      hasGap,
      publish: (state) => this.publish(state),
      fail,
    });
  }
}

export function useDesktopSnapshot(api: DesktopApi, fail: (message: string) => void) {
  const store = useMemo(() => new SnapshotStore(), []);
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  useEffect(() => store.start(api, fail), [api, fail, store]);
  return { state, accept: store.accept };
}
