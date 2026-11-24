import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectMcpUpstream, createAgents } from "../src/agents/index.js";
import {
  type AuthenticationCapture,
  McpAuthentication,
} from "../src/application/mcp-authentication.js";
import { McpRuntime } from "../src/application/mcp-runtime.js";
import { createMcpBroker } from "../src/gateway/mcp-broker.js";
import { openOAuthCallback } from "../src/gateway/oauth-callback.js";
import type { CredentialStorePort } from "../src/platform/index.js";
import { oauthServer } from "./fixtures/mcp-oauth-server.js";

let root: string, auth: McpAuthentication, remote: Awaited<ReturnType<typeof oauthServer>>;
let state: "available" | "locked" | "unavailable", storage: Map<string, string>;
let native: CredentialStorePort;
let valid: boolean;
let captured: AuthenticationCapture;
const revoke = vi.fn<(targetId: string, serverId: string) => Promise<void>>(async () => {});
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "code60-authentication-")));
  remote = await oauthServer();
  state = "available";
  storage = new Map();
  valid = true;
  revoke.mockClear();
  native = vi.fn<CredentialStorePort>(async (request) => {
    if (state !== "available") return { status: state };
    const key = `${request.service}:${request.account}`;
    if (request.action === "set") storage.set(key, request.secret);
    if (request.action === "delete") storage.delete(key);
    return {
      status: "available",
      ...(request.action === "get" ? { secret: storage.get(key) ?? null } : {}),
    };
  });
  auth = new McpAuthentication(
    join(root, "auth"),
    { credentials: native, callback: openOAuthCallback },
    () => {},
    revoke,
  );
  captured = {
    targetId: "a".repeat(64),
    serverId: "service",
    revision: "b".repeat(64),
    definition: {
      label: "Synthetic",
      enabled: true,
      type: "http",
      url: `${remote.origin}/mcp`,
      headers: {},
      auth: { type: "oauth", scopes: [], clientId: "supplied-native" },
    },
    validate: async () => {
      if (!valid) throw new Error("Synthetic owner changed");
    },
  };
});
afterEach(async () => {
  vi.restoreAllMocks();
  await auth.close();
  await remote.close();
  await rm(root, { recursive: true, force: true });
});
async function review() {
  const first = await auth.preview(captured, "page");
  expect(first.issuers).toEqual([remote.issuer]);
  expect(first.issuer).toBeUndefined();
  return auth.preview(captured, "page", remote.issuer);
}
async function signedIn(mode: "persistent" | "temporary" = "temporary") {
  const preview = await review();
  const started = await auth.start(captured, "page", preview.previewId!, mode);
  const url = new URL(started.authorizationUrl!);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("state")!.length).toBeGreaterThanOrEqual(43);
  expect(url.searchParams.get("code_challenge")!.length).toBe(43);
  expect(url.searchParams.get("resource")).toBe(`${remote.origin}/mcp`);
  const callback = remote.issue(url.href);
  expect((await fetch(callback)).status).toBe(200);
  await vi.waitFor(
    async () => expect((await auth.status(captured, "page")).status).toBe("authenticated"),
    { timeout: 4000 },
  );
  return { started, callback, preview };
}
async function fileTexts(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) output.push(...(await fileTexts(path)));
    else output.push(await readFile(path, "utf8"));
  }
  return output;
}
it("reviews issuer/scopes, uses PKCE/resource binding, then calls real MCP without putting secrets on discovery or disk", async () => {
  await signedIn();
  const prepared = await auth.prepare(captured, AbortSignal.timeout(5000));
  const upstream = await connectMcpUpstream({
    definition: captured.definition,
    cwd: root,
    ...prepared,
    signal: AbortSignal.timeout(5000),
  });
  try {
    expect(upstream.tools).toHaveLength(1);
    expect(
      await upstream.call("echo", { text: "synthetic" }, AbortSignal.timeout(5000), 5000),
    ).toMatchObject({ content: [{ text: "synthetic result" }] });
  } finally {
    await upstream.close();
  }
  expect(remote.counts).toMatchObject({ token: 1, calls: 1 });
  expect(
    remote.events
      .filter((event) => event.path !== "/mcp")
      .every((event) => event.authorization !== "bearer"),
  ).toBe(true);
  expect(remote.events.find((event) => event.path === "/token")).toMatchObject({
    pkceValid: true,
    resourceBound: true,
  });
  const files = (await fileTexts(root)).join("\n");
  for (const token of remote.accessTokens()) expect(files).not.toContain(token);
  expect(files).not.toContain("refresh-");
  expect(files).not.toContain('"code_verifier"');
  expect((await stat(join(root, "auth/grants.json"))).mode & 0o777).toBe(0o600);
  expect(storage.size).toBe(0);
});
it("binds callbacks to state and issuer, consumes them once, and never exchanges rejected responses", async () => {
  const preview = await review();
  const started = await auth.start(captured, "page", preview.previewId!, "temporary");
  const callback = new URL(remote.issue(started.authorizationUrl!));
  const wrongState = new URL(callback);
  wrongState.searchParams.set("state", "unrelated");
  expect((await fetch(wrongState, { redirect: "manual" })).status).toBe(400);
  expect(remote.counts.token).toBe(0);
  const wrongIssuer = new URL(callback);
  wrongIssuer.searchParams.set("iss", `${remote.origin}/other`);
  expect((await fetch(wrongIssuer, { redirect: "manual" })).status).toBe(400);
  expect(remote.counts.token).toBe(0);
  const missingIssuer = new URL(callback);
  missingIssuer.searchParams.delete("iss");
  expect((await fetch(missingIssuer, { redirect: "manual" })).status).toBe(400);
  expect(remote.counts.token).toBe(0);
  expect((await fetch(callback)).status).toBe(200);
  await vi.waitFor(() => expect(remote.counts.token).toBe(1));
  await fetch(callback).catch(() => undefined);
  expect(remote.counts.token).toBe(1);
});
it("uses per-install native dynamic registration only after explicit storage selection and never bundles a client", async () => {
  if (captured.definition.type !== "http") throw new Error();
  captured.definition.auth = { type: "oauth", scopes: [] };
  await signedIn();
  expect(remote.counts.registrations).toBe(1);
  expect(remote.registrations[0]).toMatchObject({
    application_type: "native",
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
  expect(native).not.toHaveBeenCalled();
  await auth.signOut(captured);
  expect(remote.counts.revocations).toBe(1);
  expect(revoke).toHaveBeenCalled();
  expect((await auth.status(captured, "page")).status).toBe("signed-out");
  await expect(auth.prepare(captured, AbortSignal.timeout(5000))).rejects.toMatchObject({
    status: "required",
  });
});
it.each(["locked", "unavailable"] as const)(
  "refuses persistent authorization when storage is %s without registering or falling back",
  async (failure) => {
    if (captured.definition.type !== "http") throw new Error();
    captured.definition.auth = { type: "oauth", scopes: [] };
    state = failure;
    const preview = await review();
    await expect(
      auth.start(captured, "page", preview.previewId!, "persistent"),
    ).rejects.toMatchObject({ status: failure });
    expect(remote.counts.registrations).toBe(0);
    expect(remote.counts.token).toBe(0);
    expect(storage.size).toBe(0);
    expect((await auth.status(captured, "page")).secureStorage).toBe(failure);
  },
);
it("cancellation, page detach and owner replacement reject pending callbacks without token exchange", async () => {
  const preview = await review();
  const started = await auth.start(captured, "page", preview.previewId!, "temporary");
  const callback = remote.issue(started.authorizationUrl!);
  auth.cancel("other-page", started.attemptId!);
  expect((await auth.status(captured, "page")).status).toBe("pending");
  valid = false;
  auth.recheckOwners();
  await vi.waitFor(async () =>
    expect((await auth.status(captured, "page")).status).toBe("cancelled"),
  );
  await fetch(callback).catch(() => undefined);
  expect(remote.counts.token).toBe(0);
  valid = true;
  const next = await review();
  auth.detach("page");
  await expect(auth.start(captured, "page", next.previewId!, "temporary")).rejects.toThrow(
    "detached",
  );
});
it("never accepts token scope escalation or reflects an untrusted token error description", async () => {
  remote.policy.escalated = true;
  const preview = await review(),
    started = await auth.start(captured, "page", preview.previewId!, "temporary");
  await fetch(remote.issue(started.authorizationUrl!));
  await vi.waitFor(async () =>
    expect((await auth.status(captured, "page")).status).toBe("reauthorization-required"),
  );
  await expect(auth.prepare(captured, AbortSignal.timeout(5000))).rejects.toMatchObject({
    status: "required",
  });
  expect(JSON.stringify(await auth.status(captured, "page"))).not.toContain(
    "synthetic-untrusted-description",
  );
  expect(remote.counts.calls).toBe(0);
});
it("refreshes once for concurrent work, binds the resource and does not automatically retry an uncertain exchange", async () => {
  await signedIn();
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 3601_000);
  let release!: () => void;
  remote.policy.holdRefresh = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = Promise.all(
    Array.from({ length: 8 }, () => auth.prepare(captured, AbortSignal.timeout(5000))),
  );
  await vi.waitFor(() => expect(remote.counts.refresh).toBe(1));
  release();
  await pending;
  expect(remote.counts.refresh).toBe(1);
  vi.mocked(Date.now).mockReturnValue(now + 7202_000);
  remote.policy.loseRefresh = true;
  remote.policy.holdRefresh = undefined;
  await expect(auth.prepare(captured, AbortSignal.timeout(5000))).rejects.toThrow("uncertain");
  await expect(auth.prepare(captured, AbortSignal.timeout(5000))).rejects.toMatchObject({
    status: "required",
  });
  expect(remote.counts.refresh).toBe(2);
  expect(remote.counts.calls).toBe(0);
  expect((await auth.status(captured, "page")).status).toBe("reauthorization-required");
});
it("requires authentication after temporary restart and keeps persistent deletion tombstones while locked", async () => {
  await signedIn("persistent");
  const tokens = remote.accessTokens();
  await auth.close();
  auth = new McpAuthentication(
    join(root, "auth"),
    { credentials: native, callback: openOAuthCallback },
    () => {},
    revoke,
  );
  await auth.prepare(captured, AbortSignal.timeout(5000));
  state = "locked";
  expect(await auth.signOut(captured)).toMatchObject({
    status: "deletion-uncertain",
    completed: false,
  });
  await auth.close();
  state = "available";
  auth = new McpAuthentication(
    join(root, "auth"),
    { credentials: native, callback: openOAuthCallback },
    () => {},
    revoke,
  );
  await expect(auth.prepare(captured, AbortSignal.timeout(5000))).rejects.toMatchObject({
    status: "required",
  });
  const files = (await fileTexts(root)).join("\n");
  for (const token of tokens) expect(files).not.toContain(token);
  expect(files).toContain("deletion-uncertain");
});

it("cancels the actual authenticated HTTP request and never retries a rejected business call", async () => {
  await signedIn();
  const prepared = await auth.prepare(captured, AbortSignal.timeout(5000));
  let upstream = await connectMcpUpstream({
    definition: captured.definition,
    cwd: root,
    ...prepared,
    signal: AbortSignal.timeout(5000),
  });
  let release!: () => void;
  try {
    remote.policy.holdCall = new Promise<void>((done) => {
      release = done;
    });
    const controller = new AbortController();
    const call = upstream.call("echo", {}, controller.signal, 5000);
    const rejected = expect(call).rejects.toThrow();
    await vi.waitFor(() => expect(remote.counts.calls).toBe(1));
    controller.abort();
    await rejected;
    await vi.waitFor(() => expect(remote.counts.cancelled).toBeGreaterThan(0));
    release();
    remote.policy.holdCall = undefined;
    await upstream.close();
    expect(remote.counts.calls).toBe(1);
    upstream = await connectMcpUpstream({
      definition: captured.definition,
      cwd: root,
      ...prepared,
      signal: AbortSignal.timeout(5000),
    });
    remote.policy.rejectCall = true;
    await expect(upstream.call("echo", {}, AbortSignal.timeout(5000), 5000)).rejects.toThrow();
    expect(remote.counts.calls).toBe(2);
    expect(remote.counts.token).toBe(1);
    expect(remote.counts.refresh).toBe(0);
  } finally {
    release?.();
    await upstream.close();
  }
});
it("requires fresh authorization after temporary restart, and rejects expired or changed reviews", async () => {
  await signedIn();
  await auth.close();
  auth = new McpAuthentication(
    join(root, "auth"),
    { credentials: native, callback: openOAuthCallback },
    () => {},
    revoke,
  );
  await expect(auth.prepare(captured, AbortSignal.timeout(5000))).rejects.toMatchObject({
    status: "required",
  });
  const preview = await review();
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 300_001);
  await expect(auth.start(captured, "page", preview.previewId!, "temporary")).rejects.toThrow(
    "expired",
  );
  vi.mocked(Date.now).mockRestore();
  const next = await review();
  captured.revision = "c".repeat(64);
  await expect(auth.start(captured, "page", next.previewId!, "temporary")).rejects.toThrow(
    "changed",
  );
  expect(remote.counts.token).toBe(1);
});
it("keeps one refresh flight after a waiter cancels and revokes racing sign-out before publication", async () => {
  await signedIn();
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 3601_000);
  let release!: () => void;
  remote.policy.holdRefresh = new Promise<void>((done) => {
    release = done;
  });
  const controller = new AbortController();
  const first = auth.prepare(captured, controller.signal);
  const rejected = expect(first).rejects.toThrow();
  await vi.waitFor(() => expect(remote.counts.refresh).toBe(1));
  controller.abort();
  await rejected;
  const second = auth.prepare(captured, AbortSignal.timeout(5000));
  const secondRejected = expect(second).rejects.toThrow();
  const signedOut = auth.signOut(captured);
  release();
  await secondRejected;
  await signedOut;
  expect(remote.counts.refresh).toBe(1);
  await expect(auth.prepare(captured, AbortSignal.timeout(5000))).rejects.toMatchObject({
    status: "required",
  });
  expect((await auth.status(captured, "page")).status).toBe("signed-out");
});
it("forgets only the selected manual reference while revoking all owned instances", async () => {
  captured.definition = {
    type: "stdio",
    label: "Two references",
    enabled: true,
    command: "never-run",
    args: [],
    env: { A: { credentialRef: "a" }, B: { credentialRef: "b" } },
  };
  const preview = await auth.preview(captured, "page");
  await auth.write(
    captured,
    "page",
    preview.previewId!,
    "a",
    "synthetic-a",
    "temporary",
    randomUUID(),
  );
  await auth.write(
    captured,
    "page",
    preview.previewId!,
    "b",
    "synthetic-b",
    "temporary",
    randomUUID(),
  );
  expect((await auth.prepare(captured, AbortSignal.timeout(5000))).environment).toEqual({
    A: "synthetic-a",
    B: "synthetic-b",
  });
  await auth.forget(captured, "page", preview.previewId!, "a");
  expect(revoke).toHaveBeenCalledWith(captured.targetId, captured.serverId);
  const status = await auth.status(captured, "page");
  expect(status.references).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ reference: "a", state: "removed" }),
      expect.objectContaining({ reference: "b", state: "active" }),
    ]),
  );
  await expect(auth.prepare(captured, AbortSignal.timeout(5000))).rejects.toMatchObject({
    status: "required",
  });
});

