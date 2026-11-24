import { expect, it } from "vitest";
import { mcpAuthenticationRequestSchema } from "./mcp-authentication.js";
import { mcpConnectorDocumentSchema } from "./mcp-connectors.js";
import { parseMcpManagement } from "./mcp-management.js";

const capture = {
  target: { scope: "user", targetId: "a".repeat(64) },
  expectedRevision: "b".repeat(64),
  serverId: "docs",
};
it("limits secret entry to explicit captured human writes, without paths or credential reads", () => {
  const write = {
    action: "credential-write",
    ...capture,
    requestId: crypto.randomUUID(),
    previewId: crypto.randomUUID(),
    reference: "token",
    secret: "synthetic-secret",
    storage: "temporary",
  };
  expect(mcpAuthenticationRequestSchema.parse(write)).toEqual(write);
  for (const invalid of [
    { ...write, storage: undefined },
    { ...write, secret: "x".repeat(8193) },
    { ...write, secret: "\0" },
    { ...write, secret: "\ud800" },
    { ...write, path: "/private" },
    { ...write, target: { ...capture.target, projectId: crypto.randomUUID() } },
    { ...write, expectedRevision: "old" },
    { ...write, previewId: "unreviewed" },
    { ...write, requestId: "retry" },
    { ...write, action: "credential-read" },
    { ...write, secret: "" },
    { ...write, reference: "x".repeat(129) },
  ]) {
    expect(mcpAuthenticationRequestSchema.safeParse(invalid).success).toBe(false);
    expect(() => parseMcpManagement(mcpAuthenticationRequestSchema, invalid)).toThrow(
      "Invalid MCP management request",
    );
    try {
      parseMcpManagement(mcpAuthenticationRequestSchema, invalid);
    } catch (error) {
      expect(String(error)).not.toContain("synthetic-secret");
    }
  }
  expect(
    mcpAuthenticationRequestSchema.safeParse({ action: "cancel", attemptId: crypto.randomUUID() })
      .success,
  ).toBe(true);
  expect(
    mcpAuthenticationRequestSchema.safeParse({
      action: "preview",
      ...capture,
      issuer: "https://issuer.test",
      allowPrivateIssuer: true,
    }).success,
  ).toBe(true);
});
it("rejects conflicting/transport-owned headers and distinguishes metadata URLs from opaque registered client IDs", () => {
  const definition = {
    label: "Docs",
    enabled: false,
    type: "http",
    url: "https://mcp.test/tools",
    headers: {},
    auth: { type: "none" },
  };
  const valid = (changes: Record<string, unknown>) =>
    mcpConnectorDocumentSchema.safeParse({
      version: 1,
      servers: { docs: { ...definition, ...changes } },
    }).success;
  for (const name of [
    "Host",
    "Accept",
    "Mcp-Session-Id",
    "mcp-protocol-version",
    "Content-Type",
    "Proxy-Authorization",
    "Origin",
    "MCP-Method",
    "Connection",
    "Last-Event-ID",
  ])
    expect(valid({ headers: { [name]: { credentialRef: "token" } } })).toBe(false);
  expect(valid({ headers: { Authorization: { value: "plaintext" } } })).toBe(false);
  expect(valid({ headers: { Authorization: { credentialRef: "token", prefix: "Bearer " } } })).toBe(
    true,
  );
  expect(valid({ headers: { X: { value: "safe" }, x: { value: "safe" } } })).toBe(false);
  expect(valid({ headers: { X: { value: "a\r\nb" } } })).toBe(false);
  expect(valid({ auth: { type: "oauth", scopes: [], clientId: "https://opaque.test/id" } })).toBe(
    true,
  );
  const oauth = {
    type: "oauth",
    clientIdType: "metadata-url",
    clientId: "https://client.test/client.json",
  };
  expect(valid({ auth: oauth })).toBe(true);
  for (const auth of [
    { ...oauth, clientId: "http://client.test/id" },
    { ...oauth, clientId: "https://client.test/" },
    { ...oauth, clientSecretRef: "secret" },
    { ...oauth, clientId: undefined },
    { ...oauth, scopes: ["bad scope"] },
  ])
    expect(valid({ auth })).toBe(false);
  expect(
    valid({ headers: { Authorization: { credentialRef: "token" } }, auth: { type: "oauth" } }),
  ).toBe(false);
  expect(
    valid({
      headers: { X: { credentialRef: "same" } },
      auth: { type: "oauth", clientSecretRef: "same" },
    }),
  ).toBe(false);
});
