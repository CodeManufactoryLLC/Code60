import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

const scriptUrl = new URL("../scripts/dev.mjs", import.meta.url).href;
const source = (await readFile(new URL(scriptUrl), "utf8"))
  .replace(/^import .*;\r?$/gm, "")
  .replace(/^const \{ spawnOwnedProcess \} = await import\(.*\);\r?$/m, "")
  .replaceAll("import.meta.url", "scriptUrl");
function session(pendingCommand) {
  const children = [];
  const signals = {};
  let changed;
  let scheduled;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const process = {
    execPath: "fixture-node",
    env: {},
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
  const spawnOwnedProcess = async (command) => {
    let finish;
    let stopped;
    const exited = new Promise((resolve) => {
      finish = resolve;
    });
    const child = {
      command,
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
    URL,
    scriptUrl,
    fileURLToPath,
    join,
    process,
    watch,
    spawnOwnedProcess,
    WeakSet,
    createServer: () => ({
      once() {},
      listen(_port, _host, ready) {
        ready();
      },
      address() {
        return { port: 1234 };
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
