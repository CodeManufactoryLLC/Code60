import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

// Execute the actual entry point with only its OS/process dependencies replaced.
const scriptUrl = new URL("../scripts/dev.mjs", import.meta.url).href;
const source = (await readFile(new URL(scriptUrl), "utf8"))
  .replace(/^import .*;\r?$/gm, "")
  .replace(/^const \{ spawnOwnedProcess \} = await import\(.*\);\r?$/m, "")
  .replaceAll("import.meta.url", "scriptUrl");

function session(platform, pendingCommand, failReplacement = false) {
  const children = [];
  const signals = {};
  let scheduled;
  let changed;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const process = {
    platform,
    execPath: "fixture-node",
    on: (name, handler) => {
      signals[name] = handler;
    },
  };
  const watcher = Object.assign(new EventEmitter(), { close: vi.fn() });
  const watch = vi.fn((_path, _options, handler) => {
    changed = handler;
    return watcher;
  });
  const spawnOwnedProcess = async (command) => {
    let finish;
    const exited = new Promise((resolve) => {
      finish = resolve;
    });
    let stopping;
    const child = {
      command,
      exited,
      stdout: { pipe: vi.fn() },
      stderr: { pipe: vi.fn() },
      exit: (code) => finish({ code }),
      stop: vi.fn(() => {
        stopping ??= Promise.resolve().then(() => finish({ code: 0 }));
        return stopping;
      }),
    };
    children.push(child);
    if (command.includes("build") && !command.includes("--watch")) child.exit(0);
    if (
      failReplacement &&
      command[0] === "fixture-electron" &&
      children.filter((child) => child.command[0] === "fixture-electron").length === 2
    )
      child.exit(9);
    if (
      (pendingCommand === "app" && command[0] === "fixture-electron") ||
      (pendingCommand === "watcher" && command.includes("--watch"))
    )
      await pending;
    return child;
  };
  const done = runInNewContext(`(async () => {\n${source}\n})()`, {
    URL,
    scriptUrl,
    fileURLToPath,
    process,
    watch,
    spawnOwnedProcess,
    electron: "fixture-electron",
    execFileSync: vi.fn(),
    console: { error: vi.fn() },
    setTimeout: (callback) => {
      scheduled = callback;
      return 1;
    },
    clearTimeout: () => {
      scheduled = undefined;
    },
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
    apps: () => children.filter((child) => child.command[0] === "fixture-electron"),
  };
}

it("stops watchers when the replacement Windows app exits during restart", async () => {
  const dev = session("win32", undefined, true);
  await dev.done;
  dev.change();
  await vi.waitFor(() => expect(dev.process.exitCode).toBe(9));
  expect(dev.apps()).toHaveLength(2);
  expect(dev.apps()[0].stop).toHaveBeenCalledWith(0);
  for (const child of dev.children) expect(child.stop).toHaveBeenCalled();
});

it("preserves the POSIX app grace period on restart and shutdown", async () => {
  const dev = session("linux");
  await dev.done;
  dev.change();
  await vi.waitFor(() => expect(dev.apps()).toHaveLength(2));
  expect(dev.apps()[0].stop).toHaveBeenCalledWith(25_000);
  dev.signals.SIGTERM();
  await vi.waitFor(() => expect(dev.process.exitCode).toBe(130));
  expect(dev.apps()[1].stop).toHaveBeenCalledWith(25_000);
  for (const child of dev.children.filter((child) => child.command.includes("--watch")))
    expect(child.stop).toHaveBeenCalledWith(5_000);
});

it("stops every development process after a file-watcher error", async () => {
  const dev = session("win32");
  await dev.done;
  dev.watcher.emit("error", new Error("watcher failed"));
  await vi.waitFor(() => expect(dev.process.exitCode).toBe(1));
  expect(dev.watcher.close).toHaveBeenCalled();
  for (const child of dev.children) expect(child.stop).toHaveBeenCalled();
});

it.each(["app", "watcher"])(
  "does not orphan a %s launched while shutdown starts",
  async (command) => {
    const dev = session("win32", command);
    await vi.waitFor(() =>
      expect(
        dev.children.some((child) =>
          command === "app"
            ? child.command[0] === "fixture-electron"
            : child.command.includes("--watch"),
        ),
      ).toBe(true),
    );
    dev.signals.SIGINT();
    dev.release();
    await dev.done;
    await vi.waitFor(() => expect(dev.process.exitCode).toBe(130));
    for (const child of dev.children) expect(child.stop).toHaveBeenCalled();
    if (command === "app") expect(dev.watch).not.toHaveBeenCalled();
  },
);
