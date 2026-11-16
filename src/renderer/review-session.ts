import type { DesktopApi } from "../bridge/index.js";
import type { ReviewScope } from "./review-actions.js";

/** Presentation coordination only; the host still validates and authorizes every action. */
export function reviewScopeKey(scope: ReviewScope): string {
  return JSON.stringify(
    scope.kind === "relay"
      ? [scope.kind, scope.conversationId, scope.generation, scope.targetId, scope.reviewId]
      : [scope.kind, scope.project, scope.projectId, scope.databaseEpoch, scope.reviewId],
  );
}

function createSession() {
  let state = { busy: false, revision: 0 };
  const listeners = new Set<() => void>();
  const publish = (busy: boolean) => {
    state = { busy, revision: state.revision + 1 };
    for (const listener of listeners) listener();
  };
  return {
    snapshot: () => state,
    observed: () => listeners.size > 0,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async run<T>(action: () => Promise<T>): Promise<T | undefined> {
      if (state.busy) return undefined;
      publish(true);
      try {
        return await action();
      } finally {
        publish(false);
      }
    },
  };
}
const sessions = new WeakMap<DesktopApi, Map<string, ReturnType<typeof createSession>>>();
export function reviewSession(api: DesktopApi, scope: ReviewScope) {
  let entries = sessions.get(api);
  if (!entries) {
    entries = new Map();
    sessions.set(api, entries);
  }
  const key = reviewScopeKey(scope);
  let session = entries.get(key);
  if (!session) {
    // Retain only a bounded presentation cache; in-flight entries are never evicted.
    for (const [id, item] of entries) {
      if (entries.size < 128) break;
      if (!item.snapshot().busy && !item.observed()) entries.delete(id);
    }
    session = createSession();
    entries.set(key, session);
  }
  return session;
}
