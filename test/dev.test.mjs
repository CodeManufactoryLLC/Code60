import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { developmentPort } from "../scripts/dev-ports.mjs";

const scriptUrl = new URL("../scripts/dev.mjs", import.meta.url).href;
const source = (await readFile(new URL(scriptUrl), "utf8"))
  .replace(/^import .*;\r?$/gm, "")
  .replace(/^const \{ spawnOwnedProcess \} = await import\(.*\);\r?$/m, "")
  .replaceAll("import.meta.url", "scriptUrl");
function session(pendingCommand, env = {}) {
  const children = [];
  const signals = {};
  let changed;
  let scheduled;
  const listeners = [];
  let selectedPort = 1234;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const process = {
    execPath: "fixture-node",
    env,
    stdout: {},
    stderr: { write: vi.fn() },
    once: (name, action) => {
      signals[name] = action;
    },
  };
  const watcher = Object.assign(new EventEmitter(), { close: vi.fn() });
  const watch = vi.fn((_path, _options, callback) => {
    changed = callback;
    return watcher;
  });
  const spawnOwnedProcess = async (command, _directory, environment) => {
    let finish;
    let stopped;
    const exited = new Promise((resolve) => {
      finish = resolve;
    });
    const child = {
      command,
      environment,
      exited,
      stdout: { pipe: vi.fn() },
      stderr: { pipe: vi.fn() },
      exit: (code) => finish({ code }),
      stop: vi.fn(() => {
        stopped ??= Promise.resolve().then(() => finish({ code: 0 }));
        return stopped;
      }),
    };
    child.stdout.on = (_event, listener) => {
      if (command.includes("--watch")) listener("Found 0 errors. Watching for file changes.");
      return child.stdout;
    };
    children.push(child);
    if (
      (pendingCommand === "backend" && command.includes("scripts/dev-backend.mjs")) ||
      (pendingCommand === "compiler" && command.includes("--watch"))
    )
      await pending;
    return child;
  };
  const done = runInNewContext(`(async () => {\n${source}\n})()`, {
    developmentPort,
    URL,
    scriptUrl,
    fileURLToPath,
    join,
    isAbsolute,
    process,
    watch,
    spawnOwnedProcess,
    WeakSet,
    createServer: () => ({
      once() {},
      listen(_port, _host, ready) {
        listeners.push([_port, _host]);
        selectedPort = _port || 1234;
        ready();
      },
      address() {
        return { port: selectedPort };
      },
      close(ready) {
        ready();
      },
    }),
    execFileSync: vi.fn(),
    fetch: async () => ({ ok: true }),
    AbortSignal,
    setTimeout: (callback) => {
      scheduled = callback;
      return 1;
    },
    clearTimeout: () => {},
  });
  return {
    done,
    listeners,
    children,
    process,
    signals,
    watch,
    watcher,
    release,
    change: () => {
      changed();
      scheduled();
    },
    apps: () => children.filter((child) => child.command.includes("scripts/dev-backend.mjs")),
  };
}
it("restarts only the backend for compiled changes and stops every development process", async () => {
  const dev = session();
  await dev.done;
  expect(dev.children.some((child) => child.command.includes("build"))).toBe(false);
  dev.change();
  await vi.waitFor(() => expect(dev.apps()).toHaveLength(2));
  expect(dev.apps()[0].stop).toHaveBeenCalledWith(25_000);
  dev.signals.SIGTERM();
  await vi.waitFor(() => expect(dev.process.exitCode).toBe(143));
  for (const child of dev.children) expect(child.stop).toHaveBeenCalled();
});
it("selects an explicit loopback Vite port and preserves the gateway port across restarts", async () => {
  const dev = session(undefined, { CODE60_VITE_PORT: "43161", CODE60_DEV_GATEWAY_PORT: "43160" });
  await dev.done;
  expect(dev.listeners).toEqual([[43161, "127.0.0.1"]]);
  expect(dev.children.find((child) => child.command.includes("--strictPort")).command).toContain(
    "43161",
  );
  dev.change();
  await vi.waitFor(() => expect(dev.apps()).toHaveLength(2));
  expect(dev.process.env.CODE60_DEV_GATEWAY_PORT).toBe("43160");
  dev.signals.SIGTERM();
  await vi.waitFor(() => expect(dev.process.exitCode).toBe(143));
});
it("retains ephemeral Vite selection without overrides", async () => {
  const dev = session();
  await dev.done;
  expect(dev.listeners).toEqual([[0, "127.0.0.1"]]);
  dev.signals.SIGTERM();
  await vi.waitFor(() => expect(dev.process.exitCode).toBe(143));
});
it("isolates development state only in an explicitly absolute QA root", async () => {
  const dev = session(undefined, { CODE60_DEV_DATA_ROOT: "/owned-qa" });
  await dev.done;
  expect(dev.apps()[0].environment).toMatchObject({
    XDG_CONFIG_HOME: "/owned-qa/config",
    XDG_STATE_HOME: "/owned-qa/state",
  });
  dev.signals.SIGTERM();
  await vi.waitFor(() => expect(dev.process.exitCode).toBe(143));
  const invalid = session(undefined, { CODE60_DEV_DATA_ROOT: "relative" });
  await expect(invalid.done).rejects.toThrow("must be absolute");
  expect(invalid.children).toEqual([]);
});
it.each([
  { CODE60_VITE_PORT: "65536" },
  { CODE60_DEV_GATEWAY_PORT: "invalid" },
  { CODE60_VITE_PORT: "43160", CODE60_DEV_GATEWAY_PORT: "43160" },
])("rejects invalid or overlapping development ports before spawning (%j)", async (env) => {
  const dev = session(undefined, env);
  await expect(dev.done).rejects.toThrow(/ports must differ|between 1 and 65535/);
  expect(dev.children).toEqual([]);
});
it("stops Vite and the compiler when the backend fails", async () => {
  const dev = session();
  await dev.done;
  dev.apps()[0].exit(9);
  await vi.waitFor(() => expect(dev.process.exitCode).toBe(9));
  for (const child of dev.children) expect(child.stop).toHaveBeenCalled();
});
it("cleans up after watcher failure", async () => {
  const dev = session();
  await dev.done;
  dev.watcher.emit("error", new Error("fixture"));
  await vi.waitFor(() => expect(dev.process.exitCode).toBe(1));
  expect(dev.watcher.close).toHaveBeenCalled();
});
it.each(["backend", "compiler"])("does not orphan a %s launched during shutdown", async (kind) => {
  const dev = session(kind);
  await vi.waitFor(() =>
    expect(
      kind === "backend"
        ? dev.apps().length
        : dev.children.filter((child) => child.command.includes("--watch")).length,
    ).toBe(1),
  );
  dev.signals.SIGINT();
  dev.release();
  await dev.done;
  await vi.waitFor(() => expect(dev.process.exitCode).toBe(130));
  for (const child of dev.children) expect(child.stop).toHaveBeenCalled();
});
