import { expect, it } from "vitest";
import { parseRelayReview } from "./relay-reviews.js";
import { parseReviewAction, reviewSchema } from "./reviews.js";

const address = {
  conversationId: crypto.randomUUID(),
  generation: 4,
  targetId: crypto.randomUUID(),
  reviewId: crypto.randomUUID(),
};
const requestId = crypto.randomUUID();
it("accepts only addressed Relay review operations, never cwd or project fallbacks", () => {
  const request = { ...address, type: "read", requestId };
  expect(parseRelayReview(request)).toEqual(request);
  for (const extra of [
    { cwd: "/another-target" },
    { project: "/project" },
    { projectId: crypto.randomUUID() },
    { databaseEpoch: 2 },
    { command: ["agent"] },
  ])
    expect(() => parseRelayReview({ ...request, ...extra })).toThrow();
  for (const field of ["conversationId", "generation", "targetId", "reviewId"] as const) {
    const invalid: Record<string, unknown> = { ...request };
    delete invalid[field];
    expect(() => parseRelayReview(invalid)).toThrow();
  }
  expect(() =>
    parseReviewAction({
      type: "submit",
      ...address,
      id: crypto.randomUUID(),
      revisionId: crypto.randomUUID(),
    }),
  ).toThrow();
});
it("bounds feedback anchors and task identifiers without permitting historical reconnection", () => {
  const base = { ...address, type: "action" };
  const comment = {
    type: "comment",
    id: crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    text: "Review this target",
  };
  expect(parseRelayReview({ ...base, action: comment })).toMatchObject({ action: comment });
  expect(() =>
    parseRelayReview({ ...base, action: { ...comment, text: "x".repeat(8_001) } }),
  ).toThrow();
  expect(() =>
    parseRelayReview({ ...base, action: { type: "reconnect", chatId: "another" } }),
  ).toThrow();
  expect(
    parseRelayReview({
      ...address,
      type: "task",
      action: { type: "apply", operationId: crypto.randomUUID() },
    }),
  ).toMatchObject({ type: "task", action: { type: "apply" } });
  expect(() =>
    parseRelayReview({
      ...address,
      type: "task",
      action: { type: "apply", operationId: "../../operation" },
    }),
  ).toThrow();
  expect(() =>
    parseRelayReview({
      conversationId: address.conversationId,
      generation: 4,
      type: "list",
      cursor: "page-0.json",
    }),
  ).toThrow();
});
it("preserves exact saved native identities and validates target-qualified provenance", () => {
  const value = {
    format: 1,
    id: address.reviewId,
    project: address.conversationId,
    title: "Target task",
    originChatId: address.conversationId,
    chatId: "relay-run",
    turn: 1,
    workers: [{ runId: "worker", label: "Worker", turn: 2 }],
    revisions: [],
    comments: [],
    submissions: [],
    reviewed: {},
    relay: {
      ...address,
      taskId: crypto.randomUUID(),
      cwd: "/target",
      device: "1",
      inode: "9007199254740993",
      workspaceMode: "worktree",
    },
  };
  delete (value.relay as Partial<typeof value.relay>).reviewId;
  expect(reviewSchema.parse(value).relay?.inode).toBe("9007199254740993");
  for (const inode of [Number(9_007_199_254_740_993n), "-1", "1e20", "01", "9".repeat(41)])
    expect(() => reviewSchema.parse({ ...value, relay: { ...value.relay, inode } })).toThrow();
});
