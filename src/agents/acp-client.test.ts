import type { SessionUpdate, Stream } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import {
  ACP_PROTOCOL_VERSION,
  AcpRestoreUnavailableError,
  mapUpdate,
  openSession,
  RAW_UPDATE_LIMIT,
  rawUpdate,
  restoreMethod,
  restoreSession,
  toToolKind,
} from "./acp-client.js";
import { TailBuffer } from "./process.js";
import type { AgentUpdate } from "./types.js";

describe("raw ACP updates", () => {
  const message = (text: string): SessionUpdate => ({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  });

  it("preserves fields not used by typed updates", () => {
    const update: SessionUpdate = {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "Read",
      kind: "read",
      rawInput: { path: "a.txt" },
      rawOutput: { text: "result" },
      locations: [{ path: "/work/a.txt", line: 2 }],
    };
    expect(JSON.parse(rawUpdate(update).payload)).toEqual(update);
  });

  it("keeps exactly 256 KiB without truncation and marks larger payloads", () => {
    const overhead = Buffer.byteLength(JSON.stringify(message("")));
    const exact = rawUpdate(message("x".repeat(RAW_UPDATE_LIMIT - overhead)));
    expect(exact.size).toBe(RAW_UPDATE_LIMIT);
    expect(Buffer.byteLength(exact.payload)).toBe(RAW_UPDATE_LIMIT);
    expect(exact.truncated).toBeUndefined();
    const large = rawUpdate(message("x".repeat(RAW_UPDATE_LIMIT)));
    expect(large.size).toBe(RAW_UPDATE_LIMIT + overhead);
    expect(Buffer.byteLength(large.payload)).toBe(RAW_UPDATE_LIMIT);
    expect(large.truncated).toBe(true);
  });

  it("clips incomplete UTF-8 code points without corrupting complete characters", () => {
    const prefix = JSON.stringify(message("")).indexOf('"}}');
    for (const character of ["é", "界", "😀"]) {
      const update = message(`${"x".repeat(RAW_UPDATE_LIMIT - prefix - 1)}${character}end`);
      const raw = rawUpdate(update);
      expect(raw.truncated).toBe(true);
      expect(raw.payload.endsWith("x")).toBe(true);
      expect(raw.payload).not.toContain("\uFFFD");
      expect(Buffer.byteLength(raw.payload)).toBeLessThanOrEqual(RAW_UPDATE_LIMIT);
      expect(raw.size).toBe(Buffer.byteLength(JSON.stringify(update)));
    }
    const literal = rawUpdate(message(`${"x".repeat(RAW_UPDATE_LIMIT - prefix - 3)}\uFFFDmore`));
    expect(literal.payload.endsWith("\uFFFD")).toBe(true);
  });
});

type Rpc = {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
};

function fakeAgent(capabilities: Record<string, unknown>, promptError?: string) {
  const requests = new TransformStream<Rpc, Rpc>();
  const responses = new TransformStream<Rpc, Rpc>();
  const reader = requests.readable.getReader();
  const writer = responses.writable.getWriter();
  const seen: string[] = [];
  const received: Rpc[] = [];
  const stream = {
    writable: requests.writable,
    readable: responses.readable,
  } as unknown as Stream;
  const serve = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value?.method === undefined) continue;
      const request = value;
      const method = request.method as string;
      seen.push(method);
      received.push(request);
      if (method === "session/load") {
        await writer.write({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "saved-session",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "replayed history" },
            },
          },
        });
      }
      if (request.id === undefined) continue;
      if (method === "session/prompt" && promptError !== undefined) {
        await writer.write({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32603, message: promptError },
        } as Rpc);
        continue;
      }
      const result =
        method === "initialize"
          ? { protocolVersion: 1, agentCapabilities: capabilities }
          : method === "session/prompt"
            ? { stopReason: "end_turn" }
            : method === "session/new"
              ? { sessionId: "new-session" }
              : {};
      await writer.write({ jsonrpc: "2.0", id: request.id, result });
    }
  })();
  return {
    stream,
    seen,
    received,
    async toolUpdate(update: SessionUpdate) {
      await writer.write({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "new-session", update },
      });
    },
    async update(text: string) {
      await writer.write({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "saved-session",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
          },
        },
      });
    },
    close() {
      void writer.close().catch(() => {});
      void reader.cancel().catch(() => {});
    },
    serve,
  };
}

