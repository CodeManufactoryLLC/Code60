import { randomUUID } from "node:crypto";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import { emitLog, type LogSink, logInputSchema } from "../contracts/index.js";
import { diagnosticMessage } from "../platform/index.js";
import { AcpError, AcpRestoreUnavailableError, openSession, restoreSession } from "./acp-client.js";
import { describeExit, spawnAgent } from "./process.js";
import { type AgentSession, type AgentSpec, AgentStartError, type Agents } from "./types.js";

export type * from "./types.js";
export { AgentStartError, TOOL_KINDS } from "./types.js";

/** How long to wait for buffered agent output after the process exits. */
const DRAIN_MS = 1_000;

export function createAgents(options: { clientVersion: string; log?: LogSink }): Agents {
  const launch = async (
    spec: AgentSpec,
    signal: AbortSignal | undefined,
    restoreId?: string,
  ): Promise<AgentSession> => {
    if (signal?.aborted) throw new AgentStartError("agent start cancelled", "");
    let proc: Awaited<ReturnType<typeof spawnAgent>>;
    try {
      proc = await spawnAgent(spec.command, spec.cwd, spec.env);
    } catch (error) {
      throw new AgentStartError(diagnosticMessage(error), "");
    }
    if (signal?.aborted) {
      await proc.stop(0);
      throw new AgentStartError("agent start cancelled", proc.stderrTail());
    }
    const terminated = proc.exited.then(async (info) => {
      await new Promise((resolve) => setTimeout(resolve, DRAIN_MS).unref());
      return new Error(describeExit(info));
    });
    const onAbort = () => void proc.stop().catch(() => {});
    signal?.addEventListener("abort", onAbort, { once: true });

    let session: Awaited<ReturnType<typeof openSession>>;
    try {
      const stream = ndJsonStream(proc.input, proc.output);
      session =
        restoreId === undefined
          ? await openSession(stream, {
              cwd: spec.cwd,
              agentName: spec.name,
              clientVersion: options.clientVersion,
              terminated,
              ...(spec.mcpServers === undefined ? {} : { mcpServers: spec.mcpServers }),
            })
          : await restoreSession(stream, {
              cwd: spec.cwd,
              agentName: spec.name,
              clientVersion: options.clientVersion,
              sessionId: restoreId,
              terminated,
              ...(spec.mcpServers === undefined ? {} : { mcpServers: spec.mcpServers }),
            });
    } catch (error) {
      await proc.stop();
      const message = signal?.aborted ? "agent start cancelled" : diagnosticMessage(error);
      throw new AgentStartError(
        message,
        proc.stderrTail(),
        error instanceof AcpError && error.authRequired,
        error instanceof AcpRestoreUnavailableError,
      );
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
    if (signal?.aborted) {
      session.close();
      await proc.stop();
      throw new AgentStartError("agent start cancelled", proc.stderrTail());
    }

    return {
      sessionId: session.sessionId,
      get sessionState() {
        return session.sessionState;
      },
      setMode: (change) => session.setMode(change),
      pid: proc.pid,
      ...(proc.identity === undefined ? {} : { identity: proc.identity }),
      exited: proc.exited.then(() => {}),
      prompt: (text) => session.prompt(text),
      cancel: () => session.cancel(),
      async stop(graceMs) {
        session.close();
        await proc.stop(graceMs);
      },
      stderrTail: () => proc.stderrTail(),
      onUpdate: (listener) => session.onUpdate(listener),
      onPermission: (handler) => session.onPermission(handler),
    };
  };

  const observed = async (spec: AgentSpec, signal?: AbortSignal, sessionId?: string) => {
    const operationId = spec.diagnostic?.operationId ?? randomUUID();
    const provider = logInputSchema.shape.provider.safeParse(spec.name);
    const metadata = {
      ...spec.diagnostic,
      operationId,
      ...(provider.success && provider.data ? { provider: provider.data } : {}),
    };
    const started = Date.now();
    emitLog(options.log, { ...metadata, event: "provider.connect", outcome: "started" });
    try {
      const session = await launch(spec, signal, sessionId);
      emitLog(options.log, {
        ...metadata,
        event: "provider.connected",
        outcome: "succeeded",
        durationMs: Date.now() - started,
      });
      return session;
    } catch (error) {
      emitLog(options.log, {
        ...metadata,
        event: "provider.connected",
        outcome: signal?.aborted ? "cancelled" : "failed",
        durationMs: Date.now() - started,
        errorCategory: "transport",
        errorCode: "UNKNOWN",
      });
      throw error;
    }
  };
  return {
    start: (spec, signal) => observed(spec, signal),
    restore: (spec, sessionId, signal) => observed(spec, signal, sessionId),
  };
}

export { ACP_PROTOCOL_VERSION, openSession } from "./acp-client.js";
