import type { ApplicationClient } from "../bridge/index.js";
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
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    async run<T>(action: () => Promise<T>): Promise<T | undefined> {
      if (busy) return undefined;
      busy = true;
      try {
        return await action();
      } finally {
        busy = false;
      }
    },
  };
}
const sessions = new WeakMap<ApplicationClient, Map<string, ReturnType<typeof createSession>>>();
export function reviewSession(api: ApplicationClient, scope: ReviewScope) {
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
      if (!item.busy) entries.delete(id);
    }
    session = createSession();
    entries.set(key, session);
  }
  return session;
}
