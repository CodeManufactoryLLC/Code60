import { AsyncLocalStorage } from "node:async_hooks";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { type JSONRPCMessage, JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";
import type { McpConnectorDefinition } from "../contracts/index.js";
import { guardedFetch, type OwnedProcess, spawnOwnedProcess } from "../platform/index.js";

const MAX_BYTES = 8 * 1024 * 1024;

/** All process creation remains platform-owned; no shell or ambient private environment. */
class OwnedStdio implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private process: OwnedProcess | undefined;
  private pending = Buffer.alloc(0);
  private closing: Promise<void> | undefined;
  constructor(private readonly launch: () => Promise<OwnedProcess>) {}
  async start() {
    const proc = await this.launch();
    this.process = proc;
    if (this.closing) {
      this.closing = undefined;
      await this.close();
      throw new Error("MCP initialization cancelled");
    }
    // Stderr is deliberately drained without recording server-controlled text.
    proc.stderr.resume();
    proc.stdout.on("data", (chunk: Buffer) => {
      try {
        if (this.pending.length + chunk.length > MAX_BYTES) throw new Error();
        this.pending = Buffer.concat([this.pending, chunk]);
        for (;;) {
          const end = this.pending.indexOf(10);
          if (end < 0) break;
          const line = this.pending.subarray(0, end);
          this.pending = this.pending.subarray(end + 1);
          const text = new TextDecoder("utf-8", { fatal: true }).decode(line);
          this.onmessage?.(JSONRPCMessageSchema.parse(JSON.parse(text)));
        }
      } catch {
        this.onerror?.(new Error("MCP protocol message rejected"));
        void this.close().catch(() => {});
      }
    });
    proc.stdout.on("error", () => this.onerror?.(new Error("MCP transport failed")));
    proc.stdin.on("error", () => this.onerror?.(new Error("MCP transport failed")));
    void proc.exited.then(() => this.onclose?.());
  }
  async send(message: JSONRPCMessage) {
    const text = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(text) > MAX_BYTES || !this.process || this.process.hasExited())
      throw new Error("MCP transport unavailable");
    await new Promise<void>((resolve, reject) => {
      this.process?.stdin.write(text, (error) =>
        error ? reject(new Error("MCP transport failed")) : resolve(),
      );
    });
  }
  close(): Promise<void> {
    this.closing ??= this.process?.stop(500) ?? Promise.resolve();
    void this.closing.catch(() => {
      this.closing = undefined;
    });
    return this.closing;
  }
}

/** A bounded stream wrapper applies to event-stream and JSON responses alike. */
function boundedFetch(base: typeof fetch, calls: AsyncLocalStorage<AbortSignal>): typeof fetch {
  return async (input, init) => {
    if (typeof init?.body === "string" && Buffer.byteLength(init.body) > MAX_BYTES)
      throw new Error("MCP request exceeded its limit");
    // The SDK transport signal is connection-wide. Bind only business requests
    // to this call; cancellation notifications must survive that call's abort.
    const business =
      typeof init?.body === "string" && JSON.parse(init.body).method === "tools/call";
    const authority = business ? calls.getStore() : undefined;
    const headers = new AbortController();
    const timer = authority ? undefined : setTimeout(() => headers.abort(), 30_000);
    timer?.unref();
    const signal = AbortSignal.any([
      headers.signal,
      ...(init?.signal ? [init.signal] : []),
      ...(authority ? [authority] : []),
    ]);
    let response: Response;
    try {
      response = await base(input, { ...init, signal, redirect: "error" });
    } finally {
      clearTimeout(timer);
    }
    if (!response.body) return response;
    const reader = response.body.getReader();
    let bytes = 0;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            controller.close();
            return;
          }
          bytes += next.value.byteLength;
          if (bytes > MAX_BYTES) {
            await reader.cancel();
            controller.error(new Error("MCP response exceeded its limit"));
          } else controller.enqueue(next.value);
        } catch {
          controller.error(new Error("MCP response interrupted"));
        }
      },
      cancel: () => reader.cancel(),
    });
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

export interface McpUpstream {
  closed: Promise<void>;
  tools: readonly Record<string, unknown>[];
  call(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
    timeout: number,
  ): Promise<unknown>;
  close(): Promise<void>;
}

