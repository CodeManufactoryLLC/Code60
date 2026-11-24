import type { AgentMcpServer, AgentSession, AgentSpec, Agents } from "../agents/index.js";

/** Ephemeral desktop resources. Never serialize these into a run record. */
export interface SessionResourceControls {
  idle(): boolean;
  canRestore(): boolean;
  reconnect(): Promise<void>;
}
interface SessionResources {
  servers: readonly AgentMcpServer[];
  beginTurn(deadline: number): void;
  endTurn(): void;
  close(): Promise<void>;
}
export type SessionResourceFactory = (
  context: { runId: string; provider: string; cwd: string; controls: SessionResourceControls },
  signal?: AbortSignal,
) => Promise<SessionResources>;

/** The hook is explicit and per-run; helpers and scheduler dependencies remain undecorated. */
export function sessionResourceAgents(
  agents: Agents,
  factory: SessionResourceFactory | undefined,
  runId: string,
  timeout: number,
  controls: SessionResourceControls,
): Agents {
  if (!factory) return agents;
  const launch = async (
    spec: AgentSpec,
    signal?: AbortSignal,
    restoreId?: string,
  ): Promise<AgentSession> => {
    const resources = await factory(
      { runId, provider: spec.name, cwd: spec.cwd, controls },
      signal,
    );
    let cleanup: Promise<void> | undefined;
    const close = () => {
      cleanup ??= resources.close();
      void cleanup.catch(() => {
        cleanup = undefined;
      });
      return cleanup;
    };
    let session: AgentSession;
    try {
      const prepared = resources.servers.length
        ? { ...spec, mcpServers: [...(spec.mcpServers ?? []), ...resources.servers] }
        : spec;
      if (restoreId !== undefined) {
        if (!agents.restore) throw new Error("ACP restoration is unavailable");
        session = await agents.restore(prepared, restoreId, signal);
      } else session = await agents.start(prepared, signal);
    } catch (error) {
      await close();
      throw error;
    }
    // Exit remains a process observation; cleanup failures are reported by stop/coordinator.
    const exited = session.exited.then(async () => {
      await close().catch(() => {});
    });
    const overrides = {
      exited,
      async prompt(text: string) {
        resources.beginTurn(Date.now() + timeout);
        try {
          return await session.prompt(text);
        } finally {
          resources.endTurn();
        }
      },
      cancel() {
        resources.endTurn();
        return session.cancel();
      },
      async stop(grace?: number) {
        resources.endTurn();
        const results = await Promise.allSettled([close(), session.stop(grace)]);
        if (results.some((result) => result.status === "rejected"))
          throw new Error("Session resources require cleanup");
      },
    };
    // Preserve dynamic state/capabilities and prototype methods of the underlying adapter.
    return new Proxy(session, {
      get(target, property) {
        if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  return {
    start: (spec, signal) => launch(spec, signal),
    ...(agents.restore
      ? { restore: (spec: AgentSpec, id: string, signal?: AbortSignal) => launch(spec, signal, id) }
      : {}),
  };
}
