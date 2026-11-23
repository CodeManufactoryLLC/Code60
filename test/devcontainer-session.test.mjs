import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runContainerDevelopment } from "../scripts/devcontainer-forward.mjs";

const cleanup = [];
afterEach(async () => {
  for (const stop of cleanup.splice(0).reverse()) await stop();
});
async function session(source) {
  const directory = await mkdtemp(join(tmpdir(), "code60-session-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "scripts"));
  await writeFile(join(directory, "scripts/dev.mjs"), source);
  const children = [];
  const launch = (_file, args, options) => {
    expect(args.slice(0, 4)).toEqual(["exec", "-i", "owned-container", "node"]);
    const child = spawn(process.execPath, [args[4]], {
      ...options,
      cwd: directory,
      stdio: ["pipe", "ignore", "ignore"],
    });
    children.push(child);
    return child;
  };
  const abort = new AbortController();
  const done = runContainerDevelopment(resolve("."), "owned-container", {
    signal: abort.signal,
    spawn: launch,
  });
  void done.catch(() => {});
  cleanup.push(async () => {
    abort.abort();
    await done.catch(() => {});
  });
  return { directory, done, abort, children };
}

it("waits for remote graceful shutdown before completing host cancellation", async () => {
  const dev = await session(`import {writeFileSync} from 'node:fs';
    process.on('SIGTERM', () => {writeFileSync('stopped','graceful'); clearInterval(keep);});
    const keep=setInterval(()=>{},1000); writeFileSync('ready','yes');`);
  await vi.waitFor(async () =>
    expect(await readFile(join(dev.directory, "ready"), "utf8")).toBe("yes"),
  );
  dev.abort.abort();
  await expect(dev.done).rejects.toMatchObject({ name: "AbortError" });
  expect(await readFile(join(dev.directory, "stopped"), "utf8")).toBe("graceful");
  expect(dev.children[0].exitCode).toBe(0);
});

it("reports remote development failure without leaving stdin open", async () => {
  const dev = await session("process.exitCode=7;");
  await expect(dev.done).rejects.toThrow("Container development failed (7)");
  expect(dev.children[0].exitCode).toBe(7);
});

it("rejects pre-cancelled development without spawning a process", async () => {
  const abort = new AbortController();
  abort.abort();
  const launch = vi.fn();
  await expect(
    runContainerDevelopment("/unused", "unused", { signal: abort.signal, spawn: launch }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(launch).not.toHaveBeenCalled();
});
