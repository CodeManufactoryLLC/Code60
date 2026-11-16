import { expect, it, vi } from "vitest";
import type { DesktopApi } from "../bridge/index.js";
import { type ReviewScope, reviewRequest } from "./review-actions.js";

const scope: ReviewScope = {
  kind: "project",
  project: "/project",
  projectId: "runtime",
  databaseEpoch: 3,
  reviewId: "review",
  chatId: "chat",
  live: true,
};
function setup() {
  const methods = {
    taskAction: vi.fn().mockResolvedValue({ available: true }),
    readReview: vi.fn().mockResolvedValue({ id: "review", chatId: "chat" }),
    reviewAction: vi.fn().mockResolvedValue("review"),
    captureReview: vi.fn().mockResolvedValue(undefined),
    cancelDiff: vi.fn().mockResolvedValue(undefined),
    relayReview: vi.fn().mockResolvedValue({ type: "done" }),
  };
  return { methods, api: methods as unknown as DesktopApi };
}
it("routes project reads, pinned revisions and cancellation with the original owner and request ID", async () => {
  const { methods, api } = setup();
  expect(
    await reviewRequest(api, scope, { type: "read", requestId: "request", revisionId: "revision" }),
  ).toMatchObject({ type: "review", live: true });
  expect(methods.readReview).toHaveBeenCalledWith({
    project: "/project",
    projectId: "runtime",
    databaseEpoch: 3,
    reviewId: "review",
    requestId: "request",
    revisionId: "revision",
  });
  await reviewRequest(api, scope, { type: "cancel", requestId: "request" });
  expect(methods.cancelDiff).toHaveBeenCalledWith({ requestId: "request" });
  expect(methods.relayReview).not.toHaveBeenCalled();
});
it("routes explicit preview/apply/undo actions without replacing captured identities", async () => {
  const { methods, api } = setup();
  for (const type of ["apply", "undo", "recover", "revise"] as const) {
    await reviewRequest(api, scope, { type: "task", action: { type, operationId: "operation" } });
    expect(methods.taskAction).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type,
        operationId: "operation",
        projectId: "runtime",
        databaseEpoch: 3,
      }),
    );
  }
  expect(methods.readReview).not.toHaveBeenCalled();
});
it("does not invent liveness for stopped or reconnected project evidence", async () => {
  const { methods, api } = setup();
  expect(
    await reviewRequest(api, { ...scope, live: false }, { type: "read", requestId: "read" }),
  ).toMatchObject({ live: false });
  methods.readReview.mockResolvedValue({ chatId: "previous-chat" });
  expect(await reviewRequest(api, scope, { type: "read", requestId: "read" })).toMatchObject({
    live: false,
  });
});
it("captures or submits exactly once and propagates failures without replay", async () => {
  const { methods, api } = setup();
  await reviewRequest(api, scope, { type: "capture", requestId: "capture" });
  expect(methods.captureReview).toHaveBeenCalledTimes(1);
  expect(methods.readReview).toHaveBeenLastCalledWith(
    expect.objectContaining({ requestId: "capture" }),
  );
  const action = { type: "submit" as const, id: "submission", revisionId: "revision" };
  await reviewRequest(api, scope, { type: "action", action });
  expect(methods.reviewAction).toHaveBeenCalledWith(expect.objectContaining(action));
  methods.reviewAction.mockRejectedValue(new Error("Delivery failed"));
  await expect(reviewRequest(api, scope, { type: "action", action })).rejects.toThrow(
    "Delivery failed",
  );
  expect(methods.reviewAction).toHaveBeenCalledTimes(2);
  await expect(reviewRequest(api, scope, { type: "list" })).rejects.toThrow("Unsupported");
});
it("sends Relay only its opaque scope, never project fallbacks or presentation fields", async () => {
  const { methods, api } = setup();
  const relay: ReviewScope = {
    kind: "relay",
    conversationId: "relay",
    generation: 4,
    targetId: "target",
    reviewId: "review",
  };
  await reviewRequest(api, relay, { type: "read", requestId: "request", revisionId: "pinned" });
  expect(methods.relayReview).toHaveBeenCalledWith({
    conversationId: "relay",
    generation: 4,
    targetId: "target",
    reviewId: "review",
    type: "read",
    requestId: "request",
    revisionId: "pinned",
  });
  expect(methods.readReview).not.toHaveBeenCalled();
  expect(methods.taskAction).not.toHaveBeenCalled();
});
