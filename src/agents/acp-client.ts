import {
  type AgentApp,
  client,
  type McpServer,
  methods,
  type NewSessionRequest,
  PROTOCOL_VERSION,
  RequestError,
  type SessionUpdate,
  type Stream,
} from "@agentclientprotocol/sdk";
import type { AgentMcpServer } from "./types.js";
import {
  type AgentUpdate,
  type PermissionHandler,
  type RawAcpUpdate,
  type StopReason,
  TOOL_KINDS,
  type ToolKind,
} from "./types.js";

const AUTH_REQUIRED = -32000;

export interface AcpSession {
  readonly sessionId: string;
  readonly closed: Promise<void>;
  prompt(text: string): Promise<StopReason>;
  cancel(): Promise<void>;
  close(): void;
  onUpdate(listener: (update: AgentUpdate) => void): () => void;
  onPermission(handler: PermissionHandler): void;
}

export interface OpenSessionOptions {
  cwd: string;
  agentName: string;
  /** Resolves with an error when the transport is gone, such as when the agent process exits. */
  terminated?: Promise<Error>;
  mcpServers?: readonly AgentMcpServer[];
  /** Sent as ACP `clientInfo` when given. */
  clientVersion?: string;
}

export interface RestoreSessionOptions extends OpenSessionOptions {
  sessionId: string;
}

export class AcpError extends Error {
  constructor(
    message: string,
    readonly authRequired = false,
  ) {
    super(message);
    this.name = "AcpError";
  }
}

export class AcpRestoreUnavailableError extends AcpError {
  constructor(message: string) {
    super(message);
    this.name = "AcpRestoreUnavailableError";
  }
}

export type RestoreMethod = "resume" | "load" | undefined;

/** ACP v1 prefers `session/resume`, with `session/load` as the transcript-replaying fallback. */
export function restoreMethod(capabilities: {
  loadSession?: boolean | undefined;
  sessionCapabilities?: { resume?: unknown } | undefined;
}): RestoreMethod {
  if (capabilities.sessionCapabilities?.resume != null) return "resume";
  if (capabilities.loadSession === true) return "load";
  return undefined;
}

export function toToolKind(kind: unknown): ToolKind {
  return typeof kind === "string" && (TOOL_KINDS as readonly string[]).includes(kind)
    ? (kind as ToolKind)
    : "other";
}

interface KnownToolCall {
  title: string;
  kind: ToolKind;
  status: string;
}

/** Upper bound on one raw update's stored JSON text, in UTF-8 bytes. */
export const RAW_UPDATE_LIMIT = 256 * 1024;

/** Keeps an ACP update verbatim, clipping its JSON text so one update cannot grow the log unbounded. */
export function rawUpdate(update: SessionUpdate): RawAcpUpdate {
  const payload = JSON.stringify(update);
  const bytes = new TextEncoder().encode(payload);
  const name = (update as { sessionUpdate?: unknown }).sessionUpdate;
  const raw = {
    type: "acp" as const,
    update: typeof name === "string" ? name : "unknown",
    size: bytes.length,
  };
  if (bytes.length <= RAW_UPDATE_LIMIT) return { ...raw, payload };
  // Streaming decode omits an incomplete trailing code point without dropping literal U+FFFD.
  const clipped = new TextDecoder().decode(bytes.subarray(0, RAW_UPDATE_LIMIT), { stream: true });
  return { ...raw, payload: clipped, truncated: true };
}

/** Translates one ACP session update. Returns undefined for updates the tool does not use. */
export function mapUpdate(
  update: SessionUpdate,
  toolCalls: Map<string, KnownToolCall>,
): AgentUpdate | undefined {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk": {
      if (update.content.type !== "text") return undefined;
      const type = update.sessionUpdate === "agent_message_chunk" ? "message" : "thought";
      return { type, text: update.content.text };
    }
    case "tool_call": {
      const call: KnownToolCall = {
        title: update.title,
        kind: toToolKind(update.kind),
        status: update.status ?? "pending",
      };
      toolCalls.set(update.toolCallId, call);
      return { type: "toolCall", toolCallId: update.toolCallId, ...call };
    }
    case "tool_call_update": {
      const known = toolCalls.get(update.toolCallId);
      const call: KnownToolCall = {
        title: update.title ?? known?.title ?? update.toolCallId,
        kind: update.kind != null ? toToolKind(update.kind) : (known?.kind ?? "other"),
        status: update.status ?? known?.status ?? "pending",
      };
      toolCalls.set(update.toolCallId, call);
      return { type: "toolCall", toolCallId: update.toolCallId, ...call };
    }
    default:
      return undefined;
  }
}

function isAuthError(error: unknown): boolean {
  return error instanceof RequestError && error.code === AUTH_REQUIRED;
}

function authMessage(agentName: string): string {
  return `agent '${agentName}' requires authentication; log in through ${agentName}'s own CLI, then try again`;
}

const CANCELLED = { outcome: { outcome: "cancelled" as const } };

function acpMcpServers(
  servers: readonly AgentMcpServer[] | undefined,
): NewSessionRequest["mcpServers"] {
  return (servers ?? []).map((server) => ({
    name: server.name,
    command: server.command,
    args: [...server.args],
    env: server.env.map(({ name, value }) => ({ name, value })),
  })) satisfies McpServer[];
}

export const ACP_PROTOCOL_VERSION: number = PROTOCOL_VERSION;

/** Initializes ACP over `target` and creates a session rooted at `cwd`. */
export async function openSession(
  target: Stream | AgentApp,
  options: OpenSessionOptions,
): Promise<AcpSession> {
  return connectSession(target, options);
}

