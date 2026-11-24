import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readPrivateJson } from "../platform/index.js";
import { pairingControl } from "./pairing.js";
import { managementRequest, startGateway } from "./server.js";

const owned: { directory: string; gateway: Awaited<ReturnType<typeof startGateway>> }[] = [];
afterEach(async () => {
  for (const fixture of owned.splice(0)) {
    await fixture.gateway.stop();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
async function fixture(
  developmentAssets?: string,
  requirePairing?: boolean,
  developmentPort?: number,
  refreshPath?: (signal: AbortSignal) => Promise<void>,
) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-gateway-")));
  const assets = join(directory, "assets");
  await mkdir(assets);
  await writeFile(join(assets, "index.html"), "<!doctype html><title>Code60</title>");
  const env = {
    ...process.env,
    HOME: directory,
    SHELL: "/bin/sh",
    XDG_DATA_HOME: join(directory, "data"),
    XDG_STATE_HOME: join(directory, "state"),
    XDG_CONFIG_HOME: join(directory, "config"),
  };
  if (requirePairing !== undefined) {
    await mkdir(join(directory, "state/code60/gateway"), { recursive: true, mode: 0o700 });
    await writeFile(
      join(directory, "state/code60/gateway/settings.json"),
      JSON.stringify({ roots: [directory], requirePairing }),
      { mode: 0o600 },
    );
  }
  const gateway = await startGateway({
    env,
    assets,
    roots: [directory],
    ...(developmentAssets ? { developmentAssets } : {}),
    ...(developmentPort === undefined ? {} : { developmentPort }),
    ...(refreshPath ? { refreshPath } : {}),
  });
  owned.push({ directory, gateway });
  return { directory, gateway, env };
}
it("uses the trusted host path boundary before provider detection", async () => {
  const refreshPath = vi.fn(async (signal: AbortSignal) => {
    signal.throwIfAborted();
    throw Error("Isolated path boundary");
  });
  const { directory, gateway } = await fixture(undefined, false, undefined, refreshPath);
  await mkdir(join(directory, "config/code60"), { recursive: true });
  await writeFile(
    join(directory, "config/code60/config.json"),
    JSON.stringify({
      agents: { copilot: { command: [join(directory, "never-executable")] } },
    }),
  );
  await gateway.application.beginAgentSetup({ mode: "primary" });
  const session = gateway.application.snapshot().agentSetup?.session;
  if (!session) throw Error("Missing provider setup session");
  await gateway.application.attemptAgentSetup({ provider: "copilot", sessionId: session.id });
  expect(refreshPath).toHaveBeenCalledOnce();
  expect(gateway.application.snapshot().agentSetup?.session?.phase).toBe("failed");
});
it("restricts explicit ports to valid development asset sessions", async () => {
  await expect(startGateway({ developmentPort: 43160 })).rejects.toThrow(
    "requires development assets",
  );
  for (const port of [0, -1, 1.5, 65536, Number.NaN])
    await expect(
      startGateway({ developmentAssets: "http://127.0.0.1:43161", developmentPort: port }),
    ).rejects.toThrow("between 1 and 65535");
});
it("binds the requested development port while retaining strict origins", async () => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  await new Promise<void>((resolveClose) => probe.close(() => resolveClose()));
  const { gateway } = await fixture("http://127.0.0.1:43161", undefined, address.port);
  expect(gateway.origin).toBe(`http://127.0.0.1:${address.port}`);
  expect((await fetch(`${gateway.origin}/api/connection`)).status).toBe(200);
  expect(
    (await fetch(`${gateway.origin}/api/connection`, { headers: { Origin: "http://127.0.0.1:1" } }))
      .status,
  ).toBe(403);
});
it("authenticates operations, rejects hostile origins and serves only its asset manifest", async () => {
  const { gateway } = await fixture();
  const request = (path: string, value: unknown, headers: Record<string, string> = {}) =>
    fetch(`${gateway.origin}${path}`, {
      method: "POST",
      headers: { Origin: gateway.origin, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(value),
    });
  expect((await fetch(`${gateway.origin}/../../package.json`)).status).toBe(404);
  expect((await fetch(gateway.origin)).headers.get("content-security-policy")).toContain(
    "frame-ancestors 'none'",
  );
  expect(
    (
      await request(
        "/api/pair",
        { code: gateway.proof(), version: 1 },
        { Origin: "https://evil.invalid" },
      )
    ).status,
  ).toBe(403);
  expect((await request("/management/pair", {})).status).toBe(403);
  expect(
    (await request("/api/operation", { id: crypto.randomUUID(), operation: "snapshot" })).status,
  ).toBe(400);
  const session = await (await request("/api/pair", { code: gateway.proof(), version: 1 })).json();
  const auth = {
    "X-Code60-Session": session.token,
    "X-Code60-Generation": String(session.generation),
    "X-Code60-Client": crypto.randomUUID(),
  };
  const events = new AbortController();
  await fetch(`${gateway.origin}/api/events`, { headers: auth, signal: events.signal });
  const result = await request(
    "/api/operation",
    { id: crypto.randomUUID(), operation: "snapshot-summary" },
    auth,
  );
  expect(result.status).toBe(200);
  expect((await result.json()).versions.node).toBe(process.versions.node);
  expect(
    (await request("/api/operation", { id: crypto.randomUUID(), operation: "execute-shell" }, auth))
      .status,
  ).toBe(400);
  expect(
    (
      await request(
        "/api/operation",
        { id: crypto.randomUUID(), operation: "snapshot", extra: true },
        auth,
      )
    ).status,
  ).toBe(400);
  events.abort();
});

it("skips pairing by default but requires a same-origin handshake and session for application access", async () => {
  const { gateway } = await fixture();
  const connect = (headers: Record<string, string>, value: unknown = { version: 1 }) =>
    fetch(`${gateway.origin}/api/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(value),
    });
  expect(await (await fetch(`${gateway.origin}/api/connection`)).json()).toEqual({
    version: 1,
    requirePairing: false,
  });
  expect((await connect({})).status).toBe(403);
  expect((await connect({ Origin: "https://untrusted.invalid" })).status).toBe(403);
  expect((await connect({ Origin: gateway.origin, "Sec-Fetch-Site": "cross-site" })).status).toBe(
    403,
  );
  const hostileHost = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(
      `${gateway.origin}/api/connect`,
      {
        method: "POST",
        headers: {
          Host: "untrusted.invalid",
          Origin: gateway.origin,
          "Content-Type": "application/json",
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );
    request.on("error", reject);
    request.end(JSON.stringify({ version: 1 }));
  });
  expect(hostileHost).toBe(403);
  expect((await connect({ Origin: gateway.origin }, { version: 2 })).status).toBe(400);
  expect((await connect({ Origin: gateway.origin }, { version: 1, extra: true })).status).toBe(400);
  const first = await (await connect({ Origin: gateway.origin })).json();
  expect(first.controlling).toBe(true);
  expect(first.token).toMatch(/^[a-f0-9]{64}$/);
  expect((await (await connect({ Origin: gateway.origin })).json()).controlling).toBe(false);
  expect((await fetch(`${gateway.origin}/api/session`)).status).toBe(400);
  expect(
    (await fetch(`${gateway.origin}/api/session`, { headers: { "X-Code60-Session": first.token } }))
      .status,
  ).toBe(200);
});

it("persists local pairing changes, revokes old sessions and never grants a browser the management setting", async () => {
  const { gateway, env, directory } = await fixture(undefined, false);
  const post = (path: string, value: unknown, headers: Record<string, string> = {}) =>
    fetch(`${gateway.origin}${path}`, {
      method: "POST",
      headers: { Origin: gateway.origin, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(value),
    });
  expect(await pairingControl(env)).toEqual({ requirePairing: false });
  expect((await managementRequest(env, "pair")).code).toBeUndefined();
  const first = await (await post("/api/connect", { version: 1 })).json();
  expect((await post("/management/pairing", { requirePairing: false })).status).toBe(403);
  expect(await pairingControl(env, true)).toEqual({ requirePairing: true });
  expect(gateway.requirePairing).toBe(true);
  const settings = JSON.parse(
    await readFile(join(directory, "state/code60/gateway/settings.json"), "utf8"),
  );
  expect(settings).toEqual({ roots: [directory], requirePairing: true });
  expect((await post("/api/connect", { version: 1 })).status).toBe(403);
  expect(
    (await fetch(`${gateway.origin}/api/session`, { headers: { "X-Code60-Session": first.token } }))
      .status,
  ).toBe(400);
  const proof = (await managementRequest(env, "pair")).code;
  expect(proof).toMatch(/^[a-f0-9]{16}$/);
  const paired = await (await post("/api/pair", { version: 1, code: proof })).json();
  expect(paired.controlling).toBe(true);
  expect((await post("/api/pair", { version: 1, code: proof })).status).toBe(400);
  await pairingControl(env, false);
  expect(
    (
      await fetch(`${gateway.origin}/api/session`, {
        headers: { "X-Code60-Session": paired.token },
      })
    ).status,
  ).toBe(400);
  expect((await post("/api/connect", { version: 1 })).status).toBe(200);
});

it("proxies Vite asset query strings only in development and rejects API query strings", async () => {
  const upstream = createServer((request, response) => {
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(request.url);
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  try {
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("Missing test server");
    const { gateway } = await fixture(`http://127.0.0.1:${address.port}`);
    const asset = await fetch(`${gateway.origin}/main.tsx?v=fixture`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("/main.tsx?v=fixture");
    // Absolute-form HTTP requests can preserve a pathname beginning with //.
    // It must remain a path on Vite, never become a different upstream host.
    const response = await new Promise<{ status: number | undefined; body: string }>(
      (resolve, reject) => {
        const request = httpRequest(
          gateway.origin,
          { path: `${gateway.origin}//127.0.0.1:1/escape?v=fixture` },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () =>
              resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }),
            );
            response.on("error", reject);
          },
        );
        request.on("error", reject);
        request.setTimeout(5_000, () => request.destroy(new Error("Fixture timeout")));
        request.end();
      },
    );
    expect(response).toEqual({ status: 200, body: "//127.0.0.1:1/escape?v=fixture" });
    for (const origin of ["http://untrusted.invalid:1234", "https://127.0.0.1:1234"]) {
      const invalid = await fixture(origin);
      expect((await fetch(`${invalid.gateway.origin}/main.tsx`)).status).toBe(400);
    }
    expect((await fetch(`${gateway.origin}/api/session?v=fixture`)).status).toBe(400);
    const production = await fixture();
    expect((await fetch(`${production.gateway.origin}/index.html?v=fixture`)).status).toBe(400);
  } finally {
    upstream.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
it("holds one storage owner and remains alive after a client disconnects", async () => {
  const { gateway, env, directory } = await fixture();
  await expect(
    startGateway({ env, roots: [directory], assets: join(directory, "assets") }),
  ).rejects.toThrow();
  const paired = await fetch(`${gateway.origin}/api/pair`, {
    method: "POST",
    headers: { Origin: gateway.origin, "Content-Type": "application/json" },
    body: JSON.stringify({ code: gateway.proof(), version: 1 }),
  });
  const session = await paired.json();
  const abort = new AbortController();
  const stream = await fetch(`${gateway.origin}/api/events`, {
    headers: {
      "X-Code60-Session": session.token,
      "X-Code60-Generation": String(session.generation),
      "X-Code60-Client": crypto.randomUUID(),
    },
    signal: abort.signal,
  });
  expect(stream.status).toBe(200);
  abort.abort();
  expect((await fetch(gateway.origin)).status).toBe(200);
});

it("revokes a pending confirmation on explicit takeover and rejects stale decisions and conflicting request IDs", async () => {
  const { gateway } = await fixture();
  const post = (path: string, value: unknown, auth: Record<string, string> = {}) =>
    fetch(`${gateway.origin}${path}`, {
      method: "POST",
      headers: { Origin: gateway.origin, "Content-Type": "application/json", ...auth },
      body: JSON.stringify(value),
    });
  const pair = async () => {
    const session = await (await post("/api/pair", { code: gateway.proof(), version: 1 })).json();
    return {
      session,
      auth: {
        "X-Code60-Session": session.token,
        "X-Code60-Generation": String(session.generation),
        "X-Code60-Client": crypto.randomUUID(),
      },
    };
  };
  const first = await pair();
  const stream = await fetch(`${gateway.origin}/api/events`, {
    headers: first.auth,
    signal: AbortSignal.timeout(10_000),
  });
  const pending = post(
    "/api/operation",
    { id: crypto.randomUUID(), operation: "logs-clear", value: { confirm: true } },
    first.auth,
  );
  const reader = stream.body?.getReader();
  let received = "";
  while (!received.includes('"event":"interaction"')) {
    const frame = await reader?.read();
    if (frame?.done) throw new Error("Interaction stream ended early");
    received += new TextDecoder().decode(frame?.value);
  }
  const interaction = received
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)))
    .find((frame) => frame.event === "interaction").value;
  const second = await pair();
  expect(second.session.controlling).toBe(false);
  const transferred = await (await post("/api/control", {}, second.auth)).json();
  expect(transferred.controlling).toBe(true);
  second.auth["X-Code60-Generation"] = String(transferred.generation);
  expect(await (await pending).json()).toBe(false);
  expect(
    (await post("/api/interaction", { id: interaction.id, accepted: true }, first.auth)).status,
  ).toBe(400);
  expect(
    (
      await post(
        "/api/operation",
        { id: crypto.randomUUID(), operation: "snapshot-summary" },
        first.auth,
      )
    ).status,
  ).toBe(400);
  const active = new AbortController();
  await fetch(`${gateway.origin}/api/events`, { headers: second.auth, signal: active.signal });
  const operation = { id: crypto.randomUUID(), operation: "snapshot-summary" };
  expect((await post("/api/operation", operation, second.auth)).status).toBe(200);
  expect((await post("/api/operation", operation, second.auth)).status).toBe(200);
  expect(
    (
      await post(
        "/api/operation",
        { ...operation, operation: "logs-clear", value: { confirm: true } },
        second.auth,
      )
    ).status,
  ).toBe(400);
  active.abort();
  await reader?.cancel();
});

