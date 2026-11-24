// Protocol feasibility fixture only. No production connector entrypoint is installed.
import { createInterface } from "node:readline";

const endpoint = new URL(process.env.CONNECTOR_ENDPOINT);
if (
  endpoint.protocol !== "http:" ||
  endpoint.hostname !== "127.0.0.1" ||
  endpoint.pathname !== "/connector"
)
  throw new Error("Invalid fixture endpoint");
const pending = new Map();
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  void (async () => {
    const request = JSON.parse(line);
    if (request.method === "notifications/cancelled") {
      pending.get(request.params.requestId)?.abort();
      return;
    }
    if (request.id === undefined) return;
    if (!["initialize", "tools/list", "tools/call", "ping"].includes(request.method)) {
      send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Unsupported" } });
      return;
    }
    const cancellation = new AbortController();
    pending.set(request.id, cancellation);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.CONNECTOR_CAPABILITY}`,
          "x-connector-owner": process.env.CONNECTOR_OWNER,
          "content-type": "application/json",
        },
        body: JSON.stringify({ method: request.method, params: request.params }),
        signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(5000)]),
      });
      if (!response.ok) throw new Error("Connector unavailable");
      send({ jsonrpc: "2.0", id: request.id, result: await response.json() });
    } catch {
      send({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32000, message: "Connector unavailable" },
      });
    } finally {
      pending.delete(request.id);
    }
  })().catch(() =>
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid request" } }),
  );
});
lines.once("close", () => {
  for (const cancellation of pending.values()) cancellation.abort();
});
