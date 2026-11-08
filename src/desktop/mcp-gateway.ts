import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { diagnosticText } from "../platform/index.js";

// Worker prompts can be up to 100,000 characters, which is at most 400 KB of UTF-8 plus JSON.
const MAX_REQUEST_BYTES = 512 * 1024;
// A dispatch can wait for the user's native confirmation before the worker is accepted.
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_CONCURRENT_REQUESTS = 8;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface McpGateway {
  readonly url: string;
  readonly token: string;
  close(): Promise<void>;
}

export type McpCallHandler = (name: string, args: unknown) => Promise<unknown>;

function reply(response: ServerResponse, status: number, body: unknown): void {
  let text = JSON.stringify(body);
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    status = 413;
    text = JSON.stringify({ error: "Table response too large; request a smaller page" });
  }
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(text);
}

function bearerMatches(request: IncomingMessage, token: string): boolean {
  const value = request.headers.authorization;
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(value.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("Request too large");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("Invalid JSON request");
  }
}

/** Starts an authenticated HTTP bridge bound exclusively to the IPv4 loopback interface. */
export async function createMcpGateway(handler: McpCallHandler): Promise<McpGateway> {
  const token = randomBytes(32).toString("hex");
  let inFlight = 0;
  const server: Server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/call") {
      reply(response, 404, { error: "Not found" });
      return;
    }
    if (!bearerMatches(request, token)) {
      reply(response, 401, { error: "Unauthorized" });
      return;
    }
    if (inFlight >= MAX_CONCURRENT_REQUESTS) {
      reply(response, 429, { error: "Too many requests" });
      return;
    }
    inFlight++;
    void (async () => {
      try {
        if (!request.headers["content-type"]?.startsWith("application/json")) {
          reply(response, 415, { error: "Expected JSON" });
          return;
        }
        const body = await readBody(request);
        if (
          body === null ||
          typeof body !== "object" ||
          Array.isArray(body) ||
          Object.keys(body).some((key) => key !== "name" && key !== "arguments") ||
          typeof (body as { name?: unknown }).name !== "string"
        ) {
          reply(response, 400, { error: "Invalid tool request" });
          return;
        }
        const { name, arguments: args } = body as { name: string; arguments?: unknown };
        const result = await handler(name, args);
        reply(response, 200, { result });
      } catch (error) {
        // Only an Error's message crosses the boundary; never stringify arbitrary thrown values.
        reply(response, 400, {
          error: error instanceof Error ? diagnosticText(error.message) : "Tool request failed",
        });
      } finally {
        inFlight--;
      }
    })();
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = 10_000;
  server.setTimeout(REQUEST_TIMEOUT_MS, (socket) => socket.destroy());

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Could not start the Code60 MCP gateway");
  }

  let closed = false;
  return {
    url: `http://127.0.0.1:${address.port}/v1/call`,
    token,
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (closed) return resolve();
        closed = true;
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
