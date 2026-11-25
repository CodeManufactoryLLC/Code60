import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectMcpUpstream } from "../agents/index.js";
import {
  ApplicationHost,
  DesktopAutomations,
  DesktopLogStore,
  DesktopWorkflows,
  filePreferences,
  HealthCheckService,
  inspectWorkflowRecordsForUninstall,
  openProjectDatabase,
  prepareCodexEnvironment,
  providerAgents,
  type TransmissionClient,
  type TransmissionRemovalPorts,
} from "../application/index.js";
import { startSchedulerRuntime } from "../automation/index.js";
import {
  chooserRequestSchema,
  connectionRequestSchema,
  GATEWAY_LIMITS,
  GATEWAY_VERSION,
  type GatewayFrame,
  interactionAnswerSchema,
  operationRequestSchema,
  pairingPolicySchema,
  pairingRequestSchema,
  webServerEnabledSchema,
} from "../bridge/index.js";
import { CODE60_VERSION, type CoreDeps, defaultDeps, stateHome } from "../core/index.js";
import {
  diagnosticMessage,
  fileCode,
  isPrivateIPv4,
  lockPrivateState,
  nativeCredentialStore,
  privateDirectory,
  readPrivateJson,
  registerPrivateListener,
  userHome,
  writePrivateJson,
} from "../platform/index.js";
import { Interactions } from "./interactions.js";
import { createLanPublisher } from "./lan-publisher.js";
import { createMcpBroker } from "./mcp-broker.js";
import { openOAuthCallback } from "./oauth-callback.js";
import { applicationOperations } from "./operations.js";
import { Sessions, sameSecret } from "./sessions.js";
import { readGatewaySettings, writeGatewaySettings } from "./settings.js";
import { type LanPublisher, WebServerBeta } from "./web-server.js";

export const gatewayRoot = (env: Readonly<NodeJS.ProcessEnv>) =>
  join(stateHome(env), "code60", "gateway");
export interface GatewayConnection {
  version: number;
  origin: string;
  token: string;
  pid: number;
}
export interface GatewayOptions {
  env?: NodeJS.ProcessEnv;
  deps?: CoreDeps;
  roots?: readonly string[];
  assets?: string;
  modelRoot?: string;
  developmentAssets?: string;
  developmentPort?: number;
  onStop?: () => Promise<void>;
  lanPublisher?: LanPublisher;
  lanAddress?: () => Promise<string | null>;
  lanIntervalMs?: number;
  providerFetch?: typeof fetch;
  providerDownload?: typeof import("../application/index.js").ProviderDownload;
  /** Trusted host composition only; browser/CLI requests cannot select a PATH. */
  refreshPath?: (signal: AbortSignal) => Promise<void>;
  workflowClients?: { current: TransmissionClient; legacy: TransmissionClient };
  workflowRemoval?: TransmissionRemovalPorts;
}
const json = (value: unknown) => JSON.stringify(value ?? null);
async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > GATEWAY_LIMITS.requestBytes) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new Error("Invalid JSON request.");
  }
}
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

