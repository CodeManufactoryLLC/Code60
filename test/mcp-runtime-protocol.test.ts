import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AgentSession, connectMcpUpstream, createAgents } from "../src/agents/index.js";
import { McpRuntime, type McpRuntimeSnapshot } from "../src/application/mcp-runtime.js";
import { createMcpBroker } from "../src/gateway/mcp-broker.js";

const provider = fileURLToPath(new URL("./fixtures/mcp-connector-provider.mjs", import.meta.url));
const upstream = fileURLToPath(new URL("./fixtures/mcp-upstream.mjs", import.meta.url));
const adapter = fileURLToPath(new URL("../src/agents/mcp-adapter.ts", import.meta.url));
const revision = "a".repeat(64);
const targetId = "b".repeat(64);

describe("production MCP transports and per-session authority (supporting integration)", () => {
  let directory: string;
  let runtime: McpRuntime;
  let broker: Awaited<ReturnType<typeof createMcpBroker>>;
  const sessions: AgentSession[] = [];
  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), "code60-production-mcp-")));
    broker = await createMcpBroker(adapter);
    runtime = new McpRuntime(
      join(directory, "runtime"),
      { connect: connectMcpUpstream, expose: broker.expose },
      () => {},
      { PATH: process.env.PATH ?? "", HOME: directory },
    );
  });
  afterEach(async () => {
    await Promise.allSettled(sessions.splice(0).map((session) => session.stop(100)));
    await runtime.close();
    await broker.close();
    await rm(directory, { recursive: true, force: true });
  });
  function snapshot(): McpRuntimeSnapshot {
    return {
      role: "relay",
      user: {
        revision,
        targetId,
        document: {
          version: 1,
          servers: {
            fixture: {
              label: "Fixture",
              enabled: true,
              type: "stdio",
              command: process.execPath,
              args: [upstream],
              env: { MCP_EVIDENCE: { value: join(directory, "upstream.jsonl") } },
            },
          },
        },
      },
    };
  }
  it.each(["new", "load", "resume"] as const)(
    "uses the actual adapter for %s, discovery, ACP permissions, calls, cancellation and revocation",
    async (method) => {
      const warnings: string[] = [];
      const resources = await runtime.factory(
        async () => snapshot(),
        (warning) => warnings.push(warning),
      )({
        runId: randomUUID(),
        provider: "fixture",
        cwd: directory,
        controls: { idle: () => true, canRestore: () => true, reconnect: async () => {} },
      });
      expect(warnings).toEqual([]);
      expect(resources.servers).toHaveLength(1);
      const spec = {
        name: "fixture",
        command: [process.execPath, provider] as const,
        cwd: directory,
        env: {
          CONNECTOR_EVIDENCE: join(directory, "acp.json"),
          CONNECTOR_SESSION: randomUUID(),
          CONNECTOR_RESTORE: method,
        },
        mcpServers: resources.servers,
      };
      const agents = createAgents({ clientVersion: "test" });
      const session =
        method === "new" ? await agents.start(spec) : await agents.restore!(spec, "saved-session");
      sessions.push(session);
      const setup = JSON.parse(await readFile(join(directory, "acp.json"), "utf8"));
      expect(setup.method).toBe(method);
      expect(setup.catalog.tools[0].name).toBe("fixture_tool");
      expect(JSON.stringify(setup.params)).not.toContain(upstream);
      expect(JSON.stringify(setup.params)).not.toContain("MCP_EVIDENCE");
      // Discovery is possible at idle, but even an ACP allow decision cannot create turn authority.
      session.onPermission(async () => "allow");
      await session.prompt("{}");
      const lines = async () =>
        (await readFile(join(directory, "upstream.jsonl"), "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
      expect((await lines()).filter((value) => value.event === "call")).toHaveLength(0);
      resources.beginTurn(Date.now() + 10_000);
      session.onPermission(async () => "deny");
      await session.prompt("{}");
      expect((await lines()).filter((value) => value.event === "call")).toHaveLength(0);
      session.onPermission(async () => "allow");
      await session.prompt("{}");
      expect((await lines()).filter((value) => value.event === "call")).toHaveLength(1);
      for (const method of [
        "resources/list",
        "prompts/list",
        "sampling/createMessage",
        "elicitation/create",
      ])
        await session.prompt(JSON.stringify({ method }));
      expect((await lines()).filter((value) => value.event === "call")).toHaveLength(1);
      const turn = session.prompt('{"slow":true}');
      await expect
        .poll(async () => (await lines()).filter((value) => value.event === "call").length)
        .toBe(2);
      resources.endTurn();
      await session.cancel();
      await turn;
      await expect
        .poll(async () => (await lines()).some((value) => value.event === "cancel"))
        .toBe(true);
      await resources.close();
      await session.prompt("{}");
      expect((await lines()).filter((value) => value.event === "call")).toHaveLength(2);
      expect((await lines())[0]).toMatchObject({ cwd: directory, privateInherited: false });
    },
    30_000,
  );
  it.each([true, false])(
    "connects Streamable HTTP with JSON response=%s without replay",
    async (enableJsonResponse) => {
      let calls = 0;
      const owned: Server[] = [];
      const http = createServer((request, response) => {
        const server = new Server(
          { name: "http-fixture", version: "1" },
          { capabilities: { tools: {} } },
        );
        owned.push(server);
        server.setRequestHandler(ListToolsRequestSchema, () => ({
          tools: [{ name: "fixture_tool", inputSchema: { type: "object" } }],
        }));
        server.setRequestHandler(CallToolRequestSchema, () => {
          calls++;
          return { content: [{ type: "text", text: "HTTP result" }] };
        });
        const transport = new StreamableHTTPServerTransport({ enableJsonResponse });
        void server
          .connect(transport)
          .then(() => transport.handleRequest(request, response))
          .catch(() => response.end());
      });
      await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
      const address = http.address();
      if (!address || typeof address === "string") throw new Error();
      try {
        const setup = new AbortController();
        const connection = await connectMcpUpstream({
          definition: {
            label: "HTTP",
            enabled: true,
            type: "http",
            url: `http://127.0.0.1:${address.port}/mcp`,
            headers: {},
            auth: { type: "none" },
          },
          cwd: directory,
          environment: {},
          headers: {},
          signal: setup.signal,
        });
        setup.abort();
        expect(connection.tools).toHaveLength(1);
        expect(
          await connection.call("fixture_tool", {}, new AbortController().signal, 3000),
        ).toMatchObject({ content: [{ text: "HTTP result" }] });
        expect(calls).toBe(1);
        await connection.close();
      } finally {
        await Promise.all(owned.map((server) => server.close()));
        http.closeAllConnections();
        await new Promise<void>((resolve) => http.close(() => resolve()));
      }
    },
    20_000,
  );
  it("refuses cross-session capabilities and leaves failures isolated", async () => {
    let calls = 0;
    const entry = await broker.expose({
      id: "fixture",
      owner: randomUUID(),
      tools: [],
      call: async () => {
        calls++;
        return {};
      },
    });
    if (!("env" in entry.descriptor)) throw new Error();
    const env = Object.fromEntries(
      entry.descriptor.env.map((binding) => [binding.name, binding.value]),
    );
    const response = await fetch(`${broker.origin}/request`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.CODE60_CONNECTOR_CAPABILITY}` },
      body: JSON.stringify({ owner: randomUUID(), method: "tools/call", name: "fixture_tool" }),
    });
    expect(response.status).toBe(403);
    expect(calls).toBe(0);
    await entry.revoke();
    const invalid = snapshot();
    invalid.user.document.servers.bad = {
      label: "Missing executable",
      enabled: true,
      type: "stdio",
      command: "/nonexistent-code60-fixture",
      args: [],
      env: {},
    };
    const warnings: string[] = [];
    const resources = await runtime.factory(
      async () => invalid,
      (warning) => warnings.push(warning),
    )({
      runId: "partial",
      provider: "fixture",
      cwd: directory,
      controls: { idle: () => true, canRestore: () => true, reconnect: async () => {} },
    });
    expect(resources.servers).toHaveLength(1);
    expect(warnings).toEqual([expect.stringContaining("Other tools remain available")]);
    await resources.close();
  });
  it("terminates its stateful HTTP session once and closes its listener lease", async () => {
    let deletes = 0;
    let activeStreams = 0;
    const server = new Server(
      { name: "stateful-fixture", version: "1" },
      { capabilities: { tools: {} } },
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      enableJsonResponse: true,
    });
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
    await server.connect(transport);
    const http = createServer((request, response) => {
      if (request.method === "DELETE") deletes++;
      if (request.method === "GET") {
        activeStreams++;
        response.once("close", () => {
          activeStreams--;
        });
      }
      void transport.handleRequest(request, response).catch(() => response.end());
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const address = http.address();
    if (!address || typeof address === "string") throw new Error();
    try {
      const setup = new AbortController();
      const connection = await connectMcpUpstream({
        definition: {
          type: "http",
          label: "Stateful",
          enabled: true,
          url: `http://127.0.0.1:${address.port}/mcp`,
          headers: {},
          auth: { type: "none" },
        },
        cwd: directory,
        environment: {},
        headers: {},
        signal: setup.signal,
      });
      await expect.poll(() => activeStreams).toBe(1);
      setup.abort();
      expect(activeStreams).toBe(1);
      await connection.close();
      await connection.close();
      await connection.closed;
      expect(deletes).toBe(1);
      await expect.poll(() => activeStreams).toBe(0);
    } finally {
      await server.close();
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  });
  it("classifies missing executables without exposing native paths or upstream launch settings", async () => {
    const value = snapshot();
    value.user.document.servers.fixture = {
      label: "private",
      enabled: true,
      type: "stdio",
      command: "/no/such/private-executable",
      args: ["private-argument"],
      env: {},
    };
    const warnings: string[] = [];
    const resources = await runtime.factory(
      async () => value,
      (warning) => warnings.push(warning),
    )({
      runId: randomUUID(),
      provider: "fixture",
      cwd: directory,
      controls: { idle: () => true, canRestore: () => true, reconnect: async () => {} },
    });
    expect(resources.servers).toEqual([]);
    expect(warnings.join(" ")).toContain("MCP_LAUNCH (launch)");
    expect(warnings.join(" ")).not.toMatch(/private-executable|private-argument/);
    expect(runtime.failureStatus(targetId)).toEqual([{ code: "launch", stage: "launch" }]);
  });
  it("rejects a 513-tool catalog and verifies the owned stdio process group is gone", async () => {
    const value = snapshot();
    const definition = value.user.document.servers.fixture;
    if (!definition || definition.type !== "stdio") throw new Error();
    definition.env.MCP_EXCESS_TOOLS = { value: "1" };
    const resources = await runtime.factory(
      async () => value,
      () => {},
    )({
      runId: "excess-tools",
      provider: "fixture",
      cwd: directory,
      controls: { idle: () => true, canRestore: () => true, reconnect: async () => {} },
    });
    expect(resources.servers).toEqual([]);
    expect(runtime.failureStatus(targetId)).toContainEqual({ code: "limit", stage: "discovery" });
    const events = (await readFile(join(directory, "upstream.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const pid = events[0].pid;
    expect(() => process.kill(pid, 0)).toThrow();
    expect(() => process.kill(-pid, 0)).toThrow();
    expect(events.some((event) => event.event === "call")).toBe(false);
  });
});
