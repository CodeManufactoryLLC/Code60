import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MCP_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSIONS,
  MCP_TOOL_DEFINITIONS,
} from "../bridge/index.js";
import { CODE60_VERSION } from "../core/index.js";
import { diagnosticText } from "../platform/index.js";

const MAX_LINE_LENGTH = 1_048_576;

function toolDefinitions() {
  if (process.env.CODE60_MCP_ROLE !== "relay") return MCP_TOOL_DEFINITIONS;
  const allowed = new Set([
    "code60_get_context",
    "code60_dispatch_agent",
    "code60_list_agents",
    "code60_read_agent",
    "code60_send_agent",
    "code60_finish_agent",
    "code60_cancel_agent",
    "code60_stop_agent",
    "code60_create_plan",
    "code60_read_plan",
    "code60_update_plan",
    "code60_get_activity_context",
    "code60_report_activity",
  ]);
  return MCP_TOOL_DEFINITIONS.filter((tool) => allowed.has(tool.name)).map((tool) => {
    if (tool.name === "code60_create_plan" || tool.name === "code60_update_plan") {
      const inputSchema = structuredClone(tool.inputSchema);
      const properties =
        tool.name === "code60_create_plan"
          ? inputSchema.properties
          : (inputSchema.properties.draft?.properties as Record<string, Record<string, unknown>>);
      const items = properties.tasks?.items as {
        properties: Record<string, unknown>;
        required: string[];
      };
      items.properties.target = {
        type: "object",
        additionalProperties: false,
        properties: {
          cwd: { type: "string", minLength: 1, maxLength: 32_768 },
          workspaceMode: { type: "string", enum: ["direct", "worktree"] },
        },
        required: ["cwd", "workspaceMode"],
      };
      items.required = [...items.required, "target"];
      return {
        ...tool,
        inputSchema,
        description: `${tool.description} Every Relay task requires an explicit target with absolute cwd and direct/worktree workspaceMode. Human acceptance binds this revision and every target/mode assignment.`,
      };
    }
    if (tool.name !== "code60_dispatch_agent")
      return {
        ...tool,
        description: tool.description.replaceAll(
          "in the open project",
          "across Relay's execution targets",
        ),
      };
    const { reviewId: _review, ...properties } = tool.inputSchema.properties;
    return {
      ...tool,
      description:
        "Dispatch one Relay-owned worker to an explicit absolute cwd. No open project or database is required. Direct edits affect that exact directory and have no isolated apply/undo/discard. Worktree requires Git with a valid base. No fallback or permission bypass.",
      inputSchema: {
        ...tool.inputSchema,
        properties: {
          ...properties,
          base: {
            ...properties.base,
            description:
              "Optional explicit Git base, resolved to a frozen commit. Otherwise worktree mode captures saved files once per human task/target, without changing HEAD or staging. Direct mode rejects a base.",
          },
          cwd: {
            type: "string",
            minLength: 1,
            maxLength: 32_768,
            description: "Required absolute target directory. Never infer from sidebar state.",
          },
          workspaceMode: { type: "string", enum: ["direct", "worktree"] },
        },
        required: [...(tool.inputSchema.required ?? []), "cwd", "workspaceMode"],
      },
    };
  });
}

interface RpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorResponse(id: unknown, code: number, message: string): void {
  send({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

function toolResponse(id: unknown, result: unknown, isError = false): void {
  send({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError,
    },
  });
}

function gatewayConfiguration(): { url: string; token: string } {
  const url = process.env.CODE60_MCP_GATEWAY_URL;
  const token = process.env.CODE60_MCP_GATEWAY_TOKEN;
  if (!url || !token) throw new Error("Code60 MCP gateway configuration is missing");
  const parsed = new URL(url);
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.pathname !== "/v1/call"
  )
    throw new Error("Invalid Code60 MCP gateway address");
  return { url, token };
}

async function callGateway(name: string, args: unknown): Promise<unknown> {
  if (!toolDefinitions().some((tool) => tool.name === name)) throw new Error("Unknown Code60 tool");
  const gateway = gatewayConfiguration();
  const response = await fetch(gateway.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${gateway.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name, arguments: args }),
    signal: AbortSignal.timeout(125_000),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      isObject(payload) && typeof payload.error === "string"
        ? payload.error
        : "Code60 table request failed";
    throw new Error(error);
  }
  if (!isObject(payload) || !Object.hasOwn(payload, "result"))
    throw new Error("Invalid response from Code60");
  return payload.result;
}

export async function handleMcpRequest(request: RpcRequest): Promise<void> {
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    if (request.id !== undefined) errorResponse(request.id, -32600, "Invalid request");
    return;
  }
  if (
    request.method === "notifications/initialized" ||
    request.method === "notifications/cancelled"
  )
    return;
  if (request.id === undefined) return;
  if (request.method === "initialize") {
    const protocolVersion =
      isObject(request.params) &&
      typeof request.params.protocolVersion === "string" &&
      (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(request.params.protocolVersion)
        ? request.params.protocolVersion
        : MCP_PROTOCOL_VERSION;
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "code60", version: CODE60_VERSION },
      },
    });
    return;
  }
  if (request.method === "ping") {
    send({ jsonrpc: "2.0", id: request.id, result: {} });
    return;
  }
  if (request.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: toolDefinitions().map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: {
            readOnlyHint: tool.readOnly,
            destructiveHint: tool.destructive,
            idempotentHint: tool.readOnly,
            openWorldHint: false,
          },
        })),
      },
    });
    return;
  }
  if (request.method === "tools/call") {
    if (!isObject(request.params) || typeof request.params.name !== "string") {
      toolResponse(request.id, { error: "Invalid tool call" }, true);
      return;
    }
    try {
      const result = await callGateway(request.params.name, request.params.arguments ?? {});
      toolResponse(request.id, result);
    } catch (error) {
      toolResponse(
        request.id,
        {
          error:
            error instanceof Error ? diagnosticText(error.message) : "Code60 table request failed",
        },
        true,
      );
    }
    return;
  }
  errorResponse(request.id, -32601, "Method not found");
}

/** Runs the MCP stdio transport. Stdout is reserved exclusively for JSON-RPC messages. */
export function serveMcpStdio(): void {
  let pending = "";
  let inFlight = 0;
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    pending += chunk;
    if (pending.length > MAX_LINE_LENGTH && !pending.includes("\n")) {
      pending = "";
      errorResponse(null, -32700, "Message too large");
      return;
    }
    for (;;) {
      const newline = pending.indexOf("\n");
      if (newline === -1) break;
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (line.length > MAX_LINE_LENGTH) {
        errorResponse(null, -32700, "Message too large");
        continue;
      }
      let value: unknown;
      try {
        value = JSON.parse(line) as unknown;
      } catch {
        errorResponse(null, -32700, "Parse error");
        continue;
      }
      if (!isObject(value)) {
        errorResponse(null, -32600, "Invalid request");
        continue;
      }
      if (inFlight >= 8) {
        if (Object.hasOwn(value, "id")) errorResponse(value.id, -32000, "Too many requests");
        continue;
      }
      inFlight++;
      void handleMcpRequest(value as RpcRequest)
        .catch(() => {
          if (Object.hasOwn(value, "id")) errorResponse(value.id, -32603, "Internal error");
        })
        .finally(() => {
          inFlight--;
        });
    }
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    gatewayConfiguration();
    serveMcpStdio();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? diagnosticText(error.message) : "Could not start Code60 MCP server"}\n`,
    );
    process.exitCode = 1;
  }
}