it("rechecks revoked authorization after receiving a delayed operation body", async () => {
  const { gateway, env } = await fixture();
  const session = await (
    await fetch(`${gateway.origin}/api/connect`, {
      method: "POST",
      headers: { Origin: gateway.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1 }),
    })
  ).json();
  const auth = {
    "X-Code60-Session": session.token,
    "X-Code60-Generation": String(session.generation),
    "X-Code60-Client": crypto.randomUUID(),
  };
  const abort = new AbortController();
  await fetch(`${gateway.origin}/api/events`, { headers: auth, signal: abort.signal });
  const payload = JSON.stringify({ id: crypto.randomUUID(), operation: "snapshot-summary" });
  const request = httpRequest(`${gateway.origin}/api/operation`, {
    method: "POST",
    headers: {
      ...auth,
      Origin: gateway.origin,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      Expect: "100-continue",
    },
  });
  const finished = new Promise<number | undefined>((resolve, reject) => {
    request.once("response", (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.once("error", reject);
  });
  void finished.catch(() => {});
  const ready = once(request, "continue");
  request.setTimeout(5000, () => request.destroy(new Error("Fixture timeout")));
  request.flushHeaders();
  await ready;
  try {
    await pairingControl(env, true);
    request.end(payload);
    expect(await finished).toBe(400);
  } finally {
    abort.abort();
    request.destroy();
  }
});

it("persists an explicit choice matching the default without disconnecting the browser", async () => {
  const { gateway, env, directory } = await fixture();
  const session = await (
    await fetch(`${gateway.origin}/api/connect`, {
      method: "POST",
      headers: { Origin: gateway.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1 }),
    })
  ).json();
  await pairingControl(env, false);
  expect(
    JSON.parse(await readFile(join(directory, "state/code60/gateway/settings.json"), "utf8")),
  ).toEqual({ requirePairing: false });
  expect(
    (
      await fetch(`${gateway.origin}/api/session`, {
        headers: { "X-Code60-Session": session.token },
      })
    ).status,
  ).toBe(200);
});

