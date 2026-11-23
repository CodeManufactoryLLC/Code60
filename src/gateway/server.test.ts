import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { startGateway } from "./server.js";

const owned: { directory: string; gateway: Awaited<ReturnType<typeof startGateway>> }[] = [];
afterEach(async () => {
  for (const fixture of owned.splice(0)) {
    await fixture.gateway.stop();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
async function fixture(developmentAssets?: string) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-gateway-")));
  const assets = join(directory, "assets");
  await mkdir(assets);
  await writeFile(join(assets, "index.html"), "<!doctype html><title>Code60</title>");
  const env = {
    ...process.env,
    HOME: directory,
    SHELL: "/bin/sh",
    XDG_STATE_HOME: join(directory, "state"),
    XDG_CONFIG_HOME: join(directory, "config"),
  };
  const gateway = await startGateway({
    env,
    assets,
    roots: [directory],
    ...(developmentAssets ? { developmentAssets } : {}),
  });
  owned.push({ directory, gateway });
  return { directory, gateway, env };
}
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

it("proxies Vite asset query strings only in development and rejects API query strings", async () => {
  const upstream = createServer((request, response) => response.end(request.url));
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  try {
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("Missing test server");
    const { gateway } = await fixture(`http://127.0.0.1:${address.port}`);
    const asset = await fetch(`${gateway.origin}/main.tsx?v=fixture`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("/main.tsx?v=fixture");
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
