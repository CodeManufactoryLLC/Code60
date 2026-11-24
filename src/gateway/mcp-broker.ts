import { randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { McpRuntimePorts } from "../application/index.js";
import { sameSecret } from "./sessions.js";

const requestSchema = z.strictObject({
  owner: z.uuid(),
  method: z.enum(["tools/list", "tools/call"]),
  name: z.string().max(1024).optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});
const MAX_BYTES = 8 * 1024 * 1024;
type Entry = Parameters<McpRuntimePorts["expose"]>[0] & {
  leases: Set<ServerResponse>;
  calls: Set<AbortController>;
  revoked: boolean;
};

/** Capability-only private listener. It has no browser session or public gateway route. */
export async function createMcpBroker(
  adapterPath = fileURLToPath(new URL("../agents/mcp-adapter.js", import.meta.url)),
) {
  const entries = new Map<string, Entry>();
  let origin = "";
  let closing = false;
  const server = createServer((request, response) => {
    void (async () => {
      response.setHeader("Cache-Control", "no-store");
      if (closing || request.headers.origin || request.headers.host !== new URL(origin).host)
        throw new Error();
      const token = request.headers.authorization?.replace(/^Bearer /, "");
      const key = token && [...entries.keys()].find((value) => sameSecret(value, token));
      const entry = key ? entries.get(key) : undefined;
      if (!entry || entry.revoked) throw new Error();
      if (request.url === "/lease" && request.method === "GET") {
        if (request.headers["x-code60-owner"] !== entry.owner || entry.leases.size >= 2)
          throw new Error();
        entry.leases.add(response);
        response.writeHead(200, { "Content-Type": "application/octet-stream" });
        response.write("1");
        response.once("close", () => entry.leases.delete(response));
        return;
      }
      if (request.url !== "/request" || request.method !== "POST") throw new Error();
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BYTES) throw new Error();
        chunks.push(chunk);
      }
      const value = requestSchema.parse(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))),
      );
      if (value.owner !== entry.owner || entry.revoked) throw new Error();
      const controller = new AbortController();
      entry.calls.add(controller);
      const abort = () => controller.abort();
      response.once("close", abort);
      try {
        const result =
          value.method === "tools/list"
            ? { tools: entry.tools }
            : await entry.call(value.name ?? "", value.arguments ?? {}, controller.signal);
        if (entry.revoked || controller.signal.aborted) throw new Error();
        const text = JSON.stringify(result);
        if (Buffer.byteLength(text) > MAX_BYTES) throw new Error();
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(text);
      } finally {
        entry.calls.delete(controller);
        response.off("close", abort);
      }
    })().catch(() => {
      if (!response.headersSent) response.writeHead(403, { "Content-Type": "application/json" });
      response.end('{"error":"MCP capability unavailable or request rejected"}');
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Private MCP listener unavailable");
  origin = `http://127.0.0.1:${address.port}`;
  const revoke = (token: string) => {
    const entry = entries.get(token);
    if (!entry) return;
    entry.revoked = true;
    entries.delete(token);
    for (const call of entry.calls) call.abort();
    for (const lease of entry.leases) lease.end();
  };
  const expose: McpRuntimePorts["expose"] = async (input) => {
    if (closing || entries.size >= 256) throw new Error("MCP broker unavailable or full");
    const token = randomBytes(32).toString("hex");
    entries.set(token, { ...input, leases: new Set(), calls: new Set(), revoked: false });
    return {
      descriptor: {
        name: input.id,
        type: "stdio",
        command: process.execPath,
        args: [adapterPath],
        env: [
          { name: "CODE60_CONNECTOR_ENDPOINT", value: origin },
          { name: "CODE60_CONNECTOR_CAPABILITY", value: token },
          { name: "CODE60_CONNECTOR_OWNER", value: input.owner },
        ],
      },
      revoke: async () => revoke(token),
    };
  };
  return {
    expose,
    origin,
    close: async () => {
      closing = true;
      for (const token of entries.keys()) revoke(token);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
