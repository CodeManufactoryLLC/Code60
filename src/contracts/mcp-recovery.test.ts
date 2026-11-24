import { describe, expect, it } from "vitest";
import { mcpRecoveryRequestSchema } from "./mcp-recovery.js";
import {
  mcpFailure,
  mcpFailureGuidance,
  mcpFailureSchema,
  mcpTroubleshootingReportSchema,
} from "./mcp-troubleshooting.js";

const target = { scope: "user", targetId: "a".repeat(64) };
const request = {
  action: "recover",
  direction: "complete",
  transactionId: "12345678-1234-4123-8123-123456789abc",
  reviewRevision: "b".repeat(64),
  targets: [{ target, expectedRevision: "c".repeat(64) }],
  requestId: "12345678-1234-4123-8123-123456789abd",
};
describe("MCP recovery and safe troubleshooting contracts", () => {
  it("requires bounded captured targets, native-review digest, direction and mutation UUID; accepts no paths or force", () => {
    expect(mcpRecoveryRequestSchema.safeParse(request).success).toBe(true);
    for (const invalid of [
      { ...request, path: "/private/secret" },
      { ...request, force: true },
      { ...request, reviewRevision: undefined },
      { ...request, targets: [] },
      { ...request, targets: Array(3).fill(request.targets[0]) },
      { ...request, requestId: "bad" },
      {
        ...request,
        targets: [{ target: { ...target, projectId: "wrong" }, expectedRevision: "c".repeat(64) }],
      },
    ])
      expect(mcpRecoveryRequestSchema.safeParse(invalid).success).toBe(false);
    expect(
      mcpRecoveryRequestSchema.safeParse({
        action: "review",
        target,
        transactionId: request.transactionId,
      }).success,
    ).toBe(true);
  });
  it("uses only fixed issue codes/stages and never serializes exceptions or arbitrary keys", () => {
    const fallback = { code: "protocol", stage: "initialize" } as const;
    for (const value of [
      new Error("SYNTHETIC_SECRET"),
      { mcpFailure: { ...fallback, raw: "SYNTHETIC_SECRET" } },
      { mcpFailure: { code: "SYNTHETIC_SECRET", stage: "SYNTHETIC_SECRET" } },
    ]) {
      expect(mcpFailure(value, fallback)).toEqual(fallback);
      expect(mcpFailureGuidance(mcpFailure(value, fallback))).not.toContain("SYNTHETIC_SECRET");
    }
    for (const code of mcpFailureSchema.shape.code.options) {
      const value = { code, stage: "initialize" } as const;
      expect(mcpFailure({ mcpFailure: value }, fallback)).toEqual(value);
      expect(mcpFailureGuidance(value)).toContain(
        "Other tools remain available. The agent session remains usable",
      );
    }
  });
  it("allowlists the complete report and rejects identifiers, content and extra nested metadata", () => {
    const report = {
      version: 1,
      scope: "project",
      configuration: "invalid",
      issues: 1,
      pendingTransactions: 1,
      definitions: 0,
      enabled: 0,
      projectApproval: "required",
      authentication: { notChecked: 0, notRequired: 0, required: 0, authenticated: 0, failed: 0 },
      connections: {
        notTested: 0,
        connecting: 0,
        connected: 0,
        failed: 0,
        disconnected: 0,
        cleanupUnresolved: 0,
        authenticationRequired: 0,
      },
      failures: [{ code: "network", stage: "initialize" }],
      unresolvedCleanup: 0,
      capturedInstances: 0,
      connectedInstances: 0,
    };
    expect(mcpTroubleshootingReportSchema.safeParse(report).success).toBe(true);
    for (const key of [
      "targetId",
      "label",
      "text",
      "credentialRef",
      "url",
      "path",
      "error",
      "token",
    ])
      expect(mcpTroubleshootingReportSchema.safeParse({ ...report, [key]: "secret" }).success).toBe(
        false,
      );
    expect(
      mcpTroubleshootingReportSchema.safeParse({
        ...report,
        failures: [{ ...report.failures[0], message: "secret" }],
      }).success,
    ).toBe(false);
    expect(mcpTroubleshootingReportSchema.safeParse({ ...report, enabled: -1 }).success).toBe(
      false,
    );
  });
});