/** One application owner and scheduler; clients never construct runtimes or open stores. */
export async function startGateway(options: GatewayOptions = {}) {
  if (
    options.developmentPort !== undefined &&
    (!options.developmentAssets ||
      !Number.isInteger(options.developmentPort) ||
      options.developmentPort < 1 ||
      options.developmentPort > 65535)
  )
    throw new Error("A development port between 1 and 65535 requires development assets.");
  const env = await prepareCodexEnvironment(options.env ?? process.env);
  const lanPublisher =
    options.lanPublisher ??
    (env.CODE60_DEV_LAN_SOCKET ? createLanPublisher(env.CODE60_DEV_LAN_SOCKET) : undefined);
  const assetsRoot = options.assets ?? fileURLToPath(new URL("../renderer/", import.meta.url));
  const assets = new Map<string, string>();
  {
    const entries = await readdir(assetsRoot, { recursive: true, withFileTypes: true }).catch(
      (error) => {
        if (options.developmentAssets && (error as NodeJS.ErrnoException).code === "ENOENT")
          return [];
        throw error;
      },
    );
    for (const item of entries) {
      if (!item.isFile() || item.name.endsWith(".map")) continue;
      const path = join(item.parentPath, item.name);
      const relative = path.slice(assetsRoot.replace(/\/$/, "").length).split("\\").join("/");
      assets.set(relative, path);
    }
  }

  const root = gatewayRoot(env);
  await privateDirectory(root);
  const token = randomBytes(32).toString("hex");
  const sessions = new Sessions();
  const streams = new Map<string, ServerResponse>();
  const owners = new Map<string, string>();
  const clients = new Map<string, string>();
  const calls = new Map<string, number>();
  const receipts = new Map<
    string,
    { fingerprint: string; result: Promise<unknown>; settled: boolean }
  >();
  let sequence = 0;
  let origin = "";
  let webServer: WebServerBeta | undefined;
  let lanGeneration = 0;
  const pairAttempts: number[] = [];
  let settingWrites: Promise<unknown> = Promise.resolve();
  let closing = false;
  let quiescing = false;
  let preparingUninstall = false;
  let uninstallPrepared = false;
  let uninstallProof: { quiescent: true; pid: number; enginePids: number[] } | undefined;
  let stopped: Promise<void> | undefined;
  let shutdownRequested = false;
  let transferring = false;
  let changingPairing = false;
  let pairingChange: Promise<void> | undefined;
  const send = (session: string, event: string, value?: unknown) => {
    const response = streams.get(session);
    if (!response) return;
    const frame: GatewayFrame = { sequence: ++sequence, event, value };
    const text = `data: ${json(frame)}\n\n`;
    if (
      Buffer.byteLength(text) > GATEWAY_LIMITS.streamBytes ||
      response.writableLength > GATEWAY_LIMITS.streamBytes
    ) {
      response.destroy();
      return;
    }
    response.write(text);
  };
  const emit = (event: string, value?: unknown) => {
    const controlling = sessions.controlling;
    if (controlling) send(controlling, event, value);
  };
  const logs = new DesktopLogStore(join(stateHome(env), "code60", "logs"));
  let settings = await readGatewaySettings(root);
  let requirePairing = settings?.requirePairing ?? false;
  const roots = options.roots ?? settings?.roots ?? [userHome(env)];
  if (
    !Array.isArray(roots) ||
    !roots.length ||
    roots.length > 32 ||
    roots.some((p) => typeof p !== "string" || !p.startsWith("/") || p.includes("\0"))
  ) {
    throw new Error("Workspace root configuration is invalid.");
  }
  const release = await lockPrivateState(root);
  const interactions = new Interactions(
    roots,
    (owner, value) => send(owner.split(":")[0] ?? "", "interaction", value),
    (owner, id) => send(owner.split(":")[0] ?? "", "interaction-ended", id),
  );
  let connectorBroker: ReturnType<typeof createMcpBroker> | undefined;
  const closeConnectors = async () => {
    await connectorBroker?.then(
      (broker) => broker.close(),
      () => {},
    );
  };
  const application = new ApplicationHost(
    options.deps ?? defaultDeps(logs.sink),
    env,
    interactions,
    {
      mcpAuthentication: { credentials: nativeCredentialStore(env), callback: openOAuthCallback },
      mcpRuntime: {
        connect: connectMcpUpstream,
        expose: async (input) => {
          if (closing) throw new Error("MCP broker is stopping");
          connectorBroker ??= createMcpBroker();
          return (await connectorBroker).expose(input);
        },
      },

      ...(options.providerDownload ? { providerDownload: options.providerDownload } : {}),
      ...(options.providerFetch ? { providerFetch: options.providerFetch } : {}),
      ...(options.refreshPath ? { refreshPath: options.refreshPath } : {}),
      relay: true,
      memory: true,
      openDatabase: openProjectDatabase,
      preferences: filePreferences(join(stateHome(env), "code60", "desktop.json")),
      ragModelRoot: options.modelRoot ?? fileURLToPath(new URL("../../models/", import.meta.url)),
    },
  );
  // Scheduler dependencies intentionally have no application diagnostic sink.
  let scheduler: Awaited<ReturnType<typeof startSchedulerRuntime>> | undefined;
  let schedulerError: string | null = null;
  try {
    const schedulerDeps = options.deps ?? defaultDeps();
    scheduler = await startSchedulerRuntime(env, {
      ...schedulerDeps,
      agents: providerAgents(schedulerDeps.agents, env),
    });
  } catch {
    schedulerError = "Scheduled jobs are unavailable. Check scheduler storage and ownership.";
  }
  const automationRequest = async (
    value: Parameters<NonNullable<typeof scheduler>["request"]>[0],
  ) => {
    if (!scheduler) throw new Error(schedulerError ?? "Scheduled jobs are unavailable.");
    return scheduler.request(value);
  };
  const automations = new DesktopAutomations(
    env,
    {
      pick: () => interactions.pick("folder"),
      confirm: (title, detail) => interactions.confirm(title, detail),
    },
    () => emit("automation-changed"),
    () => application.snapshot(false, true).agents,
    {
      request: automationRequest,
      subscribe: (listener) => scheduler?.subscribe(listener) ?? (() => {}),
      control: async (_env, action) => {
        if (action !== "status")
          throw new Error("Use code60 service commands to manage the backend.");
        const registration = (await readPrivateJson(join(root, "registration.json"), 16_384).catch(
          (error) => {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            return null;
          },
        )) as { installed?: boolean } | null;
        return {
          installed: registration?.installed === true,
          nativeState: "running" as const,
          service: scheduler?.scheduler.status() ?? null,
        };
      },
    },
  );
  const workflows = new DesktopWorkflows(
    env,
    options.deps ?? defaultDeps(),
    () => interactions.pick("folder"),
    (input, signal) => application.draftWorkflow(input, signal),
    options.workflowClients?.current,
    options.workflowClients?.legacy,
    options.workflowRemoval,
  );
  const startedAt = new Date().toISOString();
  const healthCheck = new HealthCheckService({
    env,
    gateway: () => ({
      appVersion: CODE60_VERSION,
      gatewayVersion: GATEWAY_VERSION,
      pid: process.pid,
      origin: origin || null,
      webServerEnabled: webServer?.status().enabled ?? settings?.webServerEnabled ?? false,
      requirePairing,
      startedAt,
      installMode: options.developmentAssets ? "source" : "managed",
    }),
    appSnapshot: () => application.snapshot(false, true),
    schedulerStatus: async () => {
      const registration = (await readPrivateJson(join(root, "registration.json"), 16_384).catch(
        (error) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          return null;
        },
      )) as { installed?: boolean } | null;
      let recentLowDiskCount = 0;
      let recentFailedCount = 0;
      if (scheduler) {
        try {
          const history = (await scheduler.request({ action: "history", limit: 20 })) as {
            executions?: Array<{ status: string; reason: string | null }>;
          };
          for (const item of history?.executions ?? []) {
            if (item.reason === "low_disk") recentLowDiskCount++;
            if (item.status === "failed" || item.status === "interrupted") recentFailedCount++;
          }
        } catch {
          /* Best-effort execution rollup only. */
        }
      }
      return {
        status: {
          installed: registration?.installed === true,
          nativeState: scheduler ? ("running" as const) : ("unavailable" as const),
          service: scheduler?.scheduler.status() ?? null,
        },
        error: schedulerError,
        recentLowDiskCount,
        recentFailedCount,
      };
    },
    transmissionHealth: (signal) => workflows.inspectTransmissionHealth(signal),
    providers: () => application.healthProviders(),
    refreshPath: (signal) => application.healthRefreshPath(signal),
    detectProvider: (id, signal) => application.healthDetectProvider(id, signal),
    probeProvider: (id, signal) => application.healthProbeProvider(id, signal),
    projectGitStatuses: () => application.healthProjectGitStatuses(),
    memorySnapshot: () => application.memory.snapshot(),
    ragStatus: async () => ({
      status: await application.rag.status(),
      modelRoot: application.healthRagModelRoot(),
    }),
    mcpSummary: () => application.healthMcpSummary(),
    logStatus: () => logs.status(),
  });
  const operations = applicationOperations(
    application,
    logs,
    automations,
    interactions,
    emit,
    workflows,
    healthCheck,
  );
  operations.set("backend-stop", async () => {
    if (
      await interactions.confirm(
        "stop-backend",
        "Interactive agents and scheduled jobs will stop. Approved Transmission workflows keep running; use Apps → Workflows to stop them. History and worktrees are kept. Start Code60 again with code60 service start.",
      )
    )
      shutdownRequested = true;
    return shutdownRequested;
  });
  const disposers = [
    application.subscribe((snapshot) => {
      workflows.observeProvider(
        JSON.stringify([
          snapshot.agentSetup?.primary,
          snapshot.agentSetup?.complete,
          snapshot.agentSetup?.enabled.includes(snapshot.agentSetup.primary ?? ""),
        ]),
      );
      emit("update", snapshot);
    }, true),
    application.mcp.subscribe(() => emit("mcp-changed")),
    application.memory.subscribe(() => emit("memory-changed")),
    application.rag.subscribe((status) => emit("rag-status", status)),
    logs.subscribe(() => emit("logs-changed")),
    healthCheck.subscribe((snapshot) => emit("health-changed", snapshot)),
  ];
  const detach = async (session: string) => {
    const owner = owners.get(session);
    if (owner) {
      interactions.detach(owner);
      application.mcpDetach(owner);
    }
    owners.delete(session);
    clients.delete(session);
    if (sessions.controlling !== session) return;
    application.clearDetailSubscriptions();
    application.knowledge.resetRenderer();
    application.setVisibility({ visible: false, worktrees: false });
    automations.reset();
    healthCheck.cancel();
    await Promise.allSettled([
      workflows.reset(),
      application.cancelDiffReads(),
      application.cancelGitSetup(),
      application.cancelAgentSetup(),
      application.clearSearch(),
    ]);
  };
  const saveSettings = (patch: { requirePairing?: boolean; webServerEnabled?: boolean }) => {
    const task = settingWrites.then(async () => {
      const updated = { ...settings, ...patch };
      await writeGatewaySettings(root, updated, settings);
      settings = updated;
    });
    settingWrites = task.catch(() => {});
    return task;
  };
  const revokeLan = async () => {
    for (const session of sessions.tokens("lan:")) {
      await detach(session);
      send(session, "session-reset");
      streams.get(session)?.end();
      streams.delete(session);
    }
    sessions.revoke("lan:");
    lanGeneration++;
    pairAttempts.length = 0;
  };
  const respond = (response: ServerResponse, value: unknown, status = 200) => {
    const text = json(value);
    if (Buffer.byteLength(text) > GATEWAY_LIMITS.responseBytes)
      throw new Error("Response is too large.");
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(text);
  };
  const handle =
    (remote: boolean, expectedOrigin: () => string) =>
    (request: IncomingMessage, response: ServerResponse) => {
      const origin = expectedOrigin();
      const scope = remote ? `lan:${lanGeneration}:${origin}` : "local";
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
      void (async () => {
        if (
          remote &&
          (webServer?.status().state !== "listening" ||
            (!lanPublisher && !isPrivateIPv4(request.socket.remoteAddress ?? "")))
        ) {
          respond(response, { error: "LAN access is unavailable." }, 503);
          return;
        }
        if (closing) {
          respond(response, { error: "Backend is stopping." }, 503);
          return;
        }
        if (
          request.headers.host !== new URL(origin).host ||
          (request.headers.origin && request.headers.origin !== origin) ||
          (request.headers["sec-fetch-site"] === "cross-site" &&
            !(
              remote &&
              request.method === "GET" &&
              request.headers["sec-fetch-mode"] === "navigate" &&
              request.headers["sec-fetch-dest"] === "document" &&
              request.url === "/"
            ))
        ) {
          respond(response, { error: "Untrusted origin." }, 403);
          return;
        }
        const url = new URL(request.url ?? "/", origin);
        const parameters = [...url.searchParams];
        // Animation replay keys select the same manifested GIF bytes, never a route,
        // file path or credential. Keep all other production query strings rejected.
        const replayAsset =
          request.method === "GET" &&
          assets.has(url.pathname) &&
          extname(url.pathname) === ".gif" &&
          !url.pathname.startsWith("/api/") &&
          !url.pathname.startsWith("/management/") &&
          parameters.length === 1 &&
          parameters[0]?.[0] === "play" &&
          /^[A-Za-z0-9_:.-]{1,96}-[1-9]\d{0,9}$/.test(parameters[0][1]);
        if (
          url.hash ||
          (url.search &&
            !replayAsset &&
            (remote ||
              !options.developmentAssets ||
              url.pathname.startsWith("/api/") ||
              url.pathname.startsWith("/management/")))
        ) {
          respond(response, { error: "Unexpected URL parameters." }, 400);
          return;
        }
        const path = url.pathname;
        if (path.startsWith("/management/")) {
          if (remote) {
            respond(response, { error: "Unauthorized." }, 403);
            return;
          }
          const secret = request.headers["x-code60-management"];
          if (
            request.method !== "POST" ||
            request.headers.origin ||
            typeof secret !== "string" ||
            !sameSecret(secret, token)
          ) {
            respond(response, { error: "Unauthorized." }, 403);
            return;
          }
          if (path === "/management/pair")
            respond(response, {
              ...(requirePairing ? { code: sessions.proof() } : {}),
              requirePairing,
              origin,
              version: GATEWAY_VERSION,
            });
          else if (path === "/management/pairing") {
            const value = await body(request);
            if (value !== null) {
              if (changingPairing || transferring || quiescing || preparingUninstall)
                throw new Error("Backend is busy. Try again.");
              const next = pairingPolicySchema.parse(value).requirePairing;
              if (next !== requirePairing || settings?.requirePairing !== next) {
                changingPairing = true;
                pairingChange = (async () => {
                  const changed = next !== requirePairing;
                  await saveSettings({ requirePairing: next });
                  if (!changed) return;
                  for (const session of streams.keys()) await detach(session);
                  sessions.reset();
                  requirePairing = next;
                  // Revoke view authorization only; approved execution continues.
                  for (const [session, stream] of streams) {
                    send(session, "session-reset");
                    stream.end();
                  }
                  streams.clear();
                  owners.clear();
                  clients.clear();
                })().finally(() => {
                  changingPairing = false;
                  pairingChange = undefined;
                });
                await pairingChange;
              }
            }
            respond(response, { requirePairing });
          } else if (path === "/management/update-summary") {
            for await (const chunk of request)
              if (chunk.length) throw new Error("Update inspection accepts no payload");
            const scheduled = scheduler?.scheduler.status();
            respond(response, {
              pid: process.pid,
              interactiveActive: application.hasActiveWork,
              scheduledActive: scheduled ? scheduled.activeExecutionId !== null : null,
              schedulerAvailable: !!scheduled && !schedulerError,
            });
          } else if (path === "/management/uninstall-summary") {
            for await (const chunk of request)
              if (chunk.length) throw new Error("Uninstall inspection accepts no payload");
            const workflows = await inspectWorkflowRecordsForUninstall(env);
            const scheduled = scheduler?.scheduler.status();
            respond(response, {
              pid: process.pid,
              interactiveActive: application.hasActiveWork,
              scheduledActive: scheduled ? scheduled.activeExecutionId !== null : null,
              schedulerAvailable: !!scheduled && !schedulerError,
              scheduledUncertain: scheduled ? scheduled.block !== null : null,
              workflows,
            });
          } else if (path === "/management/prepare-uninstall") {
            for await (const chunk of request)
              if (chunk.length) throw new Error("Uninstall preparation accepts no payload");
            respond(response, await prepareUninstall());
          } else if (path === "/management/prepare-database") {
            for await (const chunk of request)
              if (chunk.length) throw new Error("Database preparation accepts no payload");
            respond(response, await application.prepareInitialDatabase());
          } else if (path === "/management/status")
            respond(response, {
              pid: process.pid,
              uninstallPrepared,
              appVersion: CODE60_VERSION,
              version: GATEWAY_VERSION,
              requirePairing,
              scheduler: scheduler?.scheduler.status() ?? null,
              schedulerError,
              database: await application.initialDatabaseStatus(),
              engines: {
                bundled: false,
                platform: process.platform === "darwin" ? "supported" : "unsupported",
              },
            });
          else if (path === "/management/shutdown") {
            if (preparingUninstall)
              throw new Error("Backend is preparing to uninstall. Try again.");
            await quiesce();
            respond(response, { stopped: true });
          } else respond(response, { error: "Unknown management operation." }, 404);
          return;
        }
        if (path.startsWith("/api/")) {
          if (quiescing || changingPairing) {
            respond(response, { error: "Backend is stopping." }, 503);
            return;
          }
          if (
            request.method === "POST" &&
            (request.headers.origin !== origin ||
              !request.headers["content-type"]?.startsWith("application/json"))
          ) {
            respond(response, { error: "Untrusted request." }, 403);
            return;
          }
          if (path === "/api/connection" && request.method === "GET") {
            respond(response, {
              version: GATEWAY_VERSION,
              requirePairing: remote || requirePairing,
            });
            return;
          }
          if (path === "/api/connect" && request.method === "POST") {
            connectionRequestSchema.parse(await body(request));
            if (remote || requirePairing) {
              respond(response, { error: "A pairing code is required." }, 403);
              return;
            }
            respond(response, sessions.connect(scope));
            return;
          }
          if (path === "/api/pair" && request.method === "POST") {
            if (remote) {
              const now = Date.now();
              while (pairAttempts.length && (pairAttempts[0] ?? 0) <= now - 60_000)
                pairAttempts.shift();
              if (pairAttempts.length >= 10) {
                respond(response, { error: "Too many pairing attempts. Wait one minute." }, 429);
                return;
              }
              pairAttempts.push(now);
            }
            const value = pairingRequestSchema.parse(await body(request));
            respond(response, sessions.pair(value.code, scope));
            return;
          }
          const header = request.headers["x-code60-session"];
          const session = sessions.authenticate(
            typeof header === "string" ? header : undefined,
            scope,
          );
          const generation = request.headers["x-code60-generation"];
          const client = request.headers["x-code60-client"];
          const owner = `${session}:${sessions.generation}:${client}`;
          if (path === "/api/session" && request.method === "GET") {
            respond(response, sessions.describe(session, scope));
            return;
          }
          if (path === "/api/control" && request.method === "POST") {
            if (transferring || preparingUninstall)
              throw new Error("Backend control is busy. Try again.");
            transferring = true;
            try {
              const previous = sessions.controlling;
              if (previous && previous !== session) await detach(previous);
              const next = sessions.takeControl(session, scope);
              if (previous && previous !== session) {
                send(previous, "control-lost");
                streams.get(previous)?.end();
              }
              respond(response, next.session);
            } finally {
              transferring = false;
            }
            return;
          }
          sessions.assertController(session, generation, scope);
          if (path === "/api/events" && request.method === "GET") {
            if (typeof client !== "string" || !/^[a-f0-9-]{36}$/.test(client))
              throw new Error("Invalid browser page identity.");
            if (clients.get(session) !== client) {
              await detach(session);
              clients.set(session, client);
            }
            owners.set(session, owner);
            interactions.attach(owner);
            streams.get(session)?.end();
            response.writeHead(200, {
              "Content-Type": "text/event-stream",
              "X-Accel-Buffering": "no",
            });
            streams.set(session, response);
            send(session, "resync");
            for (const pending of interactions.list(owner)) send(session, "interaction", pending);
            const heartbeat = setInterval(() => {
              try {
                sessions.assertController(session, generation, scope);
                if (response.writableLength > GATEWAY_LIMITS.streamBytes) response.destroy();
                else response.write(": heartbeat\n\n");
              } catch {
                response.end();
              }
            }, 15_000);
            response.on("close", () => {
              clearInterval(heartbeat);
              if (streams.get(session) !== response) return;
              streams.delete(session);
              const timer = setTimeout(() => {
                if (!streams.has(session)) void detach(session).catch(() => {});
              }, 1500);
              timer.unref();
            });
            return;
          }
          const assertPage = () => {
            sessions.assertController(session, generation, scope);
            if (
              (remote &&
                (webServer?.status().state !== "listening" ||
                  scope !== `lan:${lanGeneration}:${origin}`)) ||
              changingPairing ||
              transferring ||
              quiescing ||
              typeof client !== "string" ||
              clients.get(session) !== client
            )
              throw new Error("This browser connection changed. Reconnect before continuing.");
          };
          assertPage();
          if (request.method !== "POST") {
            respond(response, { error: "Unknown operation." }, 404);
            return;
          }
          if (path === "/api/interaction") {
            await interactions.answer(owner, interactionAnswerSchema.parse(await body(request)));
            respond(response, null);
            return;
          }
          if (path === "/api/chooser") {
            respond(
              response,
              await interactions.choices(owner, chooserRequestSchema.parse(await body(request))),
            );
            return;
          }
          if (path !== "/api/operation") {
            respond(response, { error: "Unknown operation." }, 404);
            return;
          }
          const value = operationRequestSchema.parse(await body(request));
          assertPage();
          const networkOperation =
            value.operation === "web-server-status" ||
            value.operation === "web-server-enabled" ||
            value.operation === "web-server-code";
          const operation = networkOperation
            ? async (input: unknown) => {
                if (!webServer) throw new Error("Web Server Beta is unavailable.");
                if (value.operation === "web-server-status") {
                  if (input != null) throw new Error("Unexpected server status arguments.");
                  return webServer.status(!remote);
                }
                if (remote) throw new Error("Manage Web Server Beta from the localhost browser.");
                if (value.operation === "web-server-enabled") {
                  const next = webServerEnabledSchema.parse(input);
                  await webServer.set(next.enabled);
                  assertPage();
                  return webServer.status(true);
                }
                if (input != null) throw new Error("Unexpected pairing arguments.");
                const state = webServer.status();
                if (!state.enabled || state.state !== "listening" || !state.url)
                  throw new Error("Enable Web Server Beta before creating a code.");
                sessions.clearProofs("lan:");
                return {
                  code: sessions.proof(`lan:${lanGeneration}:${state.url}`),
                  expiresAt: Date.now() + GATEWAY_LIMITS.pairingMs,
                };
              }
            : operations.get(value.operation);
          if (!operation) throw new Error("Unknown application operation.");
          const receiptKey = `${owner}:${value.id}`;
          const fingerprint = createHash("sha256").update(json(value)).digest("hex");
          const privateProgress = ["setup-provider-read", "setup-codex-read"].includes(
            value.operation,
          );
          const existing = privateProgress ? undefined : receipts.get(receiptKey);
          if (existing) {
            if (existing.fingerprint !== fingerprint)
              throw new Error("Request ID was reused with different arguments.");
            respond(response, await existing.result);
            return;
          }
          if (receipts.size >= 256) {
            const disposable = [...receipts].find(([, entry]) => entry.settled);
            if (!disposable)
              throw new Error("Request history is busy. Wait for pending operations.");
            receipts.delete(disposable[0]);
          }
          if ((calls.get(session) ?? 0) >= GATEWAY_LIMITS.requests)
            throw new Error("Too many pending operations.");
          calls.set(session, (calls.get(session) ?? 0) + 1);
          const task = Promise.resolve()
            .then(() => {
              assertPage();
              return interactions.run(owner, () => operation(value.value));
            })
            .finally(() => {
              const remaining = (calls.get(session) ?? 1) - 1;
              if (remaining > 0) calls.set(session, remaining);
              else calls.delete(session);
            });
          const receipt = { fingerprint, result: task, settled: false };
          if (!privateProgress) receipts.set(receiptKey, receipt);
          void task
            .finally(() => {
              receipt.settled = true;
            })
            .catch(() => {});
          void task.catch(() => {});
          respond(response, await task);
          if (shutdownRequested) {
            shutdownRequested = false;
            response.once(
              "finish",
              () => void (options.onStop ? options.onStop() : stop()).catch(() => {}),
            );
          }
          return;
        }
        if (request.method !== "GET") {
          respond(response, { error: "Method not allowed." }, 405);
          return;
        }
        const asset = path === "/" ? "/index.html" : path;
        if (options.developmentAssets && !remote) {
          const upstreamUrl = new URL(options.developmentAssets);
          upstreamUrl.pathname = asset;
          upstreamUrl.search = url.search;
          if (upstreamUrl.protocol !== "http:" || upstreamUrl.hostname !== "127.0.0.1")
            throw new Error("Development assets must use loopback HTTP.");
          const upstream = await fetch(upstreamUrl, {
            redirect: "error",
            signal: AbortSignal.timeout(10_000),
          });
          response.writeHead(upstream.status, {
            "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
          });
          response.end(Buffer.from(await upstream.arrayBuffer()));
          return;
        }
        const file = assets.get(asset);
        if (!file) {
          respond(response, { error: "Not found." }, 404);
          return;
        }
        response.writeHead(200, {
          "Content-Type": mime[extname(file)] ?? "application/octet-stream",
        });
        response.end(await readFile(file));
      })().catch((error: unknown) => {
        if (!response.headersSent) respond(response, { error: diagnosticMessage(error) }, 400);
        else response.destroy();
      });
    };
  const server = createServer(handle(false, () => origin));
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  async function prepareUninstall() {
    if (uninstallPrepared && uninstallProof)
      return { ...uninstallProof, enginePids: [...uninstallProof.enginePids] };
    if (preparingUninstall || quiescing || changingPairing || transferring)
      throw Error("Backend is busy; finish current changes before uninstalling");
    preparingUninstall = true;
    const signal = AbortSignal.timeout(85_000);
    const releases: (() => Promise<void>)[] = [];
    let shutdownStarted = false;
    let failure: unknown;
    let result: { quiescent: true; pid: number; enginePids: number[] } | undefined;
    try {
      if (!scheduler || schedulerError)
        throw Error("Scheduler ownership is unavailable; preserve state before uninstalling");
      releases.push(await scheduler.scheduler.reserveIdleForUninstall(signal));
      releases.push(await application.reserveIdleForUninstall(signal));
      releases.push(await workflows.reserveIdleForUninstall(signal));
      // Existing human operations can settle before reservation; new browser
      // requests are blocked only once all execution owners have granted it.
      quiescing = true;
      const engines = await workflows.prepareUninstall(signal);
      for (const engine of engines) await engine.stop(signal);
      signal.throwIfAborted();
      shutdownStarted = true;
      await quiesce();
      result = {
        quiescent: true,
        pid: process.pid,
        enginePids: [...new Set(engines.flatMap((engine) => [...engine.pids]))],
      };
    } catch (error) {
      failure = error;
    } finally {
      const released = await Promise.allSettled(releases.reverse().map((release) => release()));
      preparingUninstall = false;
      if (released.some((entry) => entry.status === "rejected")) {
        quiescing = true;
        failure = Error(
          "Uninstall reservation cleanup is uncertain; inspect the backend before continuing",
        );
      } else if (failure) quiescing = shutdownStarted;
    }
    if (failure) throw failure;
    if (!result) throw Error("Uninstall preparation is uncertain; preserve the installation");
    uninstallProof = result;
    uninstallPrepared = true;
    return result;
  }
  async function quiesce() {
    quiescing = true;
    await pairingChange?.catch(() => {});
    await webServer?.close();
    interactions.close();
    const results = await Promise.allSettled([
      application.shutdown().finally(closeConnectors),
      scheduler?.stop(),
      workflows.close(),
    ]);
    if (results.some((result) => result.status === "rejected")) {
      quiescing = false;
      throw new Error("Some work could not be stopped. Ownership and evidence were retained.");
    }
  }
  async function stop() {
    stopped ??= (async () => {
      await quiesce();
      closing = true;
      for (const dispose of disposers) dispose();
      healthCheck.dispose();
      automations.reset();
      for (const stream of streams.values()) stream.end();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        // Work is already quiescent. Reconnecting fetch/SSE keepalive sockets
        // must not retain the backend lock after its listener has closed.
        server.closeAllConnections();
      });
      await logs.close();
      await rm(join(root, "connection.json"), { force: true });
      await release();
    })().catch((error) => {
      stopped = undefined;
      throw error;
    });
    return stopped;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.developmentPort ?? 0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not bind the backend.");
    const unregister = registerPrivateListener(address.port);
    server.once("close", unregister);
    origin = `http://127.0.0.1:${address.port}`;
    // The exclusive writer lock is held. Replace only verified dead-owner metadata,
    // using the private storage CAS so an outside change cannot be overwritten.
    const previousConnection = await readGatewayConnection(env).catch((error) => {
      if (fileCode(error) === "ENOENT") return undefined;
      throw error;
    });
    if (previousConnection) {
      let dead = false;
      try {
        process.kill(previousConnection.pid, 0);
      } catch (error) {
        dead = fileCode(error) === "ESRCH";
      }
      if (!dead)
        throw new Error(
          "Backend connection ownership could not be verified. Existing state was preserved.",
        );
    }
    await writePrivateJson(
      join(root, "connection.json"),
      { version: GATEWAY_VERSION, origin, token, pid: process.pid },
      previousConnection,
      4096,
    );
    webServer = new WebServerBeta({
      port: address.port,
      server: (origin) => createServer(handle(true, origin)),
      save: (enabled) => saveSettings({ webServerEnabled: enabled }),
      revoke: revokeLan,
      ...(lanPublisher ? { publisher: lanPublisher } : {}),
      ...(options.lanAddress ? { address: options.lanAddress } : {}),
      ...(options.lanIntervalMs === undefined ? {} : { intervalMs: options.lanIntervalMs }),
      unsupported: env.CODE60_DEV_CONTAINER === "1" && !lanPublisher,
    });
    await application.restore();
    await webServer.start(settings?.webServerEnabled ?? false);
    return {
      origin,
      application,
      scheduler,
      stop,
      proof: () => sessions.proof(),
      get requirePairing() {
        return requirePairing;
      },
    };
  } catch (error) {
    for (const dispose of disposers) dispose();
    healthCheck.dispose();
    await Promise.allSettled([
      webServer?.close(),
      application.shutdown().finally(closeConnectors),
      scheduler?.stop(),
      workflows.close(),
      logs.close(),
    ]);
    server.close();
    await release();
    throw error;
  }
}

