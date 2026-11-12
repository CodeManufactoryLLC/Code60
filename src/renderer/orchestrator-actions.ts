import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { DesktopApi, OrchestrationChatAction } from "../bridge/index.js";
import { ScopeLifetime } from "./scope-lifetime.js";

interface State {
  pending: OrchestrationChatAction["type"] | null;
  error: string;
}

/** Conversation actions never inherit the active project's worker recovery policy. */
export class OrchestratorActions extends ScopeLifetime {
  private state: State = { pending: null, error: "" };
  private listeners = new Set<() => void>();
  constructor(
    private api: Pick<DesktopApi, "orchestrationChatAction">,
    identity: string,
    private enabled: boolean,
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
    this.publish({ ...this.state, pending: null });
  }
  setError = (error: string) => {
    if (this.capture()()) this.publish({ ...this.state, error });
  };
  action = async (request: OrchestrationChatAction): Promise<boolean> => {
    const current = this.capture();
    if (!this.enabled || !current() || this.state.pending !== null) return false;
    this.publish({ pending: request.type, error: "" });
    try {
      await this.api.orchestrationChatAction(request);
      return current();
    } catch (cause) {
      if (current()) this.setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      if (current()) this.publish({ ...this.state, pending: null });
    }
  };
}
export function useOrchestratorActions(api: DesktopApi, database: string | null, key: string) {
  const owner = useMemo(
    () => new OrchestratorActions(api, key, database !== null),
    [api, database, key],
  );
  useEffect(() => {
    owner.activate();
    return () => owner.dispose();
  }, [owner]);
  const state = useSyncExternalStore(owner.subscribe, owner.snapshot, owner.snapshot);
  return { ...state, action: owner.action, setError: owner.setError };
}