/** Authentication is resolved before construction. No SDK auth provider can replay a call. */
export async function connectMcpUpstream(input: {
  definition: McpConnectorDefinition;
  cwd: string;
  environment: Readonly<Record<string, string>>;
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
  fetch?: typeof fetch;
}): Promise<McpUpstream> {
  const { definition, signal } = input;
  const calls = new AsyncLocalStorage<AbortSignal>();
  const network =
    input.fetch ??
    (definition.type === "http"
      ? guardedFetch({
          privateOrigins: [new URL(definition.url).origin],
          maximumBytes: MAX_BYTES,
          streaming: true,
          timeoutMs: 0,
          credentials: Object.values(definition.headers).some(
            (binding) => "credentialRef" in binding,
          ),
        })
      : fetch);
  const fetchMcp = boundedFetch(network, calls);
  const client = new Client({ name: "code60-connector", version: "1" }, { capabilities: {} });
  const transport: Transport =
    definition.type === "stdio"
      ? new OwnedStdio(() =>
          spawnOwnedProcess([definition.command, ...definition.args], input.cwd, {
            ...input.environment,
          }),
        )
      : new StreamableHTTPClientTransport(new URL(definition.url), {
          requestInit: { headers: { ...input.headers }, redirect: "error" },
          fetch: fetchMcp,
          reconnectionOptions: {
            maxRetries: 0,
            initialReconnectionDelay: 0,
            maxReconnectionDelay: 0,
            reconnectionDelayGrowFactor: 1,
          },
        });
  let closing: Promise<void> | undefined;
  let terminated = false;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      let remoteUncertain = false;
      if (
        transport instanceof StreamableHTTPClientTransport &&
        transport.sessionId &&
        !terminated &&
        definition.type === "http"
      ) {
        try {
          const response = await fetchMcp(definition.url, {
            method: "DELETE",
            redirect: "error",
            signal: AbortSignal.timeout(5000),
            headers: {
              ...input.headers,
              "Mcp-Session-Id": transport.sessionId,
              ...(transport.protocolVersion
                ? { "MCP-Protocol-Version": transport.protocolVersion }
                : {}),
            },
          });
          await response.body?.cancel();
          if (!response.ok && response.status !== 404 && response.status !== 405) throw new Error();
          terminated = true;
        } catch {
          remoteUncertain = true;
        }
      }
      const outcomes = await Promise.allSettled([client.close(), transport.close()]);
      if (remoteUncertain || outcomes.some((outcome) => outcome.status === "rejected"))
        throw new Error("MCP cleanup remains unresolved");
    })();
    void closing.catch(() => {
      closing = undefined;
    });
    return closing;
  };
  const onAbort = () => {
    void close().catch(() => {});
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    signal.throwIfAborted();
    await client.connect(transport, { signal, timeout: 30_000 });
    let disconnected!: () => void;
    const closed = new Promise<void>((resolve) => {
      disconnected = resolve;
    });
    const previousClose = transport.onclose;
    transport.onclose = () => {
      previousClose?.();
      disconnected();
    };
    // Transport failures cancel outstanding requests instead of silently resuming an uncertain call.
    transport.onerror = () => {
      void close().catch(() => {});
    };
    const tools: Record<string, unknown>[] = [];
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, { signal, timeout: 30_000 });
      tools.push(...page.tools);
      if (tools.length > 512 || Buffer.byteLength(JSON.stringify(tools)) > MAX_BYTES)
        throw new Error("MCP discovery exceeded its limit");
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error("MCP discovery rejected");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    signal.throwIfAborted();
    // The setup/test budget must never become a lifetime lease for a successful connection.
    signal.removeEventListener("abort", onAbort);
    return {
      closed,
      tools,
      async call(name, args, callSignal, timeout) {
        const deadline = Math.max(1, Math.min(timeout, 2_147_483_647));
        const authority = AbortSignal.any([callSignal, AbortSignal.timeout(deadline)]);
        return calls.run(authority, () =>
          client.callTool({ name, arguments: args }, undefined, {
            signal: authority,
            timeout: deadline,
            resetTimeoutOnProgress: false,
          }),
        );
      },
      close: async () => {
        signal.removeEventListener("abort", onAbort);
        await close();
      },
    };
  } catch {
    signal.removeEventListener("abort", onAbort);
    try {
      await close();
    } catch {
      throw Object.assign(new Error("MCP cleanup remains unresolved"), {
        code: "cleanup-unresolved",
        cleanup: close,
      });
    }
    throw new Error(
      "MCP connection failed; authentication or server configuration may require attention",
    );
  }
}
