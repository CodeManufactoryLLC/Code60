import { mkdir, mkdtemp, readFile, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { lockInstallation, type PayloadDescriptor } from "../platform/index.js";
import { installManagedRelease } from "./installation.js";
import { createUpdatePorts, runUpdate, type UpdatePorts, updateFlags } from "./update.js";

const roots: string[] = [];
it("constructs inert bounded production ports without checking the registry or native service", () => {
  const ports = createUpdatePorts({ HOME: "/unused", PATH: "/unused" });
  expect(ports.deadlineMs).toBe(30000);
  expect(typeof ports.bootstrap).toBe("function");
  expect(typeof ports.activatedStatus).toBe("function");
});
afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), "code60 update spaces ' ")));
  roots.push(home);
  const env = { HOME: home, PATH: "/usr/bin:/bin", SHELL: "/bin/bash" };
  const root = join(home, ".local/share/code60");
  async function acquire(parent: string) {
    const owned = await mkdtemp(join(parent, ".candidate-"));
    const application = join(owned, "application");
    await mkdir(join(application, "dist/management"), { recursive: true, mode: 0o700 });
    await writeFile(join(application, "payload.json"), "{}");
    await writeFile(join(application, "package.json"), '{"type":"module"}');
    await writeFile(
      join(application, "dist/management/cli.js"),
      "export async function runManagement(){}",
    );
    return { root: application, owned };
  }
  const runtimeDirectory = resolve("build/distribution");
  await installManagedRelease({
    env,
    runtimeDirectory,
    artifact: {
      identity: {
        version: "1.0.0",
        os: process.platform,
        arch: process.arch,
        archive: { sha256: "a".repeat(64) },
      },
      acquire: ({ parent }) => acquire(parent),
    },
  });
  const previous = await readlink(join(root, "current"));
  const journal = async () => JSON.parse(await readFile(join(root, "update.json"), "utf8"));
  const candidate = {
    schemaVersion: 1,
    version: "1.1.0",
    commit: "b".repeat(40),
    dirty: false,
    os: process.platform,
    arch: process.arch,
    runtime: { node: ">=24.22.0 <25", libc: process.platform === "linux" ? "glibc" : null },
    archive: {
      name: "fixture.tar.gz",
      url: "https://example.invalid/not-used",
      size: 100,
      sha256: "b".repeat(64),
    },
  } as PayloadDescriptor;
  let stopped = false;
  const calls: string[] = [],
    output: string[] = [];
  const ports: UpdatePorts = {
    interactive: false,
    confirm: vi.fn(async () => true),
    write: (value) => {
      output.push(value);
    },
    runtimeDirectory,
    bootstrap: vi.fn(async () => {
      calls.push("bootstrap");
      return {
        version: candidate.version,
        integrity: "fixture",
        sha256: "c".repeat(64),
        descriptor: candidate,
      };
    }),
    acquire: vi.fn(async (_, parent) => {
      calls.push("acquire");
      expect(stopped).toBe(false);
      expect(await readlink(join(root, "current"))).toBe(previous);
      return acquire(parent);
    }),
    service: vi.fn(async (action) => {
      calls.push(action);
      if (action === "stop") {
        expect((await journal()).phase).toBe("stopping");
        stopped = true;
      }
      return {
        installed: true,
        runtimeCurrent: true,
        nativeState: stopped ? "stopped" : "running",
        service: stopped ? null : { pid: 123 },
      };
    }),
    summary: vi.fn(async () => ({
      pid: 123,
      interactiveActive: true,
      scheduledActive: true,
      schedulerAvailable: true,
    })),
    alive: () => !stopped,
    repair: vi.fn(async () => {
      calls.push("repair");
    }),
    activatedStatus: vi.fn(async () => {
      calls.push("ready");
      const current = await readlink(join(root, "current"));
      const receipt = JSON.parse(await readFile(join(root, current, "receipt.json"), "utf8"));
      return {
        installed: true,
        runtimeCurrent: true,
        nativeState: "running",
        service: { pid: 456, appVersion: receipt.release.version },
      };
    }),
    deadlineMs: 120,
  };
  return { home, env, root, ports, previous, candidate, calls, output, journal };
}