/** Initializes ACP and restores a previously saved session, without creating a new one. */
export async function restoreSession(
  target: Stream | AgentApp,
  options: RestoreSessionOptions,
): Promise<AcpSession> {
  return connectSession(target, options, options.sessionId);
}

async function connectSession(
  target: Stream | AgentApp,
  options: OpenSessionOptions,
  restoreId?: string,
): Promise<AcpSession> {
  const listeners = new Set<(update: AgentUpdate) => void>();
  const toolCalls = new Map<string, KnownToolCall>();
  const pendingPermissions = new Set<AbortController>();
  let permissionHandler: PermissionHandler | undefined;
  let sessionId: string | undefined;
  let busy = false;
  let suppressUpdates = false;

  const app = client({ name: "code60" })
    .onNotification(methods.client.session.update, ({ params }) => {
      if (sessionId === undefined || params.sessionId !== sessionId) return;
      // Tool-call state must track replayed history even when the replay itself is suppressed.
      const update = mapUpdate(params.update, toolCalls);
      if (suppressUpdates) return;
      const raw = rawUpdate(params.update);
      for (const listener of listeners) {
        listener(raw);
        if (update !== undefined) listener(update);
      }
    })
    .onRequest(methods.client.session.requestPermission, async ({ params, signal }) => {
      if (params.sessionId !== sessionId || permissionHandler === undefined) return CANCELLED;
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      pendingPermissions.add(controller);
      try {
        const { toolCall } = params;
        const answer = await new Promise<"allow" | "deny" | undefined>((resolve, reject) => {
          controller.signal.addEventListener("abort", () => resolve(undefined), { once: true });
          (permissionHandler as PermissionHandler)(
            {
              toolCallId: toolCall.toolCallId,
              title:
                toolCall.title ?? toolCalls.get(toolCall.toolCallId)?.title ?? toolCall.toolCallId,
              kind: toToolKind(toolCall.kind),
              options: params.options.map((option) => ({
                optionId: option.optionId,
                name: option.name,
                kind: option.kind,
              })),
            },
            controller.signal,
          ).then(resolve, reject);
        });
        if (answer === undefined || controller.signal.aborted) return CANCELLED;
        const wanted = answer === "allow" ? "allow_once" : "reject_once";
        const option = params.options.find((o) => o.kind === wanted);
        if (option === undefined) return CANCELLED;
        return { outcome: { outcome: "selected" as const, optionId: option.optionId } };
      } finally {
        signal.removeEventListener("abort", abort);
        pendingPermissions.delete(controller);
      }
    });

  const connection = app.connect(target as Stream);
  const ctx = connection.agent;
  const terminated = new Promise<never>((_, reject) => {
    options.terminated?.then(reject);
    connection.closed.then(
      () => reject(new AcpError("the ACP connection closed")),
      (error: unknown) => reject(new AcpError(`ACP failed: ${String(error)}`)),
    );
  });
  // Callers only see this through races below; keep it from surfacing as unhandled.
  terminated.catch(() => {});

  const call = async <T>(promise: Promise<T>): Promise<T> => {
    try {
      return await Promise.race([promise, terminated]);
    } catch (error) {
      if (isAuthError(error)) throw new AcpError(authMessage(options.agentName), true);
      if (error instanceof AcpError) throw error;
      throw new AcpError(
        `ACP request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  try {
    const init = await call(
      ctx.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        ...(options.clientVersion === undefined
          ? {}
          : { clientInfo: { name: "code60", version: options.clientVersion } }),
      }),
    );
    if (init.protocolVersion !== PROTOCOL_VERSION) {
      throw new AcpError(`agent uses unsupported ACP protocol version ${init.protocolVersion}`);
    }
    if (restoreId === undefined) {
      const session = await call(
        ctx.request(methods.agent.session.new, {
          cwd: options.cwd,
          mcpServers: acpMcpServers(options.mcpServers),
        }),
      );
      sessionId = session.sessionId;
    } else {
      const method = restoreMethod(init.agentCapabilities ?? {});
      if (method === undefined) {
        throw new AcpRestoreUnavailableError(
          `agent '${options.agentName}' does not advertise ACP session restore`,
        );
      }
      sessionId = restoreId;
      if (method === "resume") {
        await call(
          ctx.request(methods.agent.session.resume, {
            sessionId: restoreId,
            cwd: options.cwd,
            mcpServers: acpMcpServers(options.mcpServers),
          }),
        );
      } else {
        // session/load replays the full prior transcript before responding. Those notifications
        // are already present in the append-only run log, so do not append them again.
        suppressUpdates = true;
        try {
          await call(
            ctx.request(methods.agent.session.load, {
              sessionId: restoreId,
              cwd: options.cwd,
              mcpServers: acpMcpServers(options.mcpServers),
            }),
          );
        } finally {
          suppressUpdates = false;
        }
      }
    }
  } catch (error) {
    connection.close();
    throw error;
  }
  const id = sessionId;

  return {
    sessionId: id,
    closed: connection.closed,
    async prompt(text) {
      if (busy) throw new Error("a turn is already in progress");
      busy = true;
      try {
        const response = await call(
          ctx.request(methods.agent.session.prompt, {
            sessionId: id,
            prompt: [{ type: "text", text }],
          }),
        );
        return response.stopReason;
      } finally {
        busy = false;
      }
    },
    async cancel() {
      for (const controller of pendingPermissions) controller.abort();
      await Promise.race([ctx.notify(methods.agent.session.cancel, { sessionId: id }), terminated]);
    },
    close() {
      connection.close();
    },
    onUpdate(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onPermission(handler) {
      permissionHandler = handler;
    },
  };
}
