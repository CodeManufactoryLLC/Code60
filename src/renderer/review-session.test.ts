import { expect, it, vi } from "vitest";
import type { ApplicationClient } from "../bridge/index.js";
import type { ReviewScope } from "./review-actions.js";
import { reviewSession } from "./review-session.js";

const scope: ReviewScope = {
  kind: "relay",
  conversationId: "relay",
  generation: 1,
  targetId: "target",
  reviewId: "review",
};
it("shares pending recovery between controls without replay", async () => {
  const api = {} as ApplicationClient;
  const chat = reviewSession(api, scope);
  const history = reviewSession(api, { ...scope });
  expect(chat).toBe(history);
  let finish = (_: string) => {};
  const pending = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const action = vi.fn(() => pending);
  const first = chat.run(action);
  expect(history.busy).toBe(true);
  expect(await history.run(action)).toBeUndefined();
  expect(action).toHaveBeenCalledTimes(1);
  finish("recovered");
  expect(await first).toBe("recovered");
  expect(history.busy).toBe(false);
  await expect(history.run(() => Promise.reject(new Error("cancelled")))).rejects.toThrow(
    "cancelled",
  );
  expect(history.busy).toBe(false);
});
it("isolates targets, generations, database replacements and API owners", () => {
  const api = {} as ApplicationClient;
  const first = reviewSession(api, scope);
  expect(reviewSession(api, { ...scope, targetId: "other" })).not.toBe(first);
  expect(reviewSession(api, { ...scope, generation: 2 })).not.toBe(first);
  expect(reviewSession({} as ApplicationClient, scope)).not.toBe(first);
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
it("bounds idle cached sessions without evicting a pending owner", async () => {
  const api = {} as ApplicationClient;
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
  expect(reviewSession(api, busyScope)).toBe(busy);
  expect(reviewSession(api, idleScope)).not.toBe(idle);
  finish();
  await task;
});