it.each(["update-summary", "uninstall-summary"] as const)(
  "inspects %s only through authenticated payload-free private management",
  async (action) => {
    const { gateway, env, directory } = await fixture();
    const saved = (await readPrivateJson(
      join(directory, "state/code60/gateway/connection.json"),
      4096,
    )) as { token: string };
    const call = (headers: Record<string, string>, body?: string) =>
      fetch(`${gateway.origin}/management/${action}`, {
        method: "POST",
        headers,
        ...(body ? { body } : {}),
      });
    expect((await call({})).status).toBe(403);
    expect(
      (await call({ "X-Code60-Management": saved.token, Origin: gateway.origin })).status,
    ).toBe(403);
    expect((await call({ "X-Code60-Management": saved.token }, "{}")).status).toBe(400);
    const before = await readdir(join(directory, "state/code60/gateway"));
    const result = await managementRequest(env, action);
    expect(result).toMatchObject({
      pid: process.pid,
      interactiveActive: false,
      scheduledActive: false,
      schedulerAvailable: true,
    });
    if (action === "uninstall-summary") {
      expect(result.scheduledUncertain).toBe(false);
      expect(result.workflows).toEqual({ completed: 0, active: 0, uncertain: 0 });
      expect(await readdir(join(directory, "state/code60"))).not.toContain("workflows");
    }
    expect(await readdir(join(directory, "state/code60/gateway"))).toEqual(before);
    expect((await managementRequest(env, "status")).database).toEqual({ state: "not-selected" });
  },
);