it.each(["new", "load", "resume"] as const)(
  "resolves OAuth only in the Gateway for actual ACP %s; detach preserves work and sign-out revokes capabilities",
  async (method) => {
    await signedIn();
    const broker = await createMcpBroker(
      fileURLToPath(new URL("../src/agents/mcp-adapter.ts", import.meta.url)),
    );
    const runtime = new McpRuntime(
      join(root, "runtime"),
      { connect: connectMcpUpstream, expose: broker.expose },
      () => {},
      { PATH: process.env.PATH ?? "", HOME: root },
      auth,
    );
    revoke.mockImplementation(async (targetId: string, serverId: string) => {
      await runtime.revokeCredentials(targetId, serverId);
    });
    const proxy = (await import("node:http")).createServer((_request, response) => {
      proxyCalls++;
      response.writeHead(502).end();
    });
    let proxyCalls = 0;
    await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
    const address = proxy.address();
    if (!address || typeof address === "string") throw new Error();
    const resources = await runtime.factory(
      async () => ({
        role: "relay",
        user: {
          targetId: captured.targetId,
          revision: captured.revision,
          document: { version: 1, servers: { [captured.serverId]: captured.definition } },
        },
      }),
      () => {},
    )({
      runId: randomUUID(),
      provider: "fixture",
      cwd: root,
      controls: { idle: () => true, canRestore: () => true, reconnect: async () => {} },
    });
    let provider: Awaited<ReturnType<ReturnType<typeof createAgents>["start"]>> | undefined;
    try {
      expect(resources.servers).toHaveLength(1);
      const agents = createAgents({ clientVersion: "test" });
      const spec: Parameters<typeof agents.start>[0] = {
        name: "fixture",
        command: [
          process.execPath,
          fileURLToPath(new URL("./fixtures/mcp-connector-provider.mjs", import.meta.url)),
        ],
        cwd: root,
        env: {
          CONNECTOR_EVIDENCE: join(root, "acp-setup.json"),
          CONNECTOR_SESSION: randomUUID(),
          CONNECTOR_RESTORE: method,
          HTTP_PROXY: `http://127.0.0.1:${address.port}`,
          HTTPS_PROXY: `http://127.0.0.1:${address.port}`,
          NODE_USE_ENV_PROXY: "1",
          NO_PROXY: "",
        },
        mcpServers: resources.servers,
      };
      provider =
        method === "new" ? await agents.start(spec) : await agents.restore!(spec, "saved-session");
      const setup = await readFile(join(root, "acp-setup.json"), "utf8");
      expect(JSON.parse(setup).method).toBe(method);
      expect(setup).not.toContain(remote.origin);
      for (const token of remote.accessTokens()) expect(setup).not.toContain(token);
      expect(setup).not.toContain("refresh-");
      expect(setup).not.toContain("code_verifier");
      provider.onPermission(async () => "allow");
      resources.beginTurn(Date.now() + 5000);
      await provider.prompt('{"name":"echo"}');
      expect(remote.counts.calls).toBe(1);
      auth.detach("page");
      await provider.prompt('{"name":"echo"}');
      expect(remote.counts.calls).toBe(2);
      await auth.signOut(captured);
      await provider.prompt('{"name":"echo"}');
      expect(remote.counts.calls).toBe(2);
      expect(proxyCalls).toBe(0);
    } finally {
      revoke.mockImplementation(async () => {});
      await provider?.stop(100);
      await resources.close();
      await runtime.close();
      await broker.close();
      proxy.closeAllConnections();
      await new Promise<void>((done) => proxy.close(() => done()));
    }
  },
);

