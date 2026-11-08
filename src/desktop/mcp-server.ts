import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  MCP_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSIONS,
  MCP_TOOL_DEFINITIONS,
} from "../bridge/index.js";
import { CODE60_VERSION } from "../core/index.js";
import { diagnosticMessage } from "../platform/index.js";

const MAX_LINE_LENGTH = 1_048_576;

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
  if (!MCP_TOOL_DEFINITIONS.some((tool) => tool.name === name))
    throw new Error("Unknown Code60 tool");
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
        tools: MCP_TOOL_DEFINITIONS.map((tool) => ({
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
      toolResponse(request.id, { error: diagnosticMessage(error) }, true);
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
    process.stderr.write(`${diagnosticMessage(error)}\n`);
    process.exitCode = 1;
  }
}