it("keeps damaged private workflow contents out of uninstall inspection errors", async () => {
  const { env, directory } = await fixture();
  const root = join(directory, "state/code60/workflows");
  await mkdir(root, { mode: 0o700 });
  const contents = "private draft fixture that must never appear in errors";
  await writeFile(join(root, "registry.json"), contents, { mode: 0o600 });
  await expect(managementRequest(env, "uninstall-summary")).rejects.toThrow(
    "Workflow history is unavailable; preserve state before uninstalling",
  );
  expect(await readFile(join(root, "registry.json"), "utf8")).toBe(contents);
  expect(await readdir(root)).toEqual(["registry.json"]);
  expect((await managementRequest(env, "status")).pid).toBe(process.pid);
});

it("prepares uninstall only with private authentication and no payload, then keeps all owners quiescent", async () => {
  const { env, directory, gateway } = await fixture();
  const metadata = (await readPrivateJson(
    join(directory, "state/code60/gateway/connection.json"),
    4096,
  )) as { token: string };
  const request = (headers: Record<string, string>, value?: string) =>
    fetch(`${gateway.origin}/management/prepare-uninstall`, {
      method: "POST",
      headers,
      ...(value ? { body: value } : {}),
    });
  expect((await request({})).status).toBe(403);
  expect(
    (await request({ "X-Code60-Management": metadata.token, Origin: gateway.origin })).status,
  ).toBe(403);
  expect((await request({ "X-Code60-Management": metadata.token }, "{}")).status).toBe(400);
  expect((await fetch(`${gateway.origin}/api/connection`)).status).toBe(200);
  expect(await managementRequest(env, "prepare-uninstall")).toEqual({
    quiescent: true,
    pid: process.pid,
    enginePids: [],
  });
  expect((await fetch(`${gateway.origin}/api/connection`)).status).toBe(503);
  expect((await managementRequest(env, "status")).pid).toBe(process.pid);
  await expect(managementRequest(env, "prepare-database")).rejects.toThrow("app is stopping");
  await expect(managementRequest(env, "prepare-uninstall")).rejects.toThrow("Backend is busy");
  expect(await managementRequest(env, "shutdown")).toEqual({ stopped: true });
});

