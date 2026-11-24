import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { McpConnectorDefinition, McpConnectorDocument } from "../bridge/index.js";
import type {
  AgentMcpServer,
  SessionResourceControls,
  SessionResourceFactory,
} from "../core/index.js";
import {
  fileCode,
  lockPrivateState,
  readPrivateJson,
  writePrivateJson,
} from "../platform/index.js";
import type { McpAuthentication } from "./mcp-authentication.js";
import { type McpConnectorRole, resolveMcpConnectors } from "./mcp-configuration.js";
import { CredentialFailure } from "./mcp-credentials.js";

/** Backend ports. No paths or definitions cross the human/browser runtime surface. */
export interface McpRuntimePorts {
  connect(input: {
    definition: McpConnectorDefinition;
    cwd: string;
    environment: Readonly<Record<string, string>>;
    headers: Readonly<Record<string, string>>;
    fetch?: typeof fetch;
    signal: AbortSignal;
  }): Promise<{
    closed?: Promise<void>;
    tools: readonly Record<string, unknown>[];
    call(
      name: string,
      args: Record<string, unknown>,
      signal: AbortSignal,
      timeout: number,
    ): Promise<unknown>;
    close(): Promise<void>;
  }>;
  expose(input: {
    id: string;
    owner: string;
    tools: readonly Record<string, unknown>[];
    call(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  }): Promise<{ descriptor: AgentMcpServer; revoke(): Promise<void> }>;
}
export interface McpRuntimeSnapshot {
  role: McpConnectorRole;
  user: { document: McpConnectorDocument; revision: string; targetId: string };
  project?: { document: McpConnectorDocument; revision: string; projectId: string };
}
type Upstream = Awaited<ReturnType<McpRuntimePorts["connect"]>>;
type Exposure = Awaited<ReturnType<McpRuntimePorts["expose"]>>;
interface Instance {
  id: string;
  targetId: string;
  revision: string;
  controller?: AbortController;
  status:
    | "connecting"
    | "connected"
    | "failed"
    | "authentication-required"
    | "disconnected"
    | "cleanup-unresolved";
  upstream?: Upstream | undefined;
  exposure?: Exposure;
  cleanup?: Promise<void> | undefined;
  close: () => Promise<void>;
}
interface Session {
  capture: () => Promise<McpRuntimeSnapshot>;
  setup: AbortController;
  initialization?: Promise<unknown>;
  generation: string;
  runId: string;
  targetId: string;
  controls: SessionResourceControls;
  instances: Instance[];
  active: boolean;
  epoch: number;
  deadline: number;
  calls: Set<AbortController>;
  closed: boolean;
}
const stateSchema = z.strictObject({
  version: z.literal(1),
  approvals: z.record(z.string().regex(/^[a-f0-9]{64}$/), z.string().regex(/^[a-f0-9]{64}$/)),
  receipts: z.record(
    z.uuid(),
    z.strictObject({ fingerprint: z.string(), result: z.literal(true) }),
  ),
});
const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const AUTH_REQUIRED = Symbol("authentication-required");
type AuthenticationObservation =
  | "not-checked"
  | "not-required"
  | "required"
  | "authenticated"
  | "failed";
function pendingCleanup(error: unknown): (() => Promise<void>) | undefined {
  if (
    error &&
    typeof error === "object" &&
    "cleanup" in error &&
    typeof error.cleanup === "function"
  )
    return error.cleanup as () => Promise<void>;
  return undefined;
}

/** Configuration trust and call authority are independent from observed connection health. */
export class McpRuntime {
  private opening: Promise<void> | undefined;
  private release: (() => Promise<void>) | undefined;
  private state: z.infer<typeof stateSchema> = { version: 1, approvals: {}, receipts: {} };
  private previous: unknown;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly sessions = new Map<string, Session>();
  private readonly tests = new Map<
    string,
    {
      page: string;
      targetId: string;
      serverId: string;
      controller: AbortController;
      done: Promise<void>;
    }
  >();
  private readonly actions = new Map<string, { fingerprint: string; result: Promise<void> }>();
  private readonly previews = new Map<
    string,
    { page: string; expires: number; fingerprint: string; configuration: string }
  >();
  private readonly testReceipts = new Map<
    string,
    { fingerprint: string; result: ReturnType<McpRuntime["performTest"]> }
  >();
  private readonly observations = new Map<string, Instance["status"]>();
  private readonly authenticationFacts = new Map<string, AuthenticationObservation>();
  private live = 0;
  private initializing = 0;
  private readonly waiters: (() => void)[] = [];
  private closed = false;
  private readonly unresolved = new Set<() => Promise<void>>();
  private closing: Promise<void> | undefined;
  constructor(
    private readonly root: string,
    private readonly ports: McpRuntimePorts | undefined,
    private readonly changed: () => void,
    private readonly baseEnvironment: Readonly<Record<string, string>>,
    private readonly authentication?: Pick<McpAuthentication, "prepare">,
  ) {}
  private open() {
    this.opening ??= (async () => {
      this.release = await lockPrivateState(this.root);
      try {
        this.previous = await readPrivateJson(join(this.root, "trust.json"), 512 * 1024).catch(
          (error) => {
            if (fileCode(error) !== "ENOENT") throw error;
            return undefined;
          },
        );
        if (this.previous !== undefined) this.state = stateSchema.parse(this.previous);
      } catch {
        await this.release();
        this.release = undefined;
        throw new Error("MCP private approval storage is unavailable");
      }
    })();
    return this.opening;
  }
  async approval(projectId: string, revision: string) {
    await this.open();
    return this.state.approvals[projectId] === revision;
  }
  approve(
    projectId: string,
    revision: string,
    requestId: string,
    approved: boolean,
    validate: () => Promise<unknown> = async () => {},
  ) {
    const action = this.queue.then(async () => {
      if (this.closed) throw new Error("MCP runtime is closed");
      await this.open();
      const hash = fingerprint([projectId, revision, approved]);
      const receipt = this.state.receipts[requestId];
      if (receipt) {
        if (receipt.fingerprint !== hash) throw new Error("Conflicting MCP request ID");
        return;
      }
      await validate();
      const next = structuredClone(this.state);
      if (approved) next.approvals[projectId] = revision;
      else delete next.approvals[projectId];
      next.receipts[requestId] = { fingerprint: hash, result: true };
      try {
        await writePrivateJson(join(this.root, "trust.json"), next, this.previous, 512 * 1024);
      } catch {
        this.state.approvals = {};
        throw new Error("MCP approval write is uncertain; inspect private storage before retrying");
      }
      this.state = next;
      this.previous = next;
      this.changed();
    });
    this.queue = action.catch(() => {});
    return action;
  }
  private async permit(signal: AbortSignal) {
    while (this.initializing >= 4) {
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          signal.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          const index = this.waiters.indexOf(wake);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new Error("MCP initialization cancelled"));
        };
        this.waiters.push(wake);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    }
    signal.throwIfAborted();
    this.initializing++;
    return () => {
      this.initializing--;
      this.waiters.shift()?.();
    };
  }
  private bindings(definition: McpConnectorDefinition) {
    const environment: Record<string, string> = Object.assign(
      Object.create(null),
      this.baseEnvironment,
    );
    const headers: Record<string, string> = Object.create(null);
    if (definition.type === "http" && definition.auth.type === "oauth") throw AUTH_REQUIRED;
    for (const [name, binding] of Object.entries(
      definition.type === "stdio" ? definition.env : definition.headers,
    )) {
      if ("credentialRef" in binding) throw AUTH_REQUIRED;
      if (definition.type === "stdio") environment[name] = binding.value;
      else {
        if (
          [
            "host",
            "connection",
            "content-length",
            "content-type",
            "accept",
            "mcp-session-id",
            "mcp-protocol-version",
            "last-event-id",
            "transfer-encoding",
            "upgrade",
            "origin",
            "mcp-method",
            "keep-alive",
            "te",
            "trailer",
            "proxy-connection",
            "proxy-authorization",
            "proxy-authenticate",
          ].includes(name.toLowerCase())
        )
          throw new Error("Transport-owned MCP headers cannot be configured");
        headers[name] = binding.value;
      }
    }
    return { environment, headers };
  }
  private async initialize(
    definition: McpConnectorDefinition,
    cwd: string,
    signal: AbortSignal,
    targetId: string,
    serverId: string,
    revision: string,
  ) {
    if (!this.ports || this.closed) throw new Error("MCP transport is unavailable");
    const release = await this.permit(signal);
    try {
      if (this.live >= 256) throw new Error("MCP connection limit reached");
      let prepared: Awaited<ReturnType<McpAuthentication["prepare"]>> | undefined;
      const key = `${targetId}:${serverId}:${revision}`;
      const needsCredentials =
        (definition.type === "http" && definition.auth.type === "oauth") ||
        Object.values(definition.type === "stdio" ? definition.env : definition.headers).some(
          (item) => "credentialRef" in item,
        );
      let bindings: {
        environment: Record<string, string>;
        headers: Record<string, string>;
        fetch?: typeof fetch;
      };
      try {
        prepared = await this.authentication?.prepare({ targetId, serverId, definition }, signal);
        bindings = prepared
          ? {
              environment: Object.assign(
                Object.create(null),
                this.baseEnvironment,
                prepared.environment,
              ),
              headers: prepared.headers,
              ...(prepared.fetch ? { fetch: prepared.fetch } : {}),
            }
          : this.bindings(definition);
        this.authenticationFacts.set(key, needsCredentials ? "authenticated" : "not-required");
      } catch (error) {
        if (error instanceof CredentialFailure || error === AUTH_REQUIRED) {
          this.authenticationFacts.set(key, "required");
          throw AUTH_REQUIRED;
        }
        this.authenticationFacts.set(key, "failed");
        throw error;
      }
      signal.throwIfAborted();
      if (this.live >= 256) throw new Error("MCP connection limit reached");
      this.live++;
      try {
        const upstream = await this.ports.connect({ definition, cwd, signal, ...bindings });
        if (!prepared) return upstream;
        const authorization = prepared;
        return {
          ...(upstream.closed ? { closed: upstream.closed } : {}),
          tools: upstream.tools,
          call: async (
            name: string,
            args: Record<string, unknown>,
            callSignal: AbortSignal,
            timeout: number,
          ) => {
            await authorization.beforeCall(callSignal);
            callSignal.throwIfAborted();
            return upstream.call(name, args, callSignal, timeout);
          },
          close: () => upstream.close(),
        };
      } catch (error) {
        const cleanup = pendingCleanup(error);
        if (cleanup) this.unresolved.add(cleanup);
        else this.live--;
        throw error;
      }
    } finally {
      release();
    }
  }
  factory(
    capture: () => Promise<McpRuntimeSnapshot>,
    warning: (message: string) => void,
  ): SessionResourceFactory {
    return async (context, signal) => {
      const session: Session = {
        capture,
        setup: new AbortController(),
        generation: randomUUID(),
        runId: context.runId,
        targetId: "",
        controls: context.controls,
        instances: [],
        active: false,
        epoch: 0,
        deadline: 0,
        calls: new Set(),
        closed: false,
      };
      const end = () => {
        session.active = false;
        session.epoch++;
        for (const call of session.calls) call.abort();
        session.calls.clear();
        this.changed();
      };
      const close = async () => {
        if (session.closed && session.instances.every((instance) => !instance.upstream)) return;
        session.closed = true;
        session.setup.abort();
        end();
        await session.initialization?.catch(() => {});
        const results = await Promise.allSettled(
          session.instances.map((instance) => instance.close()),
        );
        this.changed();
        if (results.some((result) => result.status === "rejected"))
          throw new Error("MCP cleanup remains unresolved");
        this.sessions.delete(session.generation);
      };
      try {
        if (this.closed) throw new Error();
        const snapshot = await capture();
        if (this.closed || signal?.aborted) throw new Error("MCP initialization cancelled");
        session.targetId = snapshot.project?.projectId ?? snapshot.user.targetId;
        const approved =
          snapshot.project &&
          (await this.approval(snapshot.project.projectId, snapshot.project.revision));
        const resolved = resolveMcpConnectors({
          ...snapshot,
          ...(approved && snapshot.project
            ? {
                approval: {
                  projectId: snapshot.project.projectId,
                  revision: snapshot.project.revision,
                },
              }
            : {}),
        });
        this.sessions.set(session.generation, session);
        const setup = AbortSignal.any([
          session.setup.signal,
          AbortSignal.timeout(30_000),
          ...(signal ? [signal] : []),
        ]);
        session.initialization = Promise.all(
          resolved.connectors.map(async ({ definition, status }) => {
            if (status.eligibility !== "eligible") {
              if (definition.enabled)
                warning("An MCP server needs project approval. Other tools remain available.");
              return;
            }
            const instance: Instance = {
              id: status.id,
              targetId:
                status.source.scope === "project"
                  ? status.source.projectId
                  : snapshot.user.targetId,
              revision: status.source.revision,
              controller: new AbortController(),
              status: "connecting",
              close: () => {
                if (instance.cleanup) return instance.cleanup;
                instance.status = "disconnected";
                instance.controller?.abort();
                this.observations.set(
                  `${instance.targetId}:${instance.id}:${instance.revision}`,
                  "disconnected",
                );
                instance.cleanup = (async () => {
                  await instance.exposure?.revoke();
                  if (instance.upstream) {
                    await instance.upstream.close();
                    instance.upstream = undefined;
                    this.live--;
                  }
                })();
                void instance.cleanup.catch(() => {
                  instance.cleanup = undefined;
                  instance.status = "cleanup-unresolved";
                  this.observations.set(
                    `${instance.targetId}:${instance.id}:${instance.revision}`,
                    "cleanup-unresolved",
                  );
                  this.changed();
                });
                return instance.cleanup;
              },
            };
            session.instances.push(instance);
            try {
              const upstream = await this.initialize(
                definition,
                context.cwd,
                AbortSignal.any([setup, instance.controller!.signal]),
                instance.targetId,
                instance.id,
                instance.revision,
              );
              instance.upstream = upstream;
              if (session.closed || instance.status !== "connecting") {
                // An earlier disconnect may have settled before connect returned.
                instance.cleanup = undefined;
                throw new Error("MCP session revoked during initialization");
              }
              const exposure = await this.ports!.expose({
                id: status.id,
                owner: session.generation,
                tools: upstream.tools,
                call: async (name, args, requestSignal) => {
                  if (
                    session.closed ||
                    !session.active ||
                    instance.status !== "connected" ||
                    Date.now() >= session.deadline
                  )
                    throw new Error("MCP call is not authorized for this session turn");
                  if (!upstream.tools.some((tool) => tool.name === name))
                    throw new Error("Unknown MCP tool");
                  const epoch = session.epoch;
                  const call = new AbortController();
                  session.calls.add(call);
                  const remaining = Math.max(1, session.deadline - Date.now());
                  const callSignal = AbortSignal.any([
                    call.signal,
                    requestSignal,
                    AbortSignal.timeout(remaining),
                  ]);
                  try {
                    const result = await upstream.call(name, args, callSignal, remaining);
                    if (
                      callSignal.aborted ||
                      epoch !== session.epoch ||
                      !session.active ||
                      instance.status !== "connected"
                    )
                      throw new Error("MCP call authority was revoked");
                    return result;
                  } catch {
                    if (!callSignal.aborted && instance.status === "connected") {
                      instance.status = "failed";
                      this.observations.set(
                        `${instance.targetId}:${status.id}:${instance.revision}`,
                        "failed",
                      );
                      void instance.close().catch(() => {});
                      this.changed();
                    }
                    throw new Error(
                      "MCP call failed or was cancelled; an uncertain result must not be replayed",
                    );
                  } finally {
                    session.calls.delete(call);
                  }
                },
              });
              if (session.closed || instance.status !== "connecting") {
                await exposure.revoke();
                throw new Error("MCP session revoked during adapter setup");
              }
              instance.exposure = exposure;
              instance.status = "connected";
              void upstream.closed?.then(async () => {
                if (instance.status !== "connected") return;
                instance.status = "failed";
                warning(
                  "An MCP connection was lost. Its response may be uncertain; do not replay calls. Other tools remain available.",
                );
                try {
                  await instance.close();
                  instance.status = "failed";
                } catch {
                  instance.status = "cleanup-unresolved";
                }
                this.changed();
              });
            } catch (error) {
              const cleanup = pendingCleanup(error);
              if (cleanup) {
                this.unresolved.delete(cleanup);
                instance.upstream = {
                  tools: [],
                  call: async () => {
                    throw new Error("MCP transport unavailable");
                  },
                  close: cleanup,
                };
              }
              if (instance.upstream) await instance.close().catch(() => {});
              instance.status = instance.upstream
                ? "cleanup-unresolved"
                : error === AUTH_REQUIRED
                  ? "authentication-required"
                  : "failed";
              warning(
                error === AUTH_REQUIRED
                  ? "An MCP server requires authentication. Other tools remain available."
                  : instance.status === "cleanup-unresolved"
                    ? "MCP cleanup could not be verified. Retain backend ownership and process evidence. Other tools remain available."
                    : "An MCP server could not connect. Other tools remain available; reconnect when idle to try again.",
              );
            }
            this.observations.set(
              `${instance.targetId}:${status.id}:${instance.revision}`,
              instance.status,
            );
          }),
        );
        await session.initialization;
        this.changed();
      } catch {
        warning(
          "MCP configuration or private approval storage is unavailable. Managed servers were not connected; other tools remain available.",
        );
      }
      return {
        servers: session.instances.flatMap((instance) =>
          instance.status === "connected" && instance.exposure
            ? [instance.exposure.descriptor]
            : [],
        ),
        beginTurn: (deadline) => {
          end();
          if (!session.closed) {
            session.active = true;
            session.deadline = deadline;
          }
          this.changed();
        },
        endTurn: end,
        close,
      };
    };
  }
  status(targetId: string) {
    return [...this.sessions.values()]
      .filter(
        (session) =>
          session.targetId === targetId ||
          session.instances.some((instance) => instance.targetId === targetId),
      )
      .map((session) => ({
        sessionGeneration: session.generation,
        runId: session.runId,
        idle: session.controls.idle(),
        canReconnect: session.controls.canRestore(),
        connectors: session.instances.map((instance) => ({
          id: instance.id,
          targetId: instance.targetId,
          revision: instance.revision,
          connection: instance.status,
        })),
      }));
  }
  observation(targetId: string, id: string, revision: string) {
    return this.observations.get(`${targetId}:${id}:${revision}`) ?? "not-tested";
  }
  authenticationObservation(
    targetId: string,
    id: string,
    revision: string,
  ): AuthenticationObservation {
    return this.authenticationFacts.get(`${targetId}:${id}:${revision}`) ?? "not-checked";
  }
  test(input: {
    targetId: string;
    serverId: string;
    revision: string;
    definition: McpConnectorDefinition;
    cwd: string;
    page: string;
    requestId: string;
  }) {
    const hash = fingerprint([
      input.targetId,
      input.serverId,
      input.revision,
      input.definition,
      input.cwd,
      input.page,
    ]);
    const previous = this.testReceipts.get(input.requestId);
    if (previous) {
      if (previous.fingerprint !== hash) throw new Error("Conflicting MCP request ID");
      return previous.result;
    }
    if (this.testReceipts.size >= 4096) throw new Error("MCP test receipt limit reached");
    const result = this.performTest(input);
    this.testReceipts.set(input.requestId, { fingerprint: hash, result });
    return result;
  }
  private async performTest(input: {
    targetId: string;
    serverId: string;
    revision: string;
    definition: McpConnectorDefinition;
    cwd: string;
    page: string;
    requestId: string;
  }) {
    if (this.closed || this.tests.has(input.requestId) || this.tests.size >= 256)
      throw new Error("MCP test unavailable or already exists");
    const controller = new AbortController();
    let settled!: () => void;
    const done = new Promise<void>((resolve) => {
      settled = resolve;
    });
    this.tests.set(input.requestId, {
      page: input.page,
      targetId: input.targetId,
      serverId: input.serverId,
      controller,
      done,
    });
    let upstream: Upstream | undefined;
    let result: {
      connection: "connected" | "authentication-required" | "cancelled" | "failed";
      tools: number;
    };
    try {
      upstream = await this.initialize(
        input.definition,
        input.cwd,
        AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
        input.targetId,
        input.serverId,
        input.revision,
      );
      result = { connection: "connected", tools: upstream.tools.length };
    } catch (error) {
      const cleanup = pendingCleanup(error);
      if (cleanup) {
        this.unresolved.delete(cleanup);
        upstream = {
          tools: [],
          call: async () => {
            throw new Error("MCP transport unavailable");
          },
          close: cleanup,
        };
      }
      result = {
        connection:
          error === AUTH_REQUIRED
            ? "authentication-required"
            : controller.signal.aborted
              ? "cancelled"
              : "failed",
        tools: 0,
      };
    }
    try {
      if (upstream) {
        try {
          await upstream.close();
          this.live--;
        } catch {
          const retained = upstream;
          this.unresolved.add(() => retained.close());
          throw new Error(
            "MCP test cleanup could not be verified; retain backend ownership and process evidence",
          );
        }
      }
      return result;
    } finally {
      this.tests.delete(input.requestId);
      settled();
    }
  }
  noteTest(
    targetId: string,
    id: string,
    revision: string,
    outcome: "connected" | "authentication-required" | "failed" | "cancelled",
  ) {
    if (outcome !== "cancelled") this.observations.set(`${targetId}:${id}:${revision}`, outcome);
    this.changed();
  }
  cancelTest(page: string, requestId: string) {
    const test = this.tests.get(requestId);
    if (test?.page === page) test.controller.abort();
  }
  async revokeCredentials(targetId: string, serverId: string) {
    for (const [key, fact] of this.authenticationFacts)
      if (key.startsWith(`${targetId}:${serverId}:`) && fact === "authenticated")
        this.authenticationFacts.set(key, "required");
    for (const test of this.tests.values())
      if (test.targetId === targetId && test.serverId === serverId) test.controller.abort();
    const selected = [...this.sessions.values()].flatMap((session) =>
      session.instances.filter(
        (instance) => instance.targetId === targetId && instance.id === serverId,
      ),
    );
    for (const instance of selected) {
      instance.status = "disconnected";
      instance.controller?.abort();
    }
    const result = await Promise.allSettled(selected.map((instance) => instance.close()));
    this.changed();
    if (result.some((entry) => entry.status === "rejected"))
      throw new Error("Credential authority was revoked; connection cleanup remains unresolved");
  }
  detach(page: string) {
    for (const [id, preview] of this.previews) if (preview.page === page) this.previews.delete(id);
    for (const test of this.tests.values()) if (test.page === page) test.controller.abort();
  }
  preview(
    targetId: string,
    generation: string,
    action: "disconnect" | "reconnect",
    ids: readonly string[],
  ) {
    const session = this.sessions.get(generation);
    if (
      !session ||
      (session.targetId !== targetId &&
        !session.instances.some((instance) => instance.targetId === targetId))
    )
      throw new Error("MCP session changed; reload runtime status");
    if (action === "reconnect" && (!session.controls.idle() || !session.controls.canRestore()))
      throw new Error(
        "Reconnect requires an idle session with load/resume support. Otherwise start a new session.",
      );
    return {
      session,
      connectors: session.instances
        .filter((instance) => action === "reconnect" || ids.includes(instance.id))
        .map((instance) => ({
          id: instance.id,
          targetId: instance.targetId,
          revision: instance.revision,
        })),
    };
  }
  private async configuration(session: Session) {
    const snapshot = await session.capture();
    const approved = snapshot.project
      ? await this.approval(snapshot.project.projectId, snapshot.project.revision)
      : false;
    return { snapshot, approved, hash: fingerprint([snapshot, approved]) };
  }
  async review(
    targetId: string,
    generation: string,
    action: "disconnect" | "reconnect",
    ids: readonly string[],
    page: string,
  ) {
    const reviewed = this.preview(targetId, generation, action, ids);
    const configuration =
      action === "reconnect" ? await this.configuration(reviewed.session) : undefined;
    const connectors = [...reviewed.connectors];
    if (action === "reconnect") {
      const { snapshot, approved } = configuration!;
      const resolved = resolveMcpConnectors({
        ...snapshot,
        ...(approved && snapshot.project
          ? {
              approval: {
                projectId: snapshot.project.projectId,
                revision: snapshot.project.revision,
              },
            }
          : {}),
      });
      for (const { status } of resolved.connectors) {
        const source =
          status.source.scope === "project" ? status.source.projectId : snapshot.user.targetId;
        if (
          status.eligibility === "eligible" &&
          !connectors.some(
            (connector) =>
              connector.id === status.id &&
              connector.targetId === source &&
              connector.revision === status.source.revision,
          )
        )
          connectors.push({ id: status.id, targetId: source, revision: status.source.revision });
      }
    }
    for (const [id, preview] of this.previews)
      if (preview.expires < Date.now()) this.previews.delete(id);
    if (this.previews.size >= 256) throw new Error("MCP decision limit reached");
    const previewId = randomUUID();
    this.previews.set(previewId, {
      page,
      expires: Date.now() + 300_000,
      fingerprint: fingerprint([targetId, generation, action, ids]),
      configuration: configuration?.hash ?? fingerprint(reviewed.connectors),
    });
    return { previewId, connectors };
  }
  async validateReview(
    previewId: string,
    page: string,
    targetId: string,
    generation: string,
    action: "disconnect" | "reconnect",
    ids: readonly string[],
  ) {
    const preview = this.previews.get(previewId);
    if (
      !preview ||
      preview.page !== page ||
      preview.expires < Date.now() ||
      preview.fingerprint !== fingerprint([targetId, generation, action, ids])
    )
      throw new Error("MCP decision expired; review again");
    const { session } = this.preview(targetId, generation, action, ids);
    const current =
      action === "reconnect"
        ? (await this.configuration(session)).hash
        : fingerprint(this.preview(targetId, generation, action, ids).connectors);
    if (current !== preview.configuration)
      throw new Error("MCP configuration or approval changed; review again");
    this.previews.delete(previewId);
  }
  connectionAction(
    targetId: string,
    generation: string,
    action: "disconnect" | "reconnect",
    ids: readonly string[],
    requestId: string,
    validate: () => Promise<unknown>,
  ) {
    const hash = fingerprint([targetId, generation, action, ids]);
    const previous = this.actions.get(requestId);
    if (previous) {
      if (previous.fingerprint !== hash) throw new Error("Conflicting MCP request ID");
      return previous.result;
    }
    if (this.actions.size >= 4096)
      throw new Error(
        "MCP action receipt limit reached; start a new backend before more connection actions",
      );
    const result = (async () => {
      await validate();
      await this.performConnectionAction(targetId, generation, action, ids);
    })();
    this.actions.set(requestId, { fingerprint: hash, result });
    return result;
  }
  private async performConnectionAction(
    targetId: string,
    generation: string,
    action: "disconnect" | "reconnect",
    ids: readonly string[],
  ) {
    const { session } = this.preview(targetId, generation, action, ids);
    if (action === "reconnect") await session.controls.reconnect();
    else {
      const selected = session.instances.filter((instance) => ids.includes(instance.id));
      // Revoke before waiting for any upstream cleanup.
      for (const instance of selected) instance.status = "disconnected";
      await Promise.all(selected.map((instance) => instance.close()));
    }
    this.changed();
  }
  close() {
    this.closing ??= this.finishClose();
    void this.closing.catch(() => {
      this.closing = undefined;
    });
    return this.closing;
  }
  private async finishClose() {
    this.closed = true;
    for (const test of this.tests.values()) test.controller.abort();
    const sessions = [...this.sessions.values()];
    for (const session of sessions) {
      session.closed = true;
      session.setup.abort();
      session.active = false;
      session.epoch++;
      for (const call of session.calls) call.abort();
    }
    await Promise.allSettled([
      ...sessions.map((session) => session.initialization),
      ...[...this.tests.values()].map((test) => test.done),
    ]);
    const results = await Promise.allSettled(
      sessions.flatMap((session) => session.instances.map((instance) => instance.close())),
    );
    const residual = await Promise.allSettled(
      [...this.unresolved].map(async (cleanup) => {
        await cleanup();
        this.unresolved.delete(cleanup);
        this.live--;
      }),
    );
    await this.queue;
    await this.opening?.catch(() => {});
    if ([...results, ...residual].some((result) => result.status === "rejected"))
      throw new Error("MCP cleanup remains unresolved");
    await this.release?.();
  }
}