async function readGatewayConnection(env: Readonly<NodeJS.ProcessEnv>): Promise<GatewayConnection> {
  const value = (await readPrivateJson(join(gatewayRoot(env), "connection.json"), 4096).catch(
    (error: unknown) => {
      if (fileCode(error) === "ENOENT") throw error;
      throw Error(
        "Backend connection metadata is unavailable or invalid. Existing state was preserved.",
      );
    },
  )) as GatewayConnection;
  if (
    !value ||
    typeof value !== "object" ||
    value.version !== GATEWAY_VERSION ||
    !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(value.origin) ||
    !/^[a-f0-9]{64}$/.test(value.token) ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0
  )
    throw new Error("Backend connection is invalid. Use code60 service status.");
  return value;
}
export async function managementRequest(
  env: Readonly<NodeJS.ProcessEnv>,
  action:
    | "pair"
    | "status"
    | "shutdown"
    | "pairing"
    | "prepare-database"
    | "update-summary"
    | "uninstall-summary"
    | "prepare-uninstall",
  value?: { requirePairing: boolean },
) {
  const connection = await readGatewayConnection(env);
  const response = await fetch(`${connection.origin}/management/${action}`, {
    method: "POST",
    redirect: "error",
    headers: {
      "X-Code60-Management": connection.token,
      ...(action === "pairing" ? { "Content-Type": "application/json" } : {}),
    },
    ...(action === "pairing" ? { body: JSON.stringify(value ?? null) } : {}),
    signal: AbortSignal.timeout(["shutdown", "prepare-uninstall"].includes(action) ? 90_000 : 5000),
  });
  const result = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    throw new Error(typeof result.error === "string" ? result.error : "Backend operation failed.");
  return result;
}