describe("MCP tool attribution", () => {
  const call = (extra: Record<string, unknown> = {}): SessionUpdate => ({
    sessionUpdate: "tool_call",
    toolCallId: "m1",
    title: "Provider title",
    ...extra,
  });

  // Claude ACP emits these fields in src/tool-calls/renderer.ts:
  // https://github.com/agentclientprotocol/claude-agent-acp
  it.each([
    [{ name: "mcp__playwright__browser_snapshot" }, { server: "playwright" }],
    [{ _meta: { claudeCode: { toolName: "mcp__context7__query-docs" } } }, { server: "context7" }],
    [
      { _meta: { jetbrains: { air: { mcp: { server: "docs", tool: "query" } } } } },
      { server: "docs" },
    ],
    [{ _meta: { is_mcp_tool_call: true } }, {}],
    [{ _meta: { is_mcp_tool_call: true, server: "not-a-supported-field" } }, {}],
    [{ name: "mcp__https://private.invalid/token__query" }, {}],
  ])("normalizes documented metadata %#", (extra, expected) => {
    expect(mapUpdate(call(extra), new Map())).toMatchObject({ mcp: expected });
  });

  it.each([
    { title: "mcp__context7__query-docs", kind: "fetch" },
    { rawInput: { server: "playwright", name: "mcp__playwright__browser_snapshot" } },
    { _meta: { claudeCode: "mcp__context7__query-docs" } },
    { _meta: { is_mcp_tool_call: "true", server: "context7" } },
    { name: "mcp__context7__" },
    { name: 123 },
  ])("does not infer MCP from titles, arguments or malformed metadata %#", (extra) => {
    expect(mapUpdate(call(extra), new Map())).not.toHaveProperty("mcp");
  });

  it("merges partial updates independently and allows corrected programmatic names", () => {
    const calls = new Map();
    mapUpdate(call({ name: "mcp__context7__query-docs" }), calls);
    mapUpdate(call({ toolCallId: "native", name: "Read" }), calls);
    const update = { sessionUpdate: "tool_call_update" as const, toolCallId: "m1" };
    expect(mapUpdate({ ...update, status: "completed" }, calls)).toMatchObject({
      mcp: { server: "context7" },
      status: "completed",
    });
    expect(mapUpdate({ ...update, toolCallId: "native", status: "completed" }, calls)?.type).toBe(
      "toolCall",
    );
    expect(calls.get("native").mcp).toBeUndefined();
    expect(mapUpdate({ ...update, name: "Read" }, calls)).not.toHaveProperty("mcp");
    expect(mapUpdate({ ...update, status: "completed" }, calls)?.type).toBe("toolCall");
    expect(calls.get("m1").mcp).toBeUndefined();
  });

  it("carries structured attribution through the real ACP transport", async () => {
    const agent = fakeAgent({});
    const session = await openSession(agent.stream, { cwd: "/work", agentName: "fake" });
    const updates: AgentUpdate[] = [];
    session.onUpdate((update) => updates.push(update));
    try {
      await agent.toolUpdate(
        call({
          _meta: { claudeCode: { toolName: "mcp__context7__query-docs" } },
          rawInput: { apiKey: "not-for-normalized-events" },
        }),
      );
      await agent.toolUpdate({
        sessionUpdate: "tool_call_update",
        toolCallId: "m1",
        status: "completed",
      });
      await expect
        .poll(() => updates.filter((update) => update.type === "toolCall").length)
        .toBe(2);
      const tools = updates.filter((update) => update.type === "toolCall");
      expect(tools.map((update) => update.mcp)).toEqual([
        { server: "context7" },
        { server: "context7" },
      ]);
      expect(JSON.stringify(tools)).not.toContain("not-for-normalized-events");
    } finally {
      session.close();
      agent.close();
    }
  });
});

