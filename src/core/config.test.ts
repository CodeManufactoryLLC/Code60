import { describe, expect, it } from "vitest";
import { DEFAULT_OPERATING_CONTRACT_CLAUSES } from "../contracts/index.js";
import { configuredMcpServers, loadConfig, parseConfig } from "./config.js";
import { UsageError } from "./types.js";

describe("Operating Contract configuration", () => {
  it("accepts the complete clause map and resets old single-block overrides", () => {
    const clauses = { ...DEFAULT_OPERATING_CONTRACT_CLAUSES, planning: "Custom planning." };
    expect(
      parseConfig({ prompts: { operatingContract: clauses } }).prompts.operatingContract,
    ).toEqual(clauses);
    expect(
      parseConfig({
        prompts: { operatingContract: "Old custom contract", workerUpdates: "{{updates}}" },
      }).prompts,
    ).toMatchObject({
      operatingContract: DEFAULT_OPERATING_CONTRACT_CLAUSES,
      workerUpdates: "{{updates}}",
    });
  });

  it("rejects incomplete, empty, or unexpected clauses", () => {
    for (const clauses of [
      { role: "Role only." },
      { ...DEFAULT_OPERATING_CONTRACT_CLAUSES, planning: "" },
      { ...DEFAULT_OPERATING_CONTRACT_CLAUSES, extra: "Not predefined" },
    ])
      expect(() => parseConfig({ prompts: { operatingContract: clauses } })).toThrow(
        /prompts.operatingContract/,
      );
  });
});

describe("MCP configuration", () => {
  it("defaults to no servers and fills transport-specific defaults", () => {
    expect(parseConfig({}).mcpServers).toEqual({});
    expect(
      parseConfig({
        mcpServers: {
          local: { type: "stdio", command: "node" },
          remote: { type: "http", url: "https://example.com/mcp" },
          legacy: { type: "sse", url: "http://localhost:8000/sse" },
        },
      }).mcpServers,
    ).toEqual({
      local: { type: "stdio", command: "node", args: [], env: {} },
      remote: { type: "http", url: "https://example.com/mcp", headers: {} },
      legacy: { type: "sse", url: "http://localhost:8000/sse", headers: {} },
    });
  });

  it("resolves all transports into detached internal definitions without interpolating values", () => {
    const config = parseConfig({
      mcpServers: {
        local: {
          type: "stdio",
          command: "node",
          args: ["/absolute/server.js", ""],
          env: { TOKEN: `\${TOKEN}` },
        },
        remote: {
          type: "http",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer example" },
        },
        legacy: {
          type: "sse",
          url: "http://localhost/sse",
          headers: { Accept: "text/event-stream" },
        },
      },
    });
    const servers = configuredMcpServers(config);
    expect(servers).toEqual([
      {
        name: "local",
        type: "stdio",
        command: "node",
        args: ["/absolute/server.js", ""],
        env: [{ name: "TOKEN", value: `\${TOKEN}` }],
      },
      {
        name: "remote",
        type: "http",
        url: "https://example.com/mcp",
        headers: [{ name: "Authorization", value: "Bearer example" }],
      },
      {
        name: "legacy",
        type: "sse",
        url: "http://localhost/sse",
        headers: [{ name: "Accept", value: "text/event-stream" }],
      },
    ]);
    expect(servers).not.toBe(configuredMcpServers(config));
    expect(servers[0]).not.toBe(configuredMcpServers(config)[0]);
  });

  it.each([
    null,
    [],
    "",
    1,
    { "": { type: "stdio", command: "node" } },
    { "  ": { type: "stdio", command: "node" } },
    { code60: { type: "stdio", command: "node" } },
    { local: null },
    { local: { command: "node" } },
    { local: { type: "other", command: "node" } },
    ...["", "  ", 1, [], null].map((command) => ({ local: { type: "stdio", command } })),
    ...["argument", [1], null].map((args) => ({ local: { type: "stdio", command: "node", args } })),
    ...[[], null, { TOKEN: 1 }, { TOKEN: { nested: "secret" } }].map((env) => ({
      local: { type: "stdio", command: "node", env },
    })),
    { local: { type: "stdio", command: "node", url: "https://example.com" } },
    { local: { type: "stdio", command: "node", headers: {} } },
    { local: { type: "stdio", command: "node", unknown: true } },
    ...(["http", "sse"] as const).flatMap((type) => [
      { remote: { type } },
      ...[
        "",
        "/relative",
        "file:///tmp/server",
        "ftp://example.com",
        "ws://example.com",
        "https://",
        1,
        null,
      ].map((url) => ({ remote: { type, url } })),
      ...[[], null, { Authorization: 1 }, { Authorization: { secret: true } }].map((headers) => ({
        remote: { type, url: "https://example.com", headers },
      })),
      ...["command", "args", "env", "unknown"].map((key) => ({
        remote: { type, url: "https://example.com", [key]: "secret" },
      })),
    ]),
  ])("rejects malformed MCP configuration %#", (mcpServers) => {
    expect(() => parseConfig({ mcpServers })).toThrow(UsageError);
    expect(() => parseConfig({ mcpServers })).toThrow(/mcpServers/);
  });

  it("never includes environment/header values or JSON excerpts in usage errors", async () => {
    const secret = "sensitive-value-must-not-appear";
    for (const server of [
      { type: "stdio", command: "node", env: { TOKEN: { [secret]: secret } } },
      { type: "http", url: "https://example.com", headers: { Authorization: [secret] } },
      { type: "sse", url: secret, headers: { Authorization: secret }, [secret]: secret },
    ]) {
      try {
        parseConfig({ mcpServers: { test: server } });
        expect.unreachable("invalid server accepted");
      } catch (error) {
        expect(error).toBeInstanceOf(UsageError);
        expect((error as Error).message).not.toContain(secret);
      }
    }
    await expect(
      loadConfig({ readFile: async () => `{"mcpServers": "${secret}" broken}` }, {}),
    ).rejects.toThrow(/invalid JSON$/);
  });
});
