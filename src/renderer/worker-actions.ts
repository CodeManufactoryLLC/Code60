import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { Action, DesktopApi } from "../bridge/index.js";
import { ScopeLifetime } from "./scope-lifetime.js";

interface State {
  busy: boolean;
  error: string;
}

/** The worker caller decides reply versus explicit continuation and recovery checks. */
export class WorkerActions extends ScopeLifetime {
  private state: State = { busy: false, error: "" };
  private listeners = new Set<() => void>();
  constructor(
    private api: Pick<DesktopApi, "action">,
    identity: string,
  ) {
    super(identity);
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: State) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  override dispose() {
    super.dispose();
    this.publish({ ...this.state, busy: false });
  }
  act = async (action: Action): Promise<boolean> => {
    const current = this.capture();
    if (!current() || this.state.busy) return false;
    this.publish({ busy: true, error: "" });
    try {
      await this.api.action(action);
      return current();
    } catch (cause) {
      if (current())
        this.publish({ busy: true, error: cause instanceof Error ? cause.message : String(cause) });
      return false;
    } finally {
      if (current()) this.publish({ ...this.state, busy: false });
    }
  };
}
export function useWorkerActions(api: DesktopApi, id: string) {
  const owner = useMemo(() => new WorkerActions(api, id), [api, id]);
  useEffect(() => {
    owner.activate();
    return () => owner.dispose();
  }, [owner]);
  const state = useSyncExternalStore(owner.subscribe, owner.snapshot, owner.snapshot);
  return { ...state, act: owner.act };
}
