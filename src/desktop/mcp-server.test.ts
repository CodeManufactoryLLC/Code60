import { afterEach, describe, expect, it, vi } from "vitest";
import { MCP_PROTOCOL_VERSION, MCP_PROTOCOL_VERSIONS } from "../bridge/index.js";
import { CODE60_VERSION } from "../core/index.js";
import { handleMcpRequest } from "./mcp-server.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("MCP initialization", () => {
  it("advertises Relay-only target-qualified plans without mutating project schemas", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.stubEnv("CODE60_MCP_ROLE", "relay");
    await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const relay = JSON.parse(String(write.mock.calls[0]?.[0])).result.tools as Array<{
      name: string;
      inputSchema: { properties: Record<string, unknown> };
    }>;
    expect(relay.some((tool) => tool.name === "code60_create_command")).toBe(false);
    const plan = relay.find((tool) => tool.name === "code60_create_plan");
    expect(plan?.inputSchema.properties.tasks).toMatchObject({
      items: {
        required: ["text", "target"],
        properties: { target: { required: ["cwd", "workspaceMode"] } },
      },
    });
    expect(
      relay.find((tool) => tool.name === "code60_dispatch_agent")?.inputSchema.properties,
    ).toHaveProperty("planTaskId");
    write.mockClear();
    vi.stubEnv("CODE60_MCP_ROLE", "");
    await handleMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const project = JSON.parse(String(write.mock.calls[0]?.[0])).result.tools as typeof relay;
    expect(
      project.find((tool) => tool.name === "code60_create_plan")?.inputSchema.properties.tasks,
    ).toMatchObject({ items: { required: ["text"] } });
    expect(
      JSON.stringify(project.find((tool) => tool.name === "code60_create_plan")),
    ).not.toContain('"workspaceMode"');
  });
  it.each([...MCP_PROTOCOL_VERSIONS, "unknown"])(
    "negotiates %s and reports the Code60 version",
    async (requested) => {
      const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      await handleMcpRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: requested },
      });
      expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toMatchObject({
        id: 1,
        result: {
          protocolVersion: requested === "unknown" ? MCP_PROTOCOL_VERSION : requested,
          serverInfo: { name: "code60", version: CODE60_VERSION },
        },
      });
    },
  );
});

describe("MCP tool errors", () => {
  async function call(params: unknown) {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await handleMcpRequest({ jsonrpc: "2.0", id: 7, method: "tools/call", params });
    expect(write).toHaveBeenCalledTimes(1);
    return JSON.parse(String(write.mock.calls[0]?.[0]));
  }

  function gateway() {
    vi.stubEnv("CODE60_MCP_GATEWAY_URL", "http://127.0.0.1:12345/v1/call");
    vi.stubEnv("CODE60_MCP_GATEWAY_TOKEN", "synthetic-gateway-token");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  function expectToolError(response: unknown, error: string) {
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: {
        content: [{ type: "text", text: JSON.stringify({ error }) }],
        isError: true,
      },
    });
  }

  it("uses a fixed message for non-Error throws without exposing the value", async () => {
    const fetch = gateway();
    fetch.mockRejectedValue({ privateDetail: "must not reach stdout" });
    expectToolError(await call({ name: "code60_get_context" }), "Code60 table request failed");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("redacts gateway Error messages in the serialized tool response", async () => {
    const fetch = gateway();
    fetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Request failed: api_key=synthetic-private-value" }), {
        status: 500,
      }),
    );
    expectToolError(
      await call({ name: "code60_get_context" }),
      "Request failed: api_key=[REDACTED]",
    );
  });

  it("uses the fallback for a non-OK response with no error message", async () => {
    const fetch = gateway();
    fetch.mockResolvedValue(new Response("not JSON", { status: 502 }));
    expectToolError(await call({ name: "code60_get_context" }), "Code60 table request failed");
  });

  it("rejects unknown tools without contacting the gateway", async () => {
    const fetch = gateway();
    expectToolError(await call({ name: "not_a_code60_tool" }), "Unknown Code60 tool");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([undefined, null, [], {}, { name: 42 }])(
    "rejects malformed tool calls (%j) without contacting the gateway",
    async (params) => {
      const fetch = gateway();
      expectToolError(await call(params), "Invalid tool call");
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
