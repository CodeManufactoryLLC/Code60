import { expect, it } from "vitest";
import {
  decodeMcpText,
  encodeMcpText,
  MCP_COMPLETION_SCHEMA,
  MCP_EMPTY_TEXT,
  mcpResetSchema,
  mcpRestoreSchema,
  mcpSaveTextSchema,
} from "./mcp-editing.js";
import { parseMcpManagement } from "./mcp-management.js";

const target = { scope: "user" as const, targetId: "a".repeat(64) };
const requestId = "11111111-1111-4111-8111-111111111111";
it("round-trips exact UTF-8, BOMs, formatting and a near-limit newline envelope below the gateway cap", () => {
  for (const text of [
    MCP_EMPTY_TEXT,
    '\ufeff{"private":"é😀"}',
    "\n".repeat(1_048_530) + '{"version":1,"servers":{}}',
  ])
    expect(decodeMcpText(encodeMcpText(text))).toBe(text);
  const wire = JSON.stringify({
    operation: "mcp-save-text",
    value: {
      target,
      expectedRevision: "b".repeat(64),
      requestId,
      contentBase64: encodeMcpText("\n".repeat(1_048_530) + '{"version":1,"servers":{}}'),
    },
  });
  expect(new TextEncoder().encode(wire).length).toBeLessThan(2 * 1024 * 1024);
});
it("rejects noncanonical base64, invalid UTF-8, unpaired source surrogates and oversized decoded data without excerpts", () => {
  for (const value of ["AB==", "-_==", "AA=", "Y Q==", "/w==", "a".repeat(1_398_108)])
    expect(() => decodeMcpText(value)).toThrow(/^Invalid MCP configuration text\.$/);
  for (const text of ["é".repeat(524289), "\ud800"])
    expect(() => encodeMcpText(text)).toThrow(/^Invalid MCP configuration text\.$/);
});
it("keeps text/backup/reset operations strictly target-bound with current revisions and project user guards", () => {
  const base = { target, expectedRevision: "b".repeat(64), requestId };
  expect(
    parseMcpManagement(mcpSaveTextSchema, {
      ...base,
      contentBase64: encodeMcpText(MCP_EMPTY_TEXT),
    }),
  ).toHaveProperty("contentBase64");
  for (const value of [
    { ...base, contentBase64: "", path: "/private" },
    { ...base, contentBase64: "token!" },
  ])
    expect(() => parseMcpManagement(mcpSaveTextSchema, value)).toThrow(
      "Invalid MCP management request",
    );
  expect(() =>
    parseMcpManagement(mcpRestoreSchema, { ...base, backupId: `${requestId}-0` }),
  ).toThrow();
  expect(() => parseMcpManagement(mcpResetSchema, { ...base, includeUser: true })).toThrow();
  const project = {
    scope: "project",
    targetId: target.targetId,
    projectId: requestId,
    databaseEpoch: 0,
  };
  expect(() =>
    parseMcpManagement(mcpResetSchema, { ...base, target: project, includeUser: false }),
  ).toThrow();
  expect(
    parseMcpManagement(mcpResetSchema, {
      ...base,
      target: project,
      includeUser: false,
      expectedUserRevision: "c".repeat(64),
    }),
  ).toHaveProperty("expectedUserRevision");
});
it("provides local structural completion metadata without executing schema-generated code", () => {
  expect(MCP_COMPLETION_SCHEMA).toMatchObject({
    type: "object",
    additionalProperties: false,
    required: ["version", "servers"],
  });
  expect(JSON.stringify(MCP_COMPLETION_SCHEMA)).toContain("credentialRef");
});
