import { once } from "node:events";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readPrivateJson } from "../platform/index.js";
import { DEFAULT_CONTAINER_PORT, parseContainerConfig, runContainerCommand } from "./container.js";
import { pairingControl } from "./pairing.js";
import { managementRequest, startGateway } from "./server.js";

const owned: { directory: string; gateway?: Awaited<ReturnType<typeof startGateway>> }[] = [];

afterEach(async () => {
  for (const item of owned.splice(0)) {
    if (item.gateway) await item.gateway.stop();
    await rm(item.directory, { recursive: true, force: true });
  }
});

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("Missing ephemeral port");
  await new Promise<void>((done) => probe.close(() => done()));
  return address.port;
}

async function containerFixture(container: {
  port: number;
  bindHost: "0.0.0.0" | "127.0.0.1";
  origin: string;
}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-container-gw-")));
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
  const gateway = await startGateway({
    env,
    assets,
    roots: [directory],
    container,
  });
  owned.push({ directory, gateway });
  return { directory, gateway, env };
}

async function rawRequest(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
      );
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe("parseContainerConfig", () => {
  it("uses port 6060, bind 0.0.0.0, and matching loopback origin by default", () => {
    expect(parseContainerConfig({})).toEqual({
      container: {
        port: DEFAULT_CONTAINER_PORT,
        bindHost: "0.0.0.0",
        origin: "http://127.0.0.1:6060",
      },
    });
  });

  it("parses custom port, bind, origin, and workspace roots", () => {
    expect(
      parseContainerConfig({
        CODE60_PORT: "7060",
        CODE60_BIND: "127.0.0.1",
        CODE60_ORIGIN: "https://code60.example.test:8443",
        CODE60_WORKSPACE_ROOTS: "/workspaces:/extra",
      }),
    ).toEqual({
      container: {
        port: 7060,
        bindHost: "127.0.0.1",
        origin: "https://code60.example.test:8443",
      },
      roots: ["/workspaces", "/extra"],
    });
  });

  it("rejects invalid ports, binds, origins, and workspace roots", () => {
    for (const bad of ["0", "65536", "-1", "abc", "06060"])
      expect(() => parseContainerConfig({ CODE60_PORT: bad })).toThrow("CODE60_PORT");
    for (const bad of ["::", "192.168.1.2", "localhost"])
      expect(() => parseContainerConfig({ CODE60_BIND: bad })).toThrow("CODE60_BIND");
    for (const bad of [
      "not-a-url",
      "ftp://127.0.0.1:6060",
      "http://127.0.0.1:6060/path",
      "http://127.0.0.1:6060?a=1",
      "http://127.0.0.1:6060#frag",
      "http://user:pass@127.0.0.1:6060",
      "http://127.0.0.1:6060/",
    ])
      expect(() => parseContainerConfig({ CODE60_ORIGIN: bad })).toThrow("CODE60_ORIGIN");
    for (const bad of ["relative/path", "/ok::/empty", "/bad\0root"])
      expect(() => parseContainerConfig({ CODE60_WORKSPACE_ROOTS: bad })).toThrow(
        "CODE60_WORKSPACE_ROOTS",
      );
  });
});

