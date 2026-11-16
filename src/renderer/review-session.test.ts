import { expect, it, vi } from "vitest";
import type { DesktopApi } from "../bridge/index.js";
import type { ReviewScope } from "./review-actions.js";
import { reviewSession } from "./review-session.js";

const scope: ReviewScope = {
  kind: "relay",
  conversationId: "relay",
  generation: 1,
  targetId: "target",
  reviewId: "review",
};
it("returns idle cache size to its bound after many retained controls are unmounted", () => {
  const api = {} as DesktopApi;
  const mounted = Array.from({ length: 256 }, (_, i) => {
    const owner = { ...scope, reviewId: `mounted-${i}` };
    const session = reviewSession(api, owner);
    return { owner, session, unsubscribe: session.subscribe(() => {}) };
  });
  for (const session of mounted) session.unsubscribe();
  reviewSession(api, { ...scope, reviewId: "next" });
  const evicted = mounted[64];
  if (!evicted) throw new Error("Missing cache fixture");
  expect(reviewSession(api, evicted.owner)).not.toBe(evicted.session);
});
it("shares pending operations and completion hints between conversation and history controls without replay", async () => {
  const api = {} as DesktopApi;
  const chat = reviewSession(api, scope);
  const history = reviewSession(api, { ...scope });
  expect(chat).toBe(history);
  const listener = vi.fn();
  const stop = history.subscribe(listener);
  let finish = (_: string) => {};
  const pending = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const action = vi.fn(() => pending);
  const first = chat.run(action);
  expect(history.snapshot()).toEqual({ busy: true, revision: 1 });
  expect(await history.run(action)).toBeUndefined();
  expect(action).toHaveBeenCalledTimes(1);
  finish("applied");
  expect(await first).toBe("applied");
  expect(history.snapshot()).toEqual({ busy: false, revision: 2 });
  expect(listener).toHaveBeenCalledTimes(2);
  stop();
  await expect(history.run(() => Promise.reject(new Error("cancelled")))).rejects.toThrow(
    "cancelled",
  );
  expect(history.snapshot().busy).toBe(false);
  expect(listener).toHaveBeenCalledTimes(2);
});
it("isolates targets, generations, database replacements and API owners", () => {
  const api = {} as DesktopApi;
  const first = reviewSession(api, scope);
  expect(reviewSession(api, { ...scope, targetId: "other" })).not.toBe(first);
  expect(reviewSession(api, { ...scope, generation: 2 })).not.toBe(first);
  expect(reviewSession({} as DesktopApi, scope)).not.toBe(first);
  const project: ReviewScope = {
    kind: "project",
    project: "/same",
    projectId: "runtime",
    databaseEpoch: 1,
    chatId: "chat",
    reviewId: "review",
    live: true,
  };
  const owner = reviewSession(api, project);
  expect(reviewSession(api, { ...project, databaseEpoch: 2 })).not.toBe(owner);
  expect(reviewSession(api, { ...project, projectId: "replacement" })).not.toBe(owner);
});
it("bounds idle cached sessions without evicting a mounted or pending owner", async () => {
  const api = {} as DesktopApi;
  const observed = reviewSession(api, scope);
  const unsubscribe = observed.subscribe(() => {});
  const busyScope = { ...scope, reviewId: "busy" };
  const busy = reviewSession(api, busyScope);
  let finish = () => {};
  const task = busy.run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const idleScope = { ...scope, reviewId: "old-idle" };
  const idle = reviewSession(api, idleScope);
  for (let i = 0; i < 300; i++) reviewSession(api, { ...scope, reviewId: `review-${i}` });
  expect(reviewSession(api, scope)).toBe(observed);
  expect(reviewSession(api, busyScope)).toBe(busy);
  expect(reviewSession(api, idleScope)).not.toBe(idle);
  finish();
  await task;
  unsubscribe();
});
