import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ApplicationHost,
  codexProviderAgents,
  DesktopAutomations,
  DesktopLogStore,
  DesktopWorkflows,
  filePreferences,
  openProjectDatabase,
  prepareCodexEnvironment,
  type TransmissionClient,
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
} from "../bridge/index.js";
import { type CoreDeps, defaultDeps, stateHome } from "../core/index.js";
import {
  diagnosticMessage,
  lockPrivateState,
  privateDirectory,
  readPrivateJson,
  userHome,
  writePrivateJson,
} from "../platform/index.js";
import { Interactions } from "./interactions.js";
import { applicationOperations } from "./operations.js";
import { Sessions, sameSecret } from "./sessions.js";
import { readGatewaySettings, writeGatewaySettings } from "./settings.js";

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
  workflowClients?: { current: TransmissionClient; legacy: TransmissionClient };
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
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
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
  const assetsRoot = options.assets ?? fileURLToPath(new URL("../renderer/", import.meta.url));
  const assets = new Map<string, string>();
  if (!options.developmentAssets) {
    for (const item of await readdir(assetsRoot, { recursive: true, withFileTypes: true })) {
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
  let closing = false;
  let quiescing = false;
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
  const application = new ApplicationHost(
    options.deps ?? defaultDeps(logs.sink),
    env,
    interactions,
    {
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
      agents: codexProviderAgents(schedulerDeps.agents, env),
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
  );
  const operations = applicationOperations(
    application,
    logs,
    automations,
    interactions,
    emit,
    workflows,
  );
  operations.set("backend-stop", async () => {
    if (
      await interactions.confirm(
        "Stop Code60 Backend?",
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
    application.memory.subscribe(() => emit("memory-changed")),
    application.rag.subscribe((status) => emit("rag-status", status)),
    logs.subscribe(() => emit("logs-changed")),
  ];
  const detach = async (session: string) => {
    const owner = owners.get(session);
    if (owner) interactions.detach(owner);
    owners.delete(session);
    clients.delete(session);
    if (sessions.controlling !== session) return;
    application.clearDetailSubscriptions();
    application.knowledge.resetRenderer();
    application.setVisibility({ visible: false, worktrees: false });
    automations.reset();
    await Promise.allSettled([
      workflows.reset(),
      application.cancelDiffReads(),
      application.cancelGitSetup(),
      application.cancelAgentSetup(),
      application.clearSearch(),
    ]);
  };
  const respond = (response: ServerResponse, value: unknown, status = 200) => {
    const text = json(value);
    if (Buffer.byteLength(text) > GATEWAY_LIMITS.responseBytes)
      throw new Error("Response is too large.");
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(text);
  };
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    void (async () => {
      if (closing) {
        respond(response, { error: "Backend is stopping." }, 503);
        return;
      }
      if (
        request.headers.host !== new URL(origin).host ||
        (request.headers.origin && request.headers.origin !== origin) ||
        request.headers["sec-fetch-site"] === "cross-site"
      ) {
        respond(response, { error: "Untrusted origin." }, 403);
        return;
      }
      const url = new URL(request.url ?? "/", origin);
      if (
        url.hash ||
        (url.search &&
          (!options.developmentAssets ||
            url.pathname.startsWith("/api/") ||
            url.pathname.startsWith("/management/")))
      ) {
        respond(response, { error: "Unexpected URL parameters." }, 400);
        return;
      }
      const path = url.pathname;
      if (path.startsWith("/management/")) {
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
            if (changingPairing || transferring || quiescing)
              throw new Error("Backend is busy. Try again.");
            const next = pairingPolicySchema.parse(value).requirePairing;
            if (next !== requirePairing || settings?.requirePairing !== next) {
              changingPairing = true;
              pairingChange = (async () => {
                const changed = next !== requirePairing;
                const updated = { ...settings, requirePairing: next };
                await writeGatewaySettings(root, updated, settings);
                settings = updated;
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
        } else if (path === "/management/status")
          respond(response, {
            pid: process.pid,
            version: GATEWAY_VERSION,
            requirePairing,
            scheduler: scheduler?.scheduler.status() ?? null,
            schedulerError,
          });
        else if (path === "/management/shutdown") {
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
          respond(response, { version: GATEWAY_VERSION, requirePairing });
          return;
        }
        if (path === "/api/connect" && request.method === "POST") {
          connectionRequestSchema.parse(await body(request));
          if (requirePairing) {
            respond(response, { error: "A pairing code is required." }, 403);
            return;
          }
          respond(response, sessions.connect());
          return;
        }
        if (path === "/api/pair" && request.method === "POST") {
          const value = pairingRequestSchema.parse(await body(request));
          respond(response, sessions.pair(value.code));
          return;
        }
        const header = request.headers["x-code60-session"];
        const session = sessions.authenticate(typeof header === "string" ? header : undefined);
        const generation = request.headers["x-code60-generation"];
        const client = request.headers["x-code60-client"];
        const owner = `${session}:${sessions.generation}:${client}`;
        if (path === "/api/session" && request.method === "GET") {
          respond(response, sessions.describe(session));
          return;
        }
        if (path === "/api/control" && request.method === "POST") {
          if (transferring) throw new Error("Control is being transferred. Try again.");
          transferring = true;
          try {
            const previous = sessions.controlling;
            if (previous && previous !== session) await detach(previous);
            const next = sessions.takeControl(session);
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
        sessions.assertController(session, generation);
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
              sessions.assertController(session, generation);
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
          sessions.assertController(session, generation);
          if (
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
        const operation = operations.get(value.operation);
        if (!operation) throw new Error("Unknown application operation.");
        const receiptKey = `${owner}:${value.id}`;
        const fingerprint = createHash("sha256").update(json(value)).digest("hex");
        const existing = receipts.get(receiptKey);
        if (existing) {
          if (existing.fingerprint !== fingerprint)
            throw new Error("Request ID was reused with different arguments.");
          respond(response, await existing.result);
          return;
        }
        if (receipts.size >= 256) {
          const disposable = [...receipts].find(([, entry]) => entry.settled);
          if (!disposable) throw new Error("Request history is busy. Wait for pending operations.");
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
        receipts.set(receiptKey, receipt);
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
      if (options.developmentAssets) {
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
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  async function quiesce() {
    quiescing = true;
    await pairingChange?.catch(() => {});
    interactions.close();
    const results = await Promise.allSettled([
      application.shutdown(),
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
    origin = `http://127.0.0.1:${address.port}`;
    await writePrivateJson(
      join(root, "connection.json"),
      { version: GATEWAY_VERSION, origin, token, pid: process.pid },
      undefined,
      4096,
    );
    await application.restore();
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
    await Promise.allSettled([
      application.shutdown(),
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
  const value = (await readPrivateJson(
    join(gatewayRoot(env), "connection.json"),
    4096,
  )) as GatewayConnection;
  if (
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
  action: "pair" | "status" | "shutdown" | "pairing",
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
    signal: AbortSignal.timeout(action === "shutdown" ? 90_000 : 5000),
  });
  const result = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    throw new Error(typeof result.error === "string" ? result.error : "Backend operation failed.");
  return result;
}
