import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// This is a fixed provider-facing entrypoint. Upstream configuration never enters this process.
const endpoint = process.env.CODE60_CONNECTOR_ENDPOINT ?? "";
const capability = process.env.CODE60_CONNECTOR_CAPABILITY ?? "";
const owner = process.env.CODE60_CONNECTOR_OWNER ?? "";
delete process.env.CODE60_CONNECTOR_CAPABILITY;
if (
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint) ||
  !/^[a-f0-9]{64}$/.test(capability) ||
  !/^[a-f0-9-]{36}$/.test(owner)
)
  process.exit(1);
const headers = {
  Authorization: `Bearer ${capability}`,
  "Content-Type": "application/json",
  "X-Code60-Owner": owner,
};
const server = new Server(
  { name: "code60-connector-adapter", version: "1" },
  { capabilities: { tools: {} } },
);
const controller = new AbortController();
let lineBytes = 0;
process.stdin.prependListener("data", (chunk: Buffer) => {
  for (const byte of chunk) {
    if (byte === 10) lineBytes = 0;
    else if (++lineBytes > 8 * 1024 * 1024) process.exit(1);
  }
});
const stop = () => {
  controller.abort();
  void server.close().finally(() => process.exit(0));
};
process.stdin.once("end", stop);
process.stdin.once("close", stop);
process.once("SIGTERM", stop);
const lease = await fetch(`${endpoint}/lease`, {
  headers,
  signal: controller.signal,
  redirect: "error",
}).catch(() => null);
if (!lease?.ok || !lease.body) process.exit(1);
void (async () => {
  const reader = lease.body!.getReader();
  try {
    while (!(await reader.read()).done) {
      /* Backend lease owns this adapter. */
    }
  } catch {
    /* A closed lease revokes the capability. */
  } finally {
    stop();
  }
})();
async function request(value: Record<string, unknown>, signal: AbortSignal) {
  const body = JSON.stringify({ owner, ...value });
  if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw new Error("MCP request exceeded its limit");
  const response = await fetch(`${endpoint}/request`, {
    method: "POST",
    headers,
    body,
    signal,
    redirect: "error",
  });
  if (!response.ok || !response.body)
    throw new Error(
      "MCP call failed or authority was revoked. The outcome may be uncertain; do not replay the call.",
    );
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 8 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("MCP response exceeded its limit");
    }
    chunks.push(part.value);
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
}
server.setRequestHandler(ListToolsRequestSchema, (_, extra) =>
  request({ method: "tools/list" }, AbortSignal.any([controller.signal, extra.signal])),
);
server.setRequestHandler(CallToolRequestSchema, ({ params }, extra) =>
  request(
    { method: "tools/call", name: params.name, arguments: params.arguments ?? {} },
    AbortSignal.any([controller.signal, extra.signal]),
  ),
);
await server.connect(new StdioServerTransport());