describe("container gateway server mode", () => {
  it("validates container options strictly and refuses mixing with development mode", async () => {
    await expect(
      startGateway({
        developmentAssets: "http://127.0.0.1:43161",
        container: { port: 6060, bindHost: "0.0.0.0", origin: "http://127.0.0.1:6060" },
      }),
    ).rejects.toThrow("cannot be combined");
    await expect(
      startGateway({
        container: { port: 0, bindHost: "0.0.0.0", origin: "http://127.0.0.1:6060" },
      }),
    ).rejects.toThrow("between 1 and 65535");
    await expect(
      startGateway({
        container: {
          port: 6060,
          bindHost: "192.168.1.5" as "0.0.0.0",
          origin: "http://127.0.0.1:6060",
        },
      }),
    ).rejects.toThrow("0.0.0.0 or 127.0.0.1");
    await expect(
      startGateway({
        container: { port: 6060, bindHost: "0.0.0.0", origin: "http://127.0.0.1:6060/bad" },
      }),
    ).rejects.toThrow("normalized http:// or https:// origin");
    await expect(
      startGateway({
        container: { port: 6060, bindHost: "0.0.0.0", origin: "invalid-origin" },
      }),
    ).rejects.toThrow("valid http:// or https:// origin");
  });

  it("enforces custom Host/Origin while keeping loopback management functional", async () => {
    const port = await freePort();
    const mappedPort = port === 65535 ? port - 1 : port + 1;
    const browserOrigin = `http://127.0.0.1:${mappedPort}`;
    const { directory, gateway, env } = await containerFixture({
      port,
      bindHost: "0.0.0.0",
      origin: browserOrigin,
    });

    expect(gateway.origin).toBe(browserOrigin);
    expect(gateway.requirePairing).toBe(false);

    // connection.json keeps the container's loopback management address
    const connection = (await readPrivateJson(
      join(directory, "state/code60/gateway/connection.json"),
      4096,
    )) as { origin: string; token: string };
    expect(connection.origin).toBe(`http://127.0.0.1:${port}`);

    // Requests with the exact configured browser Host/Origin succeed
    const ok = await rawRequest(port, "GET", "/api/connection", {
      Host: `127.0.0.1:${mappedPort}`,
    });
    expect(ok.status).toBe(200);

    // Requests using the unmapped internal port or hostile Origin fail with 403
    const wrongHost = await rawRequest(port, "GET", "/api/connection", {
      Host: `127.0.0.1:${port}`,
    });
    expect(wrongHost.status).toBe(403);

    const wrongOrigin = await rawRequest(
      port,
      "POST",
      "/api/connect",
      {
        Host: `127.0.0.1:${mappedPort}`,
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      JSON.stringify({ version: 1 }),
    );
    expect(wrongOrigin.status).toBe(403);

    // Path-traversal attempt using management header against non-management path is rejected
    const traversal = await rawRequest(port, "GET", "/management/../api/connection", {
      Host: `127.0.0.1:${port}`,
      "X-Code60-Management": connection.token,
    });
    expect(traversal.status).toBe(403);

    // Loopback management works and returns the configured browser origin
    const pairInfo = await managementRequest(env, "pair");
    expect(pairInfo.origin).toBe(browserOrigin);
    expect(pairInfo.requirePairing).toBe(false);

    await pairingControl(env, true);
    expect(gateway.requirePairing).toBe(true);
    const pairAfter = await managementRequest(env, "pair");
    expect(pairAfter.requirePairing).toBe(true);
    expect(typeof pairAfter.code).toBe("string");
  });

  it("forces pairing on and refuses disabling it for non-loopback container origins", async () => {
    const port = await freePort();
    const { gateway, env } = await containerFixture({
      port,
      bindHost: "0.0.0.0",
      origin: "https://code60.example.test",
    });

    expect(gateway.requirePairing).toBe(true);
    await expect(pairingControl(env, false)).rejects.toThrow();
    expect(gateway.requirePairing).toBe(true);
  });
});

describe("runContainerCommand", () => {
  it("prints help and rejects invalid subcommands or wrong Node major", async () => {
    const out: string[] = [];
    const err: string[] = [];
    expect(
      await runContainerCommand(["--help"], {
        stdout: { write: (s) => out.push(s) },
        stderr: { write: (s) => err.push(s) },
      }),
    ).toBe(0);
    expect(out.join("")).toContain("CODE60_PORT");

    expect(
      await runContainerCommand(["serve", "extra"], {
        stderr: { write: (s) => err.push(s) },
      }),
    ).toBe(1);
    expect(
      await runContainerCommand(["unknown"], {
        stderr: { write: (s) => err.push(s) },
      }),
    ).toBe(1);
    expect(
      await runContainerCommand(["serve"], {
        nodeMajor: 22,
        stderr: { write: (s) => err.push(s) },
      }),
    ).toBe(1);
    expect(err.join("")).toContain("Node 24");
  });

  it("handles health and pair subcommands cleanly", async () => {
    const out: string[] = [];
    const err: string[] = [];
    expect(
      await runContainerCommand(["health"], {
        request: vi.fn().mockResolvedValue({ pid: 42, version: 1 }),
        stderr: { write: (s) => err.push(s) },
      }),
    ).toBe(0);
    expect(
      await runContainerCommand(["health"], {
        request: vi.fn().mockResolvedValue({ bad: true }),
        stderr: { write: (s) => err.push(s) },
      }),
    ).toBe(1);
    expect(
      await runContainerCommand(["health"], {
        request: vi.fn().mockRejectedValue(new Error("down")),
        stderr: { write: (s) => err.push(s) },
      }),
    ).toBe(1);

    expect(
      await runContainerCommand(["pair"], {
        request: vi.fn().mockResolvedValue({
          origin: "http://127.0.0.1:6060",
          requirePairing: true,
          code: "123456",
        }),
        stdout: { write: (s) => out.push(s) },
      }),
    ).toBe(0);
    expect(out.join("")).toContain("Open http://127.0.0.1:6060");
    expect(out.join("")).toContain("123456");

    out.length = 0;
    expect(
      await runContainerCommand(["pair"], {
        request: vi.fn().mockResolvedValue({
          origin: "http://127.0.0.1:6060",
          requirePairing: false,
        }),
        stdout: { write: (s) => out.push(s) },
      }),
    ).toBe(0);
    expect(out.join("")).toContain("Pairing is off");

    expect(
      await runContainerCommand(["pair"], {
        request: vi.fn().mockResolvedValue({}),
        stderr: { write: (s) => err.push(s) },
      }),
    ).toBe(1);
    expect(
      await runContainerCommand(["pair"], {
        request: vi.fn().mockRejectedValue(new Error("offline")),
        stderr: { write: (s) => err.push(s) },
      }),
    ).toBe(1);
  });

  it("starts gateway in serve mode, prints pairing code when required, and stops cleanly on SIGTERM", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const handlers = new Map<string, () => void>();
    const stop = vi.fn().mockResolvedValue(undefined);
    const start = vi.fn().mockResolvedValue({
      origin: "http://127.0.0.1:6060",
      requirePairing: true,
      proof: () => "654321",
      stop,
    });

    const running = runContainerCommand(["serve"], {
      env: { CODE60_PORT: "6060", CODE60_WORKSPACE_ROOTS: "/workspaces" },
      stdout: { write: (s) => out.push(s) },
      stderr: { write: (s) => err.push(s) },
      onSignal: (signal, listener) => {
        handlers.set(signal, listener);
      },
      start: start as unknown as typeof startGateway,
    });

    await vi.waitFor(() => expect(handlers.has("SIGTERM")).toBe(true));
    expect(start).toHaveBeenCalledWith({
      env: { CODE60_PORT: "6060", CODE60_WORKSPACE_ROOTS: "/workspaces" },
      container: { port: 6060, bindHost: "0.0.0.0", origin: "http://127.0.0.1:6060" },
      roots: ["/workspaces"],
    });
    expect(out.join("")).toContain("Open http://127.0.0.1:6060");
    expect(out.join("")).toContain("654321");

    handlers.get("SIGTERM")?.();
    handlers.get("SIGINT")?.();
    expect(await running).toBe(0);
    expect(stop).toHaveBeenCalledOnce();
  });

  it("returns 1 on config error, startup failure, or shutdown cleanup failure", async () => {
    const err: string[] = [];
    expect(
      await runContainerCommand(["serve"], {
        env: { CODE60_PORT: "bad" },
        stderr: { write: (s) => err.push(s) },
      }),
    ).toBe(1);
    expect(
      await runContainerCommand(["serve"], {
        env: {},
        stderr: { write: (s) => err.push(s) },
        start: vi.fn().mockRejectedValue(new Error("EADDRINUSE")) as unknown as typeof startGateway,
      }),
    ).toBe(1);

    const handlers = new Map<string, () => void>();
    const running = runContainerCommand(["serve"], {
      env: {},
      stdout: { write: () => {} },
      stderr: { write: (s) => err.push(s) },
      onSignal: (signal, listener) => {
        handlers.set(signal, listener);
      },
      start: vi.fn().mockResolvedValue({
        origin: "http://127.0.0.1:6060",
        requirePairing: false,
        proof: () => "",
        stop: vi.fn().mockRejectedValue(new Error("cleanup failed")),
      }) as unknown as typeof startGateway,
    });
    await vi.waitFor(() => expect(handlers.has("SIGINT")).toBe(true));
    handlers.get("SIGINT")?.();
    expect(await running).toBe(1);
    expect(err.join("")).toContain("Backend cleanup could not finish");
  });
});
