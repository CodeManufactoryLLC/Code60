import { describe, expect, it } from "vitest";
import {
  MCP_CONNECTOR_LIMITS,
  mcpConnectorDocumentSchema,
  parseMcpConnectorDocument,
} from "./index.js";

const stdio = () => ({ label: "Documentation", enabled: false, type: "stdio", command: "node" });
const http = () => ({
  label: "Remote",
  enabled: true,
  type: "http",
  url: "https://example.test/mcp",
});
const document = (server: unknown = stdio(), id = "docs") => ({
  version: 1,
  servers: { [id]: server },
});
const invalid = (value: unknown) =>
  expect(() => parseMcpConnectorDocument(value)).toThrow("Invalid MCP connector configuration");

describe("MCP connector document v1", () => {
  it("accepts empty defaults and detaches input without enabling templates", () => {
    expect(parseMcpConnectorDocument({ version: 1, servers: {} })).toEqual({
      version: 1,
      servers: {},
    });
    const input = document();
    const parsed = parseMcpConnectorDocument(input);
    expect(parsed.servers.docs).toEqual({ ...stdio(), args: [], env: {} });
    expect(parsed).not.toBe(input);
    expect(input).toEqual(document());
    expect(mcpConnectorDocumentSchema.safeParse(input).success).toBe(true);
  });

  it("distinguishes literal configuration from environment/header credential references", () => {
    const local = {
      ...stdio(),
      args: ["server.js"],
      env: { MODE: { value: "local" }, TOKEN: { credentialRef: "docs-token" } },
    };
    const remote = {
      ...http(),
      headers: {
        Authorization: { credentialRef: "docs-token", prefix: "Bearer " },
        "X-Mode": { value: "read" },
      },
      auth: { type: "none" },
    };
    expect(parseMcpConnectorDocument(document(local)).servers.docs).toEqual(local);
    expect(parseMcpConnectorDocument(document(remote)).servers.docs).toEqual(remote);
    expect(parseMcpConnectorDocument(document(http())).servers.docs).toMatchObject({
      headers: {},
      auth: { type: "none" },
    });
  });

  it("stores only OAuth registration metadata and defaults requested scopes", () => {
    const server = {
      ...http(),
      auth: {
        type: "oauth",
        clientId: "user-registration",
        clientSecretRef: "registration-secret",
      },
    };
    expect(parseMcpConnectorDocument(document(server)).servers.docs).toMatchObject({
      auth: { ...server.auth, scopes: [] },
    });
    expect(
      parseMcpConnectorDocument(
        document({ ...http(), auth: { type: "oauth", scopes: ["read", "write"] } }),
      ).servers.docs,
    ).toMatchObject({ auth: { scopes: ["read", "write"] } });
  });

  it.each([
    null,
    [],
    {},
    { version: 2, servers: {} },
    { version: 1 },
    { version: 1, servers: {}, unknown: "secret" },
    document({ ...stdio(), enabled: "false" }),
    document({ ...stdio(), label: " " }),
    document({ ...stdio(), command: " " }),
    document({ ...stdio(), type: "sse" }),
    document({ ...stdio(), url: "https://example.test" }),
    document({ ...http(), command: "node" }),
    document({ ...stdio(), args: [1] }),
    document({ ...stdio(), env: { TOKEN: "inline-secret" } }),
    document({ ...stdio(), env: { TOKEN: { value: "x", credentialRef: "y" } } }),
    document({ ...stdio(), env: { TOKEN: { credentialRef: "key", prefix: "env-prefix" } } }),
    document({ ...stdio(), env: { "A=B": { value: "x" } } }),
    document({ ...http(), headers: { Authorization: { value: "Bearer inline-secret" } } }),
    document({ ...http(), headers: { authorization: { value: "inline-secret" } } }),
    document({ ...http(), headers: { "Proxy-Authorization": { value: "inline-secret" } } }),
    document({ ...http(), headers: { "X-Bad\n": { value: "x" } } }),
    document({ ...http(), headers: { Mode: { value: "a" }, mode: { value: "b" } } }),
    document({ ...http(), headers: { Mode: { value: "x\r\nAuthorization: x" } } }),
    document({ ...http(), headers: { Authorization: { credentialRef: "key", prefix: "x\n" } } }),
    document({ ...http(), auth: { type: "oauth", accessToken: "secret" } }),
    document({ ...http(), auth: { type: "oauth", tokenEndpoint: "https://attacker.test" } }),
    document({ ...http(), auth: { type: "oauth", clientSecret: "secret" } }),
    document({ ...http(), auth: { type: "oauth", clientId: " " } }),
    document({ ...http(), auth: { type: "oauth", scopes: [" "] } }),
    ...["code60", "Docs", "-docs", "docs_tools", "", "docs tools", "a".repeat(65)].map((id) =>
      document(stdio(), id),
    ),
    ...[
      "file:///tmp/tools",
      "https://user:secret@example.test/mcp",
      "https://example.test/mcp#fragment",
      "not a URL",
    ].map((url) => document({ ...http(), url })),
  ])("rejects malformed or credential-bearing configuration %#", invalid);

  it.each(["label", "command"])("requires %s", (field) => {
    const server: Record<string, unknown> = stdio();
    delete server[field];
    invalid(document(server));
  });
  it("requires explicit enabled and transport fields", () => {
    for (const field of ["enabled", "type"]) {
      const server: Record<string, unknown> = stdio();
      delete server[field];
      invalid(document(server));
    }
  });

  it.each([
    ["label", MCP_CONNECTOR_LIMITS.label],
    ["command", MCP_CONNECTOR_LIMITS.launch],
  ] as const)("enforces the exact %s bound", (field, limit) => {
    expect(() =>
      parseMcpConnectorDocument(document({ ...stdio(), [field]: "x".repeat(limit) })),
    ).not.toThrow();
    invalid(document({ ...stdio(), [field]: "x".repeat(limit + 1) }));
    invalid(document({ ...stdio(), [field]: "x\0y" }));
  });

  it("bounds entries, arguments, bindings, references, URLs and OAuth metadata", () => {
    const servers = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`s${i}`, stdio()]));
    expect(() => parseMcpConnectorDocument({ version: 1, servers })).not.toThrow();
    invalid({ version: 1, servers: { ...servers, extra: stdio() } });
    expect(() => parseMcpConnectorDocument(document(stdio(), "x".repeat(64)))).not.toThrow();
    const args = Array.from({ length: 128 }, () => "x".repeat(4096));
    expect(() => parseMcpConnectorDocument(document({ ...stdio(), args }))).not.toThrow();
    invalid(document({ ...stdio(), args: [...args, "extra"] }));
    invalid(document({ ...stdio(), args: ["x".repeat(4097)] }));
    invalid(document({ ...stdio(), args: ["x\0"] }));
    const bindings = Object.fromEntries(
      Array.from({ length: 64 }, (_, i) => [`K${i}`, { value: "x".repeat(8192) }]),
    );
    for (const server of [
      { ...stdio(), env: bindings },
      { ...http(), headers: bindings },
    ])
      expect(() => parseMcpConnectorDocument(document(server))).not.toThrow();
    invalid(document({ ...stdio(), env: { ...bindings, EXTRA: { value: "x" } } }));
    invalid(document({ ...http(), headers: { ...bindings, EXTRA: { value: "x" } } }));
    for (const binding of [
      { value: "x".repeat(8193) },
      { value: "x\0" },
      { credentialRef: "x".repeat(129) },
      { credentialRef: " " },
      { credentialRef: "x\0" },
    ])
      invalid(document({ ...stdio(), env: { TOKEN: binding } }));
    expect(() =>
      parseMcpConnectorDocument(
        document({ ...stdio(), env: { TOKEN: { credentialRef: "x".repeat(128) } } }),
      ),
    ).not.toThrow();
    invalid(document({ ...stdio(), env: { ["x".repeat(129)]: { value: "x" } } }));
    const baseUrl = "https://example.test/";
    expect(() =>
      parseMcpConnectorDocument(
        document({ ...http(), url: baseUrl + "x".repeat(4096 - baseUrl.length) }),
      ),
    ).not.toThrow();
    invalid(document({ ...http(), url: baseUrl + "x".repeat(4097) }));
    invalid(document({ ...http(), url: "https://example.test/\0" }));
    invalid(document({ ...http(), auth: { type: "oauth", scopes: Array(65).fill("read") } }));
    invalid(document({ ...http(), auth: { type: "oauth", scopes: ["x".repeat(257)] } }));
    invalid(document({ ...http(), auth: { type: "oauth", clientId: "x".repeat(4097) } }));
  });

  it("returns a fixed error without serializing values, keys or Zod issues", () => {
    const sensitive = "synthetic-private-credential";
    try {
      parseMcpConnectorDocument(document({ ...stdio(), env: { [sensitive]: sensitive } }));
      expect.fail("invalid document accepted");
    } catch (error) {
      expect(error).toEqual(new Error("Invalid MCP connector configuration"));
      expect(JSON.stringify(error)).not.toContain(sensitive);
    }
  });
});