it("shares one persistent grant and refresh when eight cold secure reads complete together after restart", async () => {
  await signedIn("persistent");
  await auth.close();
  const original = native;
  let reads = 0,
    releaseReads!: () => void,
    releaseRefresh!: () => void;
  const reading = new Promise<void>((done) => {
    releaseReads = done;
  });
  remote.policy.holdRefresh = new Promise<void>((done) => {
    releaseRefresh = done;
  });
  native = vi.fn<CredentialStorePort>(async (request, signal) => {
    if (request.action === "get") {
      reads++;
      await reading;
    }
    return original(request, signal);
  });
  auth = new McpAuthentication(
    join(root, "auth"),
    { credentials: native, callback: openOAuthCallback },
    () => {},
    revoke,
  );
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 3601_000);
  const calls = Promise.all(
    Array.from({ length: 8 }, () => auth.prepare(captured, AbortSignal.timeout(5000))),
  );
  try {
    await vi.waitFor(() => expect(reads).toBe(8));
    releaseReads();
    await vi.waitFor(() => expect(remote.counts.refresh).toBe(1));
    releaseRefresh();
    await calls;
    expect(remote.counts.refresh).toBe(1);
  } finally {
    releaseReads();
    releaseRefresh();
    await calls.catch(() => {});
  }
});
