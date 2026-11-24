import { appendFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const record = (value) =>
  appendFileSync(process.env.MCP_EVIDENCE, `${JSON.stringify(value)}\n`, { mode: 0o600 });
record({
  event: "spawn",
  pid: process.pid,
  cwd: process.cwd(),
  privateInherited: process.env.APPLICATION_PRIVATE_SECRET !== undefined,
});
const server = new Server(
  { name: "synthetic-upstream", version: "1" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async (_request, { signal }) => {
  record({ event: "list" });
  if (process.env.MCP_WAIT_BEFORE_DISCOVERY === "1")
    await new Promise((resolve) => {
      signal.addEventListener("abort", resolve, { once: true });
      if (signal.aborted) resolve();
    });
  if (process.env.MCP_EXCESS_TOOLS === "1")
    return {
      tools: Array.from({ length: 513 }, (_, index) => ({
        name: `tool_${index}`,
        inputSchema: { type: "object" },
      })),
    };
  return {
    tools: [
      {
        name: "fixture_tool",
        description: "Synthetic tool",
        inputSchema: { type: "object", properties: { slow: { type: "boolean" } } },
        annotations: { readOnlyHint: true },
      },
    ],
  };
});
server.setRequestHandler(CallToolRequestSchema, async ({ params }, { signal }) => {
  record({ event: "call", name: params.name });
  if (params.arguments?.slow)
    await new Promise((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          record({ event: "cancel" });
          resolve();
        },
        { once: true },
      );
      if (signal.aborted) resolve();
    });
  return { content: [{ type: "text", text: "synthetic result" }], isError: false };
});
await server.connect(new StdioServerTransport());
