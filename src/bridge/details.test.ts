import { describe, expect, it } from "vitest";
import { parseDetailIdentity, parseDetailRequest } from "./index.js";

const randomUUID = () => crypto.randomUUID();

describe("scoped detail requests", () => {
  const subscriptionId = randomUUID();
  const projectId = randomUUID();
  const conversationId = randomUUID();
  it("accepts explicit project, conversation and execution-target addresses", () => {
    for (const scope of [
      { kind: "project", projectId, databaseEpoch: 0 },
      { kind: "conversation", conversationId, generation: 1 },
      { kind: "conversation", conversationId, generation: 1, projectId, databaseEpoch: 2 },
      { kind: "target", conversationId, generation: 1, targetId: randomUUID() },
    ])
      expect(parseDetailRequest({ subscriptionId, scope })).toEqual({ subscriptionId, scope });
    expect(parseDetailIdentity({ subscriptionId })).toEqual({ subscriptionId });
  });
  it("rejects missing, stale-shaped, oversized and path-bearing addresses", () => {
    const scope = { kind: "conversation", conversationId, generation: 1 };
    for (const request of [
      null,
      {},
      { subscriptionId, scope: { ...scope, path: "/arbitrary" } },
      { subscriptionId, scope: { ...scope, projectId } },
      { subscriptionId, scope: { ...scope, databaseEpoch: 2 } },
      { subscriptionId, scope: { ...scope, generation: -1 } },
      { subscriptionId, scope: { ...scope, generation: Number.MAX_SAFE_INTEGER + 1 } },
      { subscriptionId, scope: { ...scope, conversationId: "x".repeat(65) } },
      { subscriptionId: "not-a-uuid", scope },
      { subscriptionId, scope, project: "/arbitrary" },
      { subscriptionId, scope: { kind: "project", projectId } },
      {
        subscriptionId,
        scope: { kind: "target", targetId: "/arbitrary", generation: 1, conversationId },
      },
    ])
      expect(() => parseDetailRequest(request)).toThrow();
    expect(() => parseDetailIdentity({ subscriptionId, scope })).toThrow();
  });
});
