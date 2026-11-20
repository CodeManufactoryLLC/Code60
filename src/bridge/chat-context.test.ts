import { expect, it } from "vitest";
import { chatReferenceSchema, parseOrchestrationChatAction } from "./index.js";

const reference = {
  reviewId: "b6555384-79d3-4e54-98ba-a1b262c1a6d1",
  revisionId: "73810d58-9e5c-4ad7-af25-930a42df1330",
  fileKey: "worker:saved.ts",
  side: "modified" as const,
  start: 2,
  end: 4,
};
it("preserves exact saved code addresses on Send and limits them to eight", () => {
  const request = {
    type: "send",
    id: "chat-1",
    text: "Please revise this.",
    references: Array.from({ length: 8 }, () => reference),
  };
  expect(parseOrchestrationChatAction(request)).toEqual(request);
  expect(() =>
    parseOrchestrationChatAction({ ...request, references: [...request.references, reference] }),
  ).toThrow();
  expect(
    chatReferenceSchema.parse({ reviewId: reference.reviewId, revisionId: reference.revisionId }),
  ).toEqual({
    reviewId: reference.reviewId,
    revisionId: reference.revisionId,
  });
});
it.each([
  { ...reference, reviewId: "../outside" },
  { ...reference, fileKey: "" },
  { ...reference, cwd: "/arbitrary" },
  { ...reference, start: 0 },
  { ...reference, end: 1 },
  { ...reference, start: undefined },
  { ...reference, end: undefined },
  { ...reference, side: undefined },
  { ...reference, fileKey: undefined },
  { ...reference, end: 1_000_001 },
])("rejects malformed or capability-bearing code reference %#", (value) => {
  expect(chatReferenceSchema.safeParse(value).success).toBe(false);
});
it("requires an opaque checkpoint and explicit draft replacement status for Undo", () => {
  const request = {
    type: "undo-request",
    id: "chat-1",
    checkpointId: reference.revisionId,
    replacesDraft: true,
  };
  expect(parseOrchestrationChatAction(request)).toEqual(request);
  for (const invalid of [
    { ...request, checkpointId: "/directory" },
    { ...request, replacesDraft: undefined },
    { ...request, targets: ["/directory"] },
    { ...request, force: true },
  ])
    expect(() => parseOrchestrationChatAction(invalid)).toThrow();
});
