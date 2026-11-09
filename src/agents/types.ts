export { TOOL_KINDS } from "../contracts/index.js";

import type { ModeChange, SessionState, StopReason, ToolKind } from "../contracts/index.js";
import type { NativeProcessIdentity } from "../platform/index.js";

export type { StopReason, ToolKind };

/** An ACP session update exactly as received, as JSON text clipped to `RAW_UPDATE_LIMIT` bytes. */
export interface RawAcpUpdate {
  type: "acp";
  /** The update's `sessionUpdate` name, such as `plan` or `usage_update`. */
  update: string;
  payload: string;
  /** Size of the complete JSON text in UTF-8 bytes, before clipping. */
  size: number;
  truncated?: true;
}

export type AgentUpdate =
  | { type: "message"; text: string }
  | { type: "thought"; text: string }
  | {
      type: "toolCall";
      toolCallId: string;
      title: string;
      kind: ToolKind;
      status: string;
      /** Provider-reported attribution, never a server definition or permission grant. */
      mcp?: { server?: string } | undefined;
    }
  | { type: "sessionState"; state: SessionState }
  | RawAcpUpdate;

/** One choice the agent offered for a permission request. */
export interface PermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface PermissionRequest {
  toolCallId: string;
  title: string;
  kind: ToolKind;
  /** The choices the agent offered, recorded for review; only "once" options are ever picked. */
  options?: readonly PermissionOption[];
}

export type PermissionAnswer = "allow" | "deny";

/** Answers one permission request. `signal` aborts when the agent or a cancel withdraws it. */
export type PermissionHandler = (
  request: PermissionRequest,
  signal: AbortSignal,
) => Promise<PermissionAnswer>;

/** Client-provided MCP servers. An omitted type retains the built-in stdio contract. */
export type AgentMcpServer =
  | {
      type?: "stdio";
      name: string;
      command: string;
      args: readonly string[];
      env: readonly { name: string; value: string }[];
    }
  | {
      type: "http" | "sse";
      name: string;
      url: string;
      headers: readonly { name: string; value: string }[];
    };

export interface AgentSpec {
  /** Agent name from the config, used in error messages. */
  name: string;
  command: readonly [string, ...string[]];
  cwd: string;
  env?: Readonly<Record<string, string>>;
  /** MCP servers are supplied only for roles that explicitly request them. */
  mcpServers?: readonly AgentMcpServer[];
}

export interface AgentSession {
  /** ACP session identifier. Persist this to allow an explicit later restore attempt. */
  readonly sessionId: string;
  readonly sessionState?: SessionState;
  setMode?(change: ModeChange): Promise<void>;
  /** PID of the agent process, which is also its process group ID. */
  readonly pid: number;
  /** Native Windows process creation time, owner SID and owned job. Absent on POSIX. */
  readonly identity?: NativeProcessIdentity;
  /** Resolves when the agent process has exited. */
  readonly exited: Promise<void>;
  /** Starts one turn. Rejects if a turn is already in progress, or if the agent exits or ACP fails. */
  prompt(text: string): Promise<StopReason>;
  /** Sends `session/cancel` and withdraws pending permission requests. */
  cancel(): Promise<void>;
  /** Stops the agent's whole process group: SIGTERM, then SIGKILL after `graceMs` (default 5 s). */
  stop(graceMs?: number): Promise<void>;
  /** The last 64 KiB of the agent's standard error. */
  stderrTail(): string;
  onUpdate(listener: (update: AgentUpdate) => void): () => void;
  onPermission(handler: PermissionHandler): void;
}

export interface Agents {
  /** Spawns the agent and opens an ACP session rooted at `spec.cwd`. Aborting `signal` stops it. */
  start(spec: AgentSpec, signal?: AbortSignal): Promise<AgentSession>;
  /** Spawns the configured agent and restores an existing ACP session. */
  restore?(spec: AgentSpec, sessionId: string, signal?: AbortSignal): Promise<AgentSession>;
}

/** The agent failed to start or the ACP session could not be opened. */
export class AgentStartError extends Error {
  constructor(
    message: string,
    readonly stderrTail: string,
    readonly authRequired = false,
    readonly restoreUnavailable = false,
  ) {
    super(message);
    this.name = "AgentStartError";
  }
}