it("strictly parses update, status and explicit recovery before side effects", () => {
  expect(updateFlags([])).toEqual({ action: "update", yes: false });
  expect(updateFlags(["--yes"])).toEqual({ action: "update", yes: true });
  expect(updateFlags(["recover", "--yes"])).toEqual({ action: "recover", yes: true });
  expect(updateFlags(["status"])).toEqual({ action: "status", yes: false });
  for (const args of [
    ["--yes", "--yes"],
    ["--url", "https://example.com"],
    ["status", "--yes"],
    ["recover", "extra"],
    ["--yes", "recover"],
    ["latest"],
    ["--no-open"],
  ])
    expect(() => updateFlags(args)).toThrow("Use code60 update");
});
it("verifies and prepares before consent, stops before publication and waits for the new authenticated version", async () => {
  const f = await fixture();
  const custom = join(f.root, "custom-database.sqlite");
  await writeFile(custom, "independently retained user state");
  await runUpdate(["--yes"], f.env, f.ports);
  expect(f.calls.indexOf("acquire")).toBeLessThan(f.calls.indexOf("stop"));
  expect(f.calls.indexOf("stop")).toBeLessThan(f.calls.indexOf("repair"));
  expect(f.calls.at(-1)).toBe("ready");
  expect(await readlink(join(f.root, "current"))).not.toBe(f.previous);
  expect((await f.journal()).phase).toBe("ready");
  expect((await f.journal()).outcome).toBe("complete");
  expect(await readFile(custom, "utf8")).toBe("independently retained user state");
  expect(await readFile(join(f.root, f.previous, "receipt.json"), "utf8")).toContain(
    '"version":"1.0.0"',
  );
  expect(f.output.join("")).toContain("Interactive work: active. Scheduled work: active.");
  expect(f.ports.confirm).not.toHaveBeenCalled();
});
it.each(["non-tty", "interactive-decline"])(
  "preserves the live backend and activation on denied consent (%s)",
  async (mode) => {
    const f = await fixture();
    f.ports.interactive = mode !== "non-tty";
    f.ports.confirm = vi.fn(async () => false);
    await runUpdate([], f.env, f.ports);
    expect(f.calls).not.toContain("stop");
    expect(f.calls).not.toContain("repair");
    expect(await readlink(join(f.root, "current"))).toBe(f.previous);
    expect((await f.journal()).phase).toBe("aborted");
    expect(f.output.join("")).toContain("Update declined");
  },
);
it.each(["same", "older", "same-version-conflict"])(
  "handles stable no-op/conflicting versions without acquisition or shutdown (%s)",
  async (mode) => {
    const f = await fixture();
    f.candidate.version = mode === "older" ? "0.9.0" : "1.0.0";
    f.candidate.archive.sha256 = mode === "same-version-conflict" ? "b".repeat(64) : "a".repeat(64);
    const result = runUpdate(["--yes"], f.env, f.ports);
    if (mode === "same-version-conflict") await expect(result).rejects.toThrow("conflicts");
    else await result;
    expect(f.ports.acquire).not.toHaveBeenCalled();
    expect(f.calls).not.toContain("stop");
    expect(await readlink(join(f.root, "current"))).toBe(f.previous);
  },
);
it.each(["registry", "payload"])(
  "preserves the live backend on acquisition failure (%s)",
  async (mode) => {
    const f = await fixture();
    if (mode === "registry")
      f.ports.bootstrap = vi.fn(async () => {
        throw Error("registry network/integrity failure");
      });
    else
      f.ports.acquire = vi.fn(async () => {
        throw Error("payload hash failure");
      });
    await expect(runUpdate(["--yes"], f.env, f.ports)).rejects.toThrow("failure");
    expect(f.calls).not.toContain("stop");
    expect(await readlink(join(f.root, "current"))).toBe(f.previous);
    expect((await f.journal()).outcome).toBe("complete");
  },
);
it.each(["shutdown", "leaked-pid", "registration", "readiness", "published-interrupt"])(
  "retains explicit recovery evidence without rollback after service interruption (%s)",
  async (mode) => {
    const f = await fixture();
    if (mode === "shutdown") {
      const service = f.ports.service;
      f.ports.service = async (action, consent) => {
        if (action === "stop") throw Error("shutdown failed");
        return service(action, consent);
      };
    }
    if (mode === "leaked-pid") f.ports.alive = () => true;
    if (mode === "registration")
      f.ports.repair = async () => {
        throw Error("registration failed");
      };
    if (mode === "readiness")
      f.ports.activatedStatus = async () => ({
        installed: true,
        nativeState: "stopped",
        runtimeCurrent: true,
        service: null,
      });
    if (mode === "published-interrupt")
      f.ports.checkpoint = async (record) => {
        if (record.phase === "activated" && record.outcome === "running")
          throw Error("interrupted publication checkpoint");
      };
    await expect(runUpdate(["--yes"], f.env, f.ports)).rejects.toThrow("recover");
    const published = !["shutdown", "leaked-pid"].includes(mode);
    expect((await readlink(join(f.root, "current"))) !== f.previous).toBe(published);
    expect((await f.journal()).outcome).toBe("failed");
    expect(await readFile(join(f.root, f.previous, "receipt.json"), "utf8")).toContain(
      '"version":"1.0.0"',
    );
    const before = f.calls.length;
    await expect(runUpdate(["--yes"], f.env, f.ports)).rejects.toThrow("unfinished update");
    expect(f.calls.length).toBe(before);
  },
);
it("recovers the published current generation explicitly without acquisition or database work", async () => {
  const f = await fixture();
  const repair = f.ports.repair;
  f.ports.repair = async () => {
    throw Error("registration failed");
  };
  await expect(runUpdate(["--yes"], f.env, f.ports)).rejects.toThrow();
  const target = await readlink(join(f.root, "current"));
  f.ports.repair = repair;
  vi.mocked(f.ports.acquire).mockClear();
  vi.mocked(f.ports.bootstrap).mockClear();
  await runUpdate(["recover", "--yes"], f.env, f.ports);
  expect(await readlink(join(f.root, "current"))).toBe(target);
  expect((await f.journal()).phase).toBe("ready");
  expect(f.ports.acquire).not.toHaveBeenCalled();
  expect(f.ports.bootstrap).not.toHaveBeenCalled();
  expect(f.output.join("")).toContain("1.1.0 recovered");
});
it("recovers the original generation after failed shutdown without activating the removed candidate", async () => {
  const f = await fixture();
  const service = f.ports.service;
  f.ports.service = async (action, consent) => {
    if (action === "stop") throw Error("stop failed");
    return service(action, consent);
  };
  await expect(runUpdate(["--yes"], f.env, f.ports)).rejects.toThrow();
  await runUpdate(["recover", "--yes"], f.env, f.ports);
  expect(await readlink(join(f.root, "current"))).toBe(f.previous);
  expect((await f.journal()).phase).toBe("aborted");
  expect(f.output.join("")).toContain("1.0.0 recovered");
});
it("status reads progress and installed identity without locks, registry, service or process effects", async () => {
  const f = await fixture();
  await runUpdate(["status"], f.env, f.ports);
  expect(JSON.parse(f.output.at(-1) ?? "{}")).toMatchObject({
    installedVersion: "1.0.0",
    update: null,
  });
  expect(f.calls).toEqual([]);
  await expect(readFile(join(f.root, "update.json"))).rejects.toMatchObject({ code: "ENOENT" });
  const release = await lockInstallation(f.root, "setup");
  try {
    await expect(runUpdate(["--yes"], f.env, f.ports)).rejects.toThrow("busy or uncertain");
  } finally {
    await release();
  }
});
it("requires explicit recovery consent and never reclaims an uncertain installation lock", async () => {
  const f = await fixture();
  f.ports.repair = async () => {
    throw Error("registration failed");
  };
  await expect(runUpdate(["--yes"], f.env, f.ports)).rejects.toThrow();
  const before = await readFile(join(f.root, "update.json"), "utf8");
  await runUpdate(["recover"], f.env, f.ports);
  expect(await readFile(join(f.root, "update.json"), "utf8")).toBe(before);
  const release = await lockInstallation(f.root);
  try {
    await expect(runUpdate(["recover", "--yes"], f.env, f.ports)).rejects.toThrow(
      "busy or uncertain",
    );
  } finally {
    await release();
  }
  expect(await readFile(join(f.root, "update.json"), "utf8")).toBe(before);
});
