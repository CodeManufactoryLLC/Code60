import { describe, expect, it } from "vitest";
import { mcpRuntimeRequestSchema } from "./mcp-runtime.js";

const target = {
  scope: "project",
  targetId: "a".repeat(64),
  projectId: "10594f4f-22ea-4fc2-9289-df37bacd7773",
  databaseEpoch: 2,
};
const id = "65b5f344-ec13-4aaf-89c9-b2ac09a2a9a3";
describe("human MCP runtime requests", () => {
  it("requires captured ownership, revision, mutation and reviewed connection generation", () => {
    const enable = {
      action: "enable",
      target,
      expectedRevision: "b".repeat(64),
      requestId: id,
      serverId: "docs",
      enabled: true,
    };
    expect(mcpRuntimeRequestSchema.safeParse(enable).success).toBe(true);
    for (const request of [
      { ...enable, enabled: "yes" },
      { ...enable, command: "node" },
      { ...enable, target: { ...target, path: "/tmp" } },
      { ...enable, target: { ...target, databaseEpoch: -1 } },
      { ...enable, expectedRevision: "old" },
      { ...enable, requestId: "retry" },
      {
        action: "reconnect",
        target,
        expectedRevision: "b".repeat(64),
        requestId: id,
        sessionGeneration: id,
        serverIds: ["docs"],
      },
    ])
      expect(mcpRuntimeRequestSchema.safeParse(request).success).toBe(false);
    expect(
      mcpRuntimeRequestSchema.safeParse({
        action: "reconnect",
        target,
        expectedRevision: "b".repeat(64),
        requestId: id,
        sessionGeneration: id,
        previewId: id,
        serverIds: ["docs"],
      }).success,
    ).toBe(true);
  });
});