it("releases all idle reservations when native state is uncertain, preserving a usable backend", async () => {
  const { env, directory, gateway } = await fixture();
  const state = join(directory, "state/code60/workflows/transmission-0.1.0-staging.20");
  await mkdir(state, { recursive: true, mode: 0o700 });
  await writeFile(join(state, "evidence.txt"), "retained fixture evidence", { mode: 0o600 });
  await expect(managementRequest(env, "prepare-uninstall")).rejects.toThrow(
    /uncertain|cannot be verified/,
  );
  expect(await readFile(join(state, "evidence.txt"), "utf8")).toBe("retained fixture evidence");
  expect(await readdir(state)).toEqual(["evidence.txt"]);
  expect((await fetch(`${gateway.origin}/api/connection`)).status).toBe(200);
  expect(await managementRequest(env, "prepare-database")).toEqual({ state: "ready" });
});

it("prepares a database only through authenticated payload-free private management", async () => {
  const { gateway, env, directory } = await fixture();
  const saved = (await readPrivateJson(
    join(directory, "state/code60/gateway/connection.json"),
    4096,
  )) as { token: string };
  const call = (headers: Record<string, string>, body?: string) =>
    fetch(`${gateway.origin}/management/prepare-database`, {
      method: "POST",
      headers,
      ...(body ? { body } : {}),
    });
  expect((await call({})).status).toBe(403);
  expect((await call({ "X-Code60-Management": saved.token, Origin: gateway.origin })).status).toBe(
    403,
  );
  expect(
    (
      await call(
        { "X-Code60-Management": saved.token },
        JSON.stringify({ path: "/tmp/untrusted.sqlite" }),
      )
    ).status,
  ).toBe(400);
  expect(await managementRequest(env, "prepare-database")).toEqual({ state: "ready" });
  expect((await managementRequest(env, "status")).database).toEqual({ state: "ready" });
  const path = join(directory, "data/code60/databases/default.sqlite");
  const before = await readFile(path);
  await managementRequest(env, "prepare-database");
  expect(await readFile(path)).toEqual(before);
});
it("normal startup preserves an empty selected file and private setup refuses to initialize it", async () => {
  const { gateway, env, directory } = await fixture();
  await gateway.stop();
  const path = join(directory, "empty.sqlite");
  await writeFile(path, "");
  await writeFile(
    join(directory, "state/code60/desktop.json"),
    JSON.stringify({ database: path }),
    { mode: 0o600 },
  );
  const restarted = await startGateway({
    env,
    assets: join(directory, "assets"),
    roots: [directory],
  });
  const current = owned.at(-1);
  if (!current) throw Error("Missing fixture");
  current.gateway = restarted;
  expect(restarted.application.snapshot().database).toBeNull();
  await expect(managementRequest(env, "prepare-database")).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe("");
});
