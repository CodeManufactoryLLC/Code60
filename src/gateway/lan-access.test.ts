import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { startGateway } from "./server.js";

const owned: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of owned.splice(0).reverse()) await close();
});
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-lan-access-")));
  const assets = join(directory, "assets");
  await mkdir(assets);
  await writeFile(join(assets, "index.html"), "<!doctype html><title>Bundled LAN</title>");
  await writeFile(join(assets, "private.map"), "not served");
  const env = {
    ...process.env,
    HOME: directory,
    CODE60_DEV_CONTAINER: "0",
    XDG_STATE_HOME: join(directory, "state"),
    XDG_CONFIG_HOME: join(directory, "config"),
    SHELL: "/bin/sh",
  };
  let target = 0;
  const options = {
    env,
    assets,
    roots: [directory],
    lanPublisher: {
      address: async () => "192.168.50.20",
      publish: async (port: number) => {
        target = port;
        return "192.168.50.20";
      },
      withdraw: async () => {},
      onLost: () => () => {},
      close: async () => {},
    },
  };
  let gateway = await startGateway(options);
  owned.push(async () => {
    await gateway.stop();
    await rm(directory, { recursive: true, force: true });
  });
  const post = async (
    origin: string,
    path: string,
    value: unknown,
    auth: Record<string, string> = {},
    extra: Record<string, string> = {},
  ) =>
    raw(origin, path, {
      method: "POST",
      body: JSON.stringify(value),
      headers: { "Content-Type": "application/json", Origin: origin, ...auth, ...extra },
    });
  const local = (await post(gateway.origin, "/api/connect", { version: 1 })).value;
  const auth = {
    "X-Code60-Session": String(local.token),
    "X-Code60-Generation": String(local.generation),
    "X-Code60-Client": crypto.randomUUID(),
  };
  const stream = (origin: string, headers: Record<string, string>) =>
    new Promise<void>((resolve, reject) => {
      const request = httpRequest(
        `http://127.0.0.1:${origin === gateway.origin ? new URL(origin).port : target}/api/events`,
        { headers: { Host: new URL(origin).host, ...headers } },
        (response) => {
          response.resume();
          owned.push(async () => {
            response.destroy();
            request.destroy();
          });
          resolve();
        },
      );
      request.once("error", reject);
      request.end();
    });
  await stream(gateway.origin, auth);
  const operation = (name: string, value?: unknown) =>
    post(
      gateway.origin,
      "/api/operation",
      { id: crypto.randomUUID(), operation: name, ...(value === undefined ? {} : { value }) },
      auth,
    );
  async function raw(
    origin: string,
    path: string,
    options: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ) {
    return new Promise<{ status: number; value: Record<string, unknown> }>((resolve, reject) => {
      const request = httpRequest(
        `http://127.0.0.1:${origin === gateway.origin ? new URL(origin).port : target}${path}`,
        {
          method: options.method ?? "GET",
          headers: { Host: new URL(origin).host, ...options.headers },
        },
        (response) => {
          let body = "";
          response.on("data", (bytes) => {
            body += bytes;
          });
          response.on("end", () => {
            let value: Record<string, unknown>;
            try {
              value = JSON.parse(body);
            } catch {
              value = { html: body };
            }
            resolve({ status: response.statusCode ?? 0, value });
          });
        },
      );
      request.on("error", reject);
      request.end(options.body);
    });
  }
  return {
    operation,
    raw,
    post,
    stream,
    auth,
    directory,
    env,
    get gateway() {
      return gateway;
    },
    async restart() {
      await gateway.stop();
      gateway = await startGateway(options);
    },
  };
}
it("requires LAN-scoped pairing and denies local tokens, management and remote administration", async () => {
  const f = await fixture();
  expect((await f.operation("web-server-status")).value).toMatchObject({
    enabled: false,
    state: "disabled",
    canManage: true,
  });
  expect((await f.operation("web-server-enabled", { enabled: true, port: 80 })).status).toBe(400);
  const enabled = await f.operation("web-server-enabled", { enabled: true });
  expect(enabled.status).toBe(200);
  const origin = enabled.value.url as string;
  expect((await f.raw(origin, "/api/connection")).value.requirePairing).toBe(true);
  expect((await f.post(origin, "/api/connect", { version: 1 })).status).toBe(403);
  expect((await f.raw(origin, "/api/session", { headers: f.auth })).status).toBe(400);
  const management = JSON.parse(
    await readFile(join(f.directory, "state/code60/gateway/connection.json"), "utf8"),
  );
  expect(
    (
      await f.raw(origin, "/management/status", {
        method: "POST",
        headers: { "X-Code60-Management": management.token },
      })
    ).status,
  ).toBe(403);
  expect((await f.raw(origin, "/private.map")).status).toBe(404);
  expect((await f.raw(origin, "/?import")).status).toBe(400);
  expect(
    (
      await f.raw(origin, "/", {
        headers: {
          "Sec-Fetch-Site": "cross-site",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Dest": "document",
        },
      })
    ).status,
  ).toBe(200);
  const firstCode = (await f.operation("web-server-code")).value.code;
  const code = (await f.operation("web-server-code")).value.code;
  expect((await f.post(origin, "/api/pair", { version: 1, code: firstCode })).status).toBe(400);
  expect((await f.post(f.gateway.origin, "/api/pair", { version: 1, code })).status).toBe(400);
  const paired = await f.post(origin, "/api/pair", { version: 1, code });
  expect(paired.status).toBe(200);
  expect((await f.post(origin, "/api/pair", { version: 1, code })).status).toBe(400);
  const remote = {
    "X-Code60-Session": String(paired.value.token),
    "X-Code60-Generation": String(paired.value.generation),
    "X-Code60-Client": crypto.randomUUID(),
  };
  expect((await f.raw(f.gateway.origin, "/api/session", { headers: remote })).status).toBe(400);
  const takeover = await f.post(origin, "/api/control", {}, remote);
  remote["X-Code60-Generation"] = String(takeover.value.generation);
  await f.stream(origin, remote);
  for (const operation of ["web-server-enabled", "web-server-code"])
    expect(
      (
        await f.post(
          origin,
          "/api/operation",
          { id: crypto.randomUUID(), operation, value: { enabled: false } },
          remote,
        )
      ).value.error,
    ).toContain("localhost");
  expect(
    (
      await f.post(
        origin,
        "/api/operation",
        { id: crypto.randomUUID(), operation: "web-server-status" },
        remote,
      )
    ).value.canManage,
  ).toBe(false);
});
it("persists only the preference, throttles pairing and restores listeners without retaining codes", async () => {
  const f = await fixture();
  const origin = String((await f.operation("web-server-enabled", { enabled: true })).value.url);
  const code = (await f.operation("web-server-code")).value.code;
  for (let index = 0; index < 10; index++)
    expect(
      (await f.post(origin, "/api/pair", { version: 1, code: "0000000000000000" })).status,
    ).toBe(400);
  expect((await f.post(origin, "/api/pair", { version: 1, code })).status).toBe(429);
  const text = await readFile(join(f.directory, "state/code60/gateway/settings.json"), "utf8");
  expect(JSON.parse(text)).toEqual({ webServerEnabled: true });
  expect(text).not.toContain(code);
  await f.restart();
  const restoredOrigin = `http://192.168.50.20:${new URL(f.gateway.origin).port}`;
  expect((await f.raw(restoredOrigin, "/api/connection")).value.requirePairing).toBe(true);
  expect(
    (
      await f.raw(restoredOrigin, "/api/pair", {
        method: "POST",
        headers: { Origin: restoredOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, code }),
      })
    ).status,
  ).not.toBe(200);
  expect((await fetch(f.gateway.origin)).status).toBe(200);
});
