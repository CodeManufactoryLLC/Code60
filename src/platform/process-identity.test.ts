import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { statSync } from "node:fs";
import { mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  findRuntimeProcesses,
  inspectRuntimeProcess,
  type OwnedProcess,
  runtimeFileProcesses,
  runtimeProcessExists,
  runtimeProcessFamily,
  spawnOwnedProcess,
  waitForRuntimeExit,
} from "./index.js";

const nativeTarget =
  (process.platform === "darwin" && process.arch === "arm64") ||
  (process.platform === "linux" && process.arch === "x64");
const nativeMapping =
  process.platform !== "linux" ||
  (statSync("/proc/self/exe").ino === statSync(process.execPath).ino &&
    statSync("/proc/self/exe").dev === statSync(process.execPath).dev);
const native = nativeTarget && nativeMapping;
const roots: string[] = [];
const owned: OwnedProcess[] = [];
const raw: { child: ChildProcess; exited: Promise<unknown> }[] = [];
afterEach(async () => {
  for (const item of raw.splice(0)) {
    if (item.child.exitCode === null && item.child.signalCode === null) item.child.kill("SIGTERM");
    await item.exited;
  }
  for (const child of owned.splice(0)) await child.stop();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(descendant = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "code60 runtime ' ")));
  roots.push(root);
  const node = await realpath(process.execPath);
  const script = join(root, "runtime ' spaces.mjs");
  const pidFile = join(root, "child.pid");
  await mkdir(join(root, "home"));
  await writeFile(
    script,
    descendant
      ? `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000);`
      : "setInterval(()=>{},1000);",
    { mode: 0o600 },
  );
  const command = [node, script] as const;
  const child = await spawnOwnedProcess(command, root, {
    HOME: join(root, "home"),
    PATH: `${dirname(node)}:/usr/bin:/bin`,
  });
  owned.push(child);
  child.stdout.resume();
  child.stderr.resume();
  return { root, command, child, pidFile };
}
it.runIf(native)(
  "inspects the exact owned Node argv, UID and start identity outside the checkout",
  async () => {
    const f = await fixture();
    const identity = await inspectRuntimeProcess(f.child.pid, f.command);
    expect(identity).toMatchObject({
      pid: f.child.pid,
      uid: process.getuid?.(),
      parent: process.pid,
    });
    expect(identity?.commandHash).toMatch(/^[a-f0-9]{64}$/);
    expect(identity?.started.length).toBeGreaterThan(0);
    expect(await inspectRuntimeProcess(f.child.pid, f.command)).toEqual(identity);
    expect(runtimeProcessExists(f.child.pid)).toBe(true);
    await f.child.stop();
    expect(await inspectRuntimeProcess(f.child.pid, f.command)).toBe(null);
    expect(runtimeProcessExists(f.child.pid)).toBe(false);
  },
);
it.runIf(native)(
  "refuses a different command without exposing its inputs or terminating the process",
  async () => {
    const f = await fixture();
    await expect(
      inspectRuntimeProcess(f.child.pid, [f.command[0], "private input fixture"]),
    ).rejects.toThrow("ownership is unavailable");
    try {
      await inspectRuntimeProcess(f.child.pid, [f.command[0], "private input fixture"]);
    } catch (error) {
      expect(String(error)).not.toContain("private input fixture");
    }
    expect(f.child.hasExited()).toBe(false);
    expect(runtimeProcessExists(f.child.pid)).toBe(true);
  },
);

it.runIf(native)(
  "refuses a foreign executable even when launched with Node as its argv0",
  async () => {
    const node = await realpath(process.execPath);
    const child = spawn("/bin/sleep", ["30"], {
      argv0: node,
      stdio: "ignore",
      env: { PATH: "/usr/bin:/bin" },
    });
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    await once(child, "spawn");
    raw.push({ child, exited });
    if (!child.pid) throw Error("Fixture PID unavailable");
    await expect(inspectRuntimeProcess(child.pid, [node, "30"])).rejects.toThrow(
      "ownership is unavailable",
    );
    expect(runtimeProcessExists(child.pid)).toBe(true);
  },
);
it.runIf(native)(
  "captures a real descendant family and independently verifies all recorded exits",
  async () => {
    const f = await fixture(true);
    let descendant = 0;
    await vi.waitFor(async () => {
      descendant = Number(await readFile(f.pidFile, "utf8"));
      expect(descendant).toBeGreaterThan(0);
    });
    const identity = await inspectRuntimeProcess(f.child.pid, f.command);
    if (!identity) throw Error("Owned fixture process disappeared");
    const family = await runtimeProcessFamily(identity);
    expect(family).toEqual(expect.arrayContaining([f.child.pid, descendant]));
    await expect(waitForRuntimeExit(family, undefined, 20)).rejects.toThrow("processes remain");
    expect(runtimeProcessExists(descendant)).toBe(true);
    await f.child.stop();
    await waitForRuntimeExit(family);
    expect(family.every((pid) => !runtimeProcessExists(pid))).toBe(true);
  },
);
it.runIf(native)(
  "finds exact engine processes and positively inspects private file holders",
  async () => {
    const f = await fixture();
    expect((await findRuntimeProcesses(f.command)).map((entry) => entry.pid)).toEqual([
      f.child.pid,
    ]);
    const path = join(f.root, "owner.sqlite");
    await writeFile(path, "", { mode: 0o600 });
    const file = await open(path, "r");
    try {
      expect(await runtimeFileProcesses([path])).toContain(process.pid);
    } finally {
      await file.close();
    }
    expect(await runtimeFileProcesses([path])).toEqual([]);
    await f.child.stop();
    expect(await findRuntimeProcesses(f.command)).toEqual([]);
  },
);

it("bounds cancellation and rejects unsafe identities without sending termination signals", async () => {
  const f = await fixture();
  const signal = AbortSignal.abort(Error("cancelled"));
  await expect(inspectRuntimeProcess(f.child.pid, f.command, signal)).rejects.toThrow("cancelled");
  await expect(waitForRuntimeExit([f.child.pid], signal)).rejects.toThrow("cancelled");
  for (const pid of [0, -1, 1.5, Number.NaN, 2 ** 31])
    await expect(inspectRuntimeProcess(pid, f.command)).rejects.toThrow("ownership is unavailable");
  await expect(waitForRuntimeExit([f.child.pid], undefined, 90_001)).rejects.toThrow(
    "ownership is unavailable",
  );
  expect(f.child.hasExited()).toBe(false);
});

it.runIf(!nativeTarget)(
  "rejects native engine inspection on unsupported targets without touching the process",
  async () => {
    const f = await fixture();
    await expect(inspectRuntimeProcess(f.child.pid, f.command)).rejects.toThrow(
      "requires macOS Apple Silicon",
    );
    expect(runtimeProcessExists(f.child.pid)).toBe(true);
  },
);
it.runIf(nativeTarget && !nativeMapping)(
  "refuses unverifiable emulator ownership instead of adopting by argv",
  async () => {
    const f = await fixture();
    await expect(inspectRuntimeProcess(f.child.pid, f.command)).rejects.toThrow(
      "ownership is unavailable",
    );
    await expect(findRuntimeProcesses(f.command)).rejects.toThrow("ownership is unavailable");
    const path = join(f.root, "owner.sqlite");
    await writeFile(path, "", { mode: 0o600 });
    await expect(runtimeFileProcesses([path])).rejects.toThrow("ownership is unavailable");
    expect(f.child.hasExited()).toBe(false);
  },
);