describe("TailBuffer", () => {
  it("keeps only the last bytes", () => {
    const tail = new TailBuffer(5);
    tail.push(Buffer.from("abc"));
    tail.push(Buffer.from("defg"));
    expect(tail.toString()).toBe("cdefg");
    tail.push(Buffer.from("123456"));
    expect(tail.toString()).toBe("23456");
  });
});

describe("toToolKind", () => {
  it("accepts known kinds, including switch_mode, and maps anything else to other", () => {
    expect(toToolKind("execute")).toBe("execute");
    expect(toToolKind("switch_mode")).toBe("switch_mode");
    expect(toToolKind("teleport")).toBe("other");
    expect(toToolKind(undefined)).toBe("other");
  });
});

describe("ACP session restoration", () => {
  it("does not echo provider errors containing private prompts into operational failures", async () => {
    const privatePrompt = "a private task with sensitive repository content";
    const agent = fakeAgent({}, privatePrompt);
    const session = await openSession(agent.stream, { cwd: "/work", agentName: "fake" });
    try {
      await expect(session.prompt(privatePrompt)).rejects.toThrow(
        "ACP request failed; check the agent's connection and configuration",
      );
    } finally {
      session.close();
      agent.close();
    }
  });

  it("advertises the SDK protocol version and the supplied Code60 client version", async () => {
    const agent = fakeAgent({});
    const session = await openSession(agent.stream, {
      cwd: "/work",
      agentName: "fake",
      clientVersion: "0.2.3-test",
    });
    expect(agent.received.find((request) => request.method === "initialize")?.params).toMatchObject(
      {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientInfo: { name: "code60", version: "0.2.3-test" },
        clientCapabilities: {},
      },
    );
    session.close();
    agent.close();
  });

  it("passes client-provided MCP servers to new sessions and restoration", async () => {
    const mcpServers = [
      {
        name: "code60",
        command: "/node",
        args: ["/code60/mcp-server.js"],
        env: [{ name: "CODE60_TEST", value: "example" }],
      },
    ] as const;
    const fresh = fakeAgent({});
    const session = await openSession(fresh.stream, {
      cwd: "/work",
      agentName: "fake",
      mcpServers,
    });
    expect(session.sessionId).toBe("new-session");
    expect(fresh.received.find((request) => request.method === "session/new")?.params).toEqual({
      cwd: "/work",
      mcpServers,
    });
    session.close();
    fresh.close();
    for (const [capabilities, method] of [
      [{ sessionCapabilities: { resume: {} } }, "session/resume"],
      [{ loadSession: true }, "session/load"],
    ] as const) {
      const fake = fakeAgent(capabilities);
      const restored = await restoreSession(fake.stream, {
        cwd: "/work",
        agentName: "fake",
        sessionId: "saved-session",
        mcpServers,
      });
      expect(fake.received.find((request) => request.method === method)?.params).toMatchObject({
        mcpServers,
      });
      restored.close();
      fake.close();
    }
  });

  it.each(["new", "load", "resume"] as const)(
    "sends exact MCP wire definitions through session/%s",
    async (method) => {
      const mcpServers = [
        {
          type: "stdio",
          name: "local",
          command: "node",
          args: ["/server.js"],
          env: [{ name: "TOKEN", value: "example" }],
        },
        {
          type: "http",
          name: "remote",
          url: "https://example.com/mcp",
          headers: [{ name: "Authorization", value: "Bearer example" }],
        },
        { type: "sse", name: "legacy", url: "http://localhost/sse", headers: [] },
      ] as const;
      const agent = fakeAgent({
        mcpCapabilities: { http: true, sse: true },
        loadSession: method === "load",
        ...(method === "resume" ? { sessionCapabilities: { resume: {} } } : {}),
      });
      const options = { cwd: "/work", agentName: "fake", mcpServers };
      const session =
        method === "new"
          ? await openSession(agent.stream, options)
          : await restoreSession(agent.stream, { ...options, sessionId: "saved-session" });
      try {
        expect(
          agent.received.find((request) => request.method === `session/${method}`)?.params,
        ).toEqual({
          cwd: "/work",
          ...(method === "new" ? {} : { sessionId: "saved-session" }),
          mcpServers: [
            {
              name: "local",
              command: "node",
              args: ["/server.js"],
              env: [{ name: "TOKEN", value: "example" }],
            },
            {
              type: "http",
              name: "remote",
              url: "https://example.com/mcp",
              headers: [{ name: "Authorization", value: "Bearer example" }],
            },
            { type: "sse", name: "legacy", url: "http://localhost/sse", headers: [] },
          ],
        });
      } finally {
        session.close();
        agent.close();
      }
    },
  );

  it.each(["http", "sse"] as const)(
    "rejects unadvertised %s before new/load/resume",
    async (type) => {
      for (const capabilities of [
        {},
        { mcpCapabilities: { [type]: false } },
        { mcpCapabilities: { [type === "http" ? "sse" : "http"]: true } },
      ]) {
        for (const method of ["new", "load", "resume"]) {
          const agent = fakeAgent({
            ...capabilities,
            loadSession: method === "load",
            ...(method === "resume" ? { sessionCapabilities: { resume: {} } } : {}),
          });
          const options = {
            cwd: "/work",
            agentName: "fake",
            mcpServers: [
              {
                type,
                name: "tools",
                url: "https://example.com/private",
                headers: [{ name: "Authorization", value: "secret" }],
              },
            ],
          };
          await expect(
            method === "new"
              ? openSession(agent.stream, options)
              : restoreSession(agent.stream, { ...options, sessionId: "saved-session" }),
          ).rejects.toThrow(`does not advertise support for ${type.toUpperCase()} MCP servers`);
          expect(agent.seen).toEqual(["initialize"]);
          agent.close();
          await agent.serve;
        }
      }
    },
  );

  it("prefers resume, then load, and detects unsupported agents", () => {
    expect(restoreMethod({ loadSession: true, sessionCapabilities: { resume: {} } })).toBe(
      "resume",
    );
    expect(restoreMethod({ loadSession: true })).toBe("load");
    expect(restoreMethod({})).toBeUndefined();
  });

  it("restores via session/resume without creating a new session", async () => {
    const agent = fakeAgent({ sessionCapabilities: { resume: {} } });
    const session = await restoreSession(agent.stream, {
      cwd: "/worktree/run-1",
      agentName: "claude",
      sessionId: "saved-session",
    });
    const updates: string[] = [];
    session.onUpdate((update) => {
      if (update.type === "message") updates.push(update.text);
    });
    await agent.update("new activity");
    expect(session.sessionId).toBe("saved-session");
    expect(agent.seen).toContain("session/resume");
    expect(agent.seen).not.toContain("session/new");
    expect(updates).toEqual(["new activity"]);
    await session.prompt("only when explicitly asked");
    session.close();
    agent.close();
  });

  it("suppresses transcript replay from session/load but forwards new updates", async () => {
    const agent = fakeAgent({ loadSession: true });
    const session = await restoreSession(agent.stream, {
      cwd: "/worktree/run-1",
      agentName: "claude",
      sessionId: "saved-session",
    });
    const updates: AgentUpdate[] = [];
    session.onUpdate((update) => updates.push(update));
    await agent.update("new activity");
    expect(agent.seen).toContain("session/load");
    expect(agent.seen).not.toContain("session/new");
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ type: "acp", update: "agent_message_chunk", size: 87 });
    expect(updates[0]?.type === "acp" && JSON.parse(updates[0].payload)).toEqual({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "new activity" },
    });
    expect(updates[1]).toEqual({ type: "message", text: "new activity" });
    session.close();
    agent.close();
  });

  it("rejects restoration when the agent advertises neither method", async () => {
    const agent = fakeAgent({});
    await expect(
      restoreSession(agent.stream, {
        cwd: "/worktree/run-1",
        agentName: "claude",
        sessionId: "saved-session",
      }),
    ).rejects.toBeInstanceOf(AcpRestoreUnavailableError);
    expect(agent.seen).not.toContain("session/new");
    agent.close();
  });
});
