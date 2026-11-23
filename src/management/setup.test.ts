import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { installManagedRelease } from "./installation.js";
import { runSetup, type SetupPorts } from "./setup.js";
import { setupFlags } from "./setup-input.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), "code60 setup unit ")));
  roots.push(home);
  const env = { HOME: home, SHELL: "/bin/bash", PATH: `${home}/.local/bin:${process.env.PATH}` };
  await installManagedRelease({
    env,
    runtimeDirectory: resolve("build/distribution"),
    artifact: {
      identity: {
        version: "1.0.0",
        os: process.platform,
        arch: process.arch,
        archive: { sha256: "a".repeat(64) },
      },
      acquire: async ({ parent }) => {
        const owned = await mkdtemp(join(parent, ".payload-")),
          root = join(owned, "application");
        await mkdir(join(root, "dist/management"), { recursive: true, mode: 0o700 });
        await writeFile(join(root, "payload.json"), "{}");
        await writeFile(join(root, "package.json"), '{"type":"module"}');
        await writeFile(
          join(root, "dist/management/cli.js"),
          "export async function runManagement(){}",
        );
        return { root, owned };
      },
    },
  });
  let enrolled = false;
  const calls: string[] = [],
    output: string[] = [];
  const ports: SetupPorts = {
    interactive: false,
    confirm: vi.fn(async () => false),
    write: (text) => {
      output.push(text);
    },
    service: vi.fn(async (action) => {
      calls.push(action);
      if (action === "install") enrolled = true;
      return {
        installed: enrolled,
        nativeState: "running",
        runtimeCurrent: true,
        service: enrolled ? { pid: 111 } : null,
      };
    }),
    request: vi.fn(async (action) => {
      calls.push(action);
      return action === "pair"
        ? { origin: "http://127.0.0.1:12345", requirePairing: false }
        : { pid: 111 };
    }),
    open: vi.fn(async () => {}),
    readinessMs: 300,
  };
  return { home, env, ports, calls, output };
}
it("strictly rejects flags before setup side effects", () => {
  for (const args of [["--force"], ["--yes", "--yes"], ["extra"]])
    expect(() => setupFlags(args)).toThrow("Use code60 setup");
});
it("non-TTY defaults to files-only success and prints the absolute continuation without mutations", async () => {
  const f = await fixture();
  await runSetup([], f.env, f.ports);
  expect(f.calls).toEqual(["status"]);
  expect(f.ports.confirm).not.toHaveBeenCalled();
  expect(f.output.join("")).toContain("Setup is incomplete");
  expect(f.output.join("")).toContain(`${f.home}/.local/bin/code60`);
  expect(f.ports.request).not.toHaveBeenCalled();
});
it("explicit service approval prepares the database before pairing and honors no-open", async () => {
  const f = await fixture();
  await runSetup(["--yes", "--no-open"], f.env, f.ports);
  expect(f.calls).toEqual(["status", "install", "status", "status", "prepare-database", "pair"]);
  expect(f.ports.open).not.toHaveBeenCalled();
  expect(f.output.join("")).toContain("Code60 is ready");
});
it("service --yes never authorizes interactive profile changes", async () => {
  const f = await fixture();
  f.env.PATH = process.env.PATH ?? "";
  f.ports.interactive = true;
  await runSetup(["--yes"], f.env, f.ports);
  expect(f.ports.confirm).toHaveBeenCalledTimes(1);
  expect(f.ports.open).toHaveBeenCalledWith("http://127.0.0.1:12345");
  await expect(readFile(join(f.home, ".profile"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("readiness timeout preserves registration and never requests database creation", async () => {
  const f = await fixture();
  f.ports.request = vi.fn(async () => {
    throw Error("not ready");
  });
  f.ports.readinessMs = 1;
  await expect(runSetup(["--yes"], f.env, f.ports)).rejects.toThrow("readiness timed out");
  expect(f.calls).toEqual(["status", "install"]);
});
it("opener failure retains the usable URL and a successful setup", async () => {
  const f = await fixture();
  f.ports.open = vi.fn(async () => {
    throw Error("unavailable");
  });
  await runSetup(["--yes"], f.env, f.ports);
  expect(f.output.join("")).toContain("Open http://127.0.0.1:12345");
  expect(f.output.join("")).toContain("Open the address above");
});
it("refuses conflicting registration without repair and releases only its own setup lock", async () => {
  const f = await fixture();
  f.ports.service = vi.fn(async () => ({
    installed: true,
    runtimeCurrent: false,
    nativeState: "running",
  }));
  await expect(runSetup(["--yes"], f.env, f.ports)).rejects.toThrow("conflicting");
  await runSetup([], f.env, { ...f.ports, service: async () => ({ installed: false }) });
});
it("cancellation preserves signal exit status and releases the setup lock", async () => {
  const f = await fixture();
  f.ports.service = vi.fn(async () => {
    process.emit("SIGINT");
    return { installed: false };
  });
  await expect(runSetup(["--yes"], f.env, f.ports)).rejects.toThrow();
  expect(process.exitCode).toBe(130);
});
it("same-destination setup contention fails promptly while preserving the first owner", async () => {
  const f = await fixture();
  let release: () => void = () => {};
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const original = f.ports.service;
  f.ports.service = vi.fn(async (action, consent) => {
    if (action === "install") await gate;
    return original(action, consent);
  });
  const first = runSetup(["--yes", "--no-open"], f.env, f.ports);
  try {
    await vi.waitFor(() => expect(f.ports.service).toHaveBeenCalledWith("install", true));
    await expect(runSetup(["--yes"], f.env, f.ports)).rejects.toThrow("busy or uncertain");
  } finally {
    release();
    await first;
  }
});
