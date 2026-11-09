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
import { type ModeChange, type SessionState, supportsModeChange } from "../contracts/index.js";
import { SessionStateTracker } from "./session-state.js";
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
  readonly sessionState: SessionState;
  setMode(change: ModeChange): Promise<void>;
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
  mcp?: { server?: string } | undefined;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Only documented adapter metadata/programmatic names, never titles or tool arguments. */
function mcpAttribution(update: {
  name?: unknown;
  _meta?: unknown;
}): { mcp: { server?: string } | undefined } | undefined {
  const meta = object(update._meta);
  const airMcp = object(object(object(meta.jetbrains).air).mcp);
  const claude = object(meta.claudeCode);
  const name = update.name ?? claude.toolName;
  const match = typeof name === "string" ? /^mcp__([^\r\n]+?)__([^\r\n]+)$/.exec(name) : null;
  const reported = airMcp.server ?? match?.[1];
  const identified =
    meta.is_mcp_tool_call === true || typeof airMcp.tool === "string" || match !== null;
  if (identified) {
    // Names are display labels, not URLs, credentials or arbitrary payloads.
    const server =
      typeof reported === "string" && /^[a-zA-Z0-9_.-]{1,128}$/.test(reported)
        ? reported
        : undefined;
    return { mcp: server === undefined ? {} : { server } };
  }
  // A corrected programmatic name can explicitly replace earlier attribution.
  return typeof name === "string" ? { mcp: undefined } : undefined;
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
        ...mcpAttribution(update),
      };
      if (call.mcp === undefined) delete call.mcp;
      toolCalls.set(update.toolCallId, call);
      return { type: "toolCall", toolCallId: update.toolCallId, ...call };
    }
    case "tool_call_update": {
      const known = toolCalls.get(update.toolCallId);
      const call: KnownToolCall = {
        title: update.title ?? known?.title ?? update.toolCallId,
        kind: update.kind != null ? toToolKind(update.kind) : (known?.kind ?? "other"),
        status: update.status ?? known?.status ?? "pending",
        ...(known?.mcp === undefined ? {} : { mcp: known.mcp }),
        ...mcpAttribution(update),
      };
      if (call.mcp === undefined) delete call.mcp;
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
  return (servers ?? []).map((server) =>
    "command" in server
      ? {
          name: server.name,
          command: server.command,
          args: [...server.args],
          env: server.env.map(({ name, value }) => ({ name, value })),
        }
      : {
          name: server.name,
          type: server.type,
          url: server.url,
          headers: server.headers.map(({ name, value }) => ({ name, value })),
        },
  ) satisfies McpServer[];
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
  const state = new SessionStateTracker();
  let modeRequest: AbortController | undefined;
  let modeRevision = 0;
  const early: { sessionId: string; update: SessionUpdate }[] = [];
  let earlyBytes = 0;
  const startupRaw: RawAcpUpdate[] = [];
  let startupRawBytes = 0;
  const retainRaw = (raw: RawAcpUpdate) => {
    const bytes = new TextEncoder().encode(raw.payload).length;
    if (startupRaw.length < 128 && startupRawBytes + bytes <= RAW_UPDATE_LIMIT) {
      startupRaw.push(raw);
      startupRawBytes += bytes;
    }
  };
  const publishState = (previous: SessionState) => {
    if (JSON.stringify(previous) === JSON.stringify(state.state)) return;
    for (const listener of listeners) listener({ type: "sessionState", state: state.state });
  };
  const trackState = (update: SessionUpdate) => {
    const previous = state.state;
    state.update(update);
    if (
      update.sessionUpdate === "config_option_update" ||
      update.sessionUpdate === "current_mode_update"
    )
      modeRevision++;
    if (!suppressUpdates) publishState(previous);
  };

  const app = client({ name: "code60" })
    .onNotification(methods.client.session.update, ({ params }) => {
      if (sessionId === undefined) {
        // A new session may report state before its ID is returned. Retain only bounded
        // state notifications, and only apply them after matching the response's ID.
        if (
          ["usage_update", "config_option_update", "current_mode_update"].includes(
            params.update.sessionUpdate,
          )
        ) {
          const bytes = new TextEncoder().encode(JSON.stringify(params)).length;
          if (early.length < 128 && earlyBytes + bytes <= RAW_UPDATE_LIMIT) {
            early.push(params);
            earlyBytes += bytes;
          }
        }
        return;
      }
      if (params.sessionId !== sessionId) return;
      trackState(params.update);
      // Tool-call state must track replayed history even when the replay itself is suppressed.
      const update = mapUpdate(params.update, toolCalls);
      if (suppressUpdates) return;
      const raw = rawUpdate(params.update);
      if (listeners.size === 0) retainRaw(raw);
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
      () => reject(new AcpError("ACP transport failed")),
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
      // Keep the SDK's fixed closure diagnostic and our own numeric process-exit context.
      if (error instanceof Error && error.message === "ACP connection closed")
        throw new AcpError("the ACP connection closed");
      if (error instanceof Error && /^agent exited with code \d+$/.test(error.message))
        throw new AcpError(error.message);
      // Provider errors can echo private prompts, tool payloads, or credentials.
      throw new AcpError("ACP request failed; check the agent's connection and configuration");
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
    for (const server of options.mcpServers ?? []) {
      if (
        (server.type === "http" || server.type === "sse") &&
        init.agentCapabilities?.mcpCapabilities?.[server.type] !== true
      ) {
        throw new AcpError(
          `agent '${options.agentName}' does not advertise support for ${server.type.toUpperCase()} MCP servers; use a provider that advertises this transport or change mcpServers in config.json`,
        );
      }
    }
    if (restoreId === undefined) {
      const session = await call(
        ctx.request(methods.agent.session.new, {
          cwd: options.cwd,
          mcpServers: acpMcpServers(options.mcpServers),
        }),
      );
      sessionId = session.sessionId;
      for (const entry of early)
        if (entry.sessionId === sessionId) {
          trackState(entry.update);
          retainRaw(rawUpdate(entry.update));
        }
      early.length = 0;
      state.setup(session);
    } else {
      const method = restoreMethod(init.agentCapabilities ?? {});
      if (method === undefined) {
        throw new AcpRestoreUnavailableError(
          `agent '${options.agentName}' does not advertise ACP session restore`,
        );
      }
      sessionId = restoreId;
      if (method === "resume") {
        const response = await call(
          ctx.request(methods.agent.session.resume, {
            sessionId: restoreId,
            cwd: options.cwd,
            mcpServers: acpMcpServers(options.mcpServers),
          }),
        );
        state.setup(response);
      } else {
        // session/load replays the full prior transcript before responding. Those notifications
        // are already present in the append-only run log, so do not append them again.
        suppressUpdates = true;
        try {
          const response = await call(
            ctx.request(methods.agent.session.load, {
              sessionId: restoreId,
              cwd: options.cwd,
              mcpServers: acpMcpServers(options.mcpServers),
            }),
          );
          state.setup(response);
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
    get sessionState() {
      return state.state;
    },
    async setMode(change) {
      if (busy || modeRequest) throw new Error("the session is busy");
      if (!supportsModeChange(state.state, change))
        throw new Error("This harness mode is no longer available");
      const controller = new AbortController();
      modeRequest = controller;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 15_000);
      const revision = modeRevision;
      try {
        const requestOptions = { cancellationSignal: controller.signal, stopWaitingOnCancel: true };
        if (change.source === "config") {
          const response = await call(
            ctx.request(
              methods.agent.session.setConfigOption,
              {
                sessionId: id,
                configId: change.configId,
                value: change.value,
              },
              requestOptions,
            ),
          );
          const previous = state.state;
          state.config(response.configOptions);
          publishState(previous);
        } else {
          await call(
            ctx.request(
              methods.agent.session.setMode,
              { sessionId: id, modeId: change.value },
              requestOptions,
            ),
          );
          // A notification received during the request is newer authority than its empty response.
          if (modeRevision === revision) {
            const previous = state.state;
            state.confirmLegacy(change.value);
            publishState(previous);
          }
        }
      } catch (error) {
        if (timedOut) {
          const previous = state.state;
          state.unconfirmed();
          publishState(previous);
          throw new Error(
            "Harness mode change timed out; current mode is unconfirmed. Retry to confirm it.",
          );
        }
        throw error;
      } finally {
        clearTimeout(timer);
        if (modeRequest === controller) modeRequest = undefined;
      }
    },
    closed: connection.closed,
    async prompt(text) {
      if (busy) throw new Error("a turn is already in progress");
      if (modeRequest) throw new Error("the session is busy");
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
      modeRequest?.abort();
      connection.close();
    },
    onUpdate(listener) {
      listeners.add(listener);
      for (const raw of startupRaw.splice(0)) listener(raw);
      startupRawBytes = 0;
      return () => listeners.delete(listener);
    },
    onPermission(handler) {
      permissionHandler = handler;
    },
  };
}
