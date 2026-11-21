import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type OwnedProcess, spawnOwnedProcess } from "./index.js";

const children: OwnedProcess[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => child.stop(0)));
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), "code60-native-"));
  directories.push(dir);
  return dir;
}
async function launch(script: string, ...args: string[]) {
  const child = await spawnOwnedProcess(
    [process.execPath, "-e", script, ...args],
    await directory(),
  );
  children.push(child);
  return child;
}

describe("owned native processes", () => {
  it("makes repeated and concurrent stops idempotent", async () => {
    const child = await launch("setInterval(() => {}, 1000)");
    const started = Date.now();
    await Promise.all([child.stop(1000), child.stop(0), child.stop(0)]);
    await child.stop(0);
    expect(Date.now() - started).toBeLessThan(7_000);
  });

  it("reports the root exit code without waiting for stop", async () => {
    const child = await launch("setTimeout(() => process.exit(3), 100)");
    expect(await child.exited).toEqual({ code: 3, signal: null });
  });

  it("round trips executable arguments without shell interpretation", async () => {
    const args = [
      "",
      "space here",
      "雪",
      '"quoted"',
      "trailing\\",
      "%PATH%",
      "!",
      "&",
      "|",
      "^",
      "(x)",
      "<",
      ">",
    ];
    const child = await launch(
      "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
      ...args,
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    expect((await child.exited).code).toBe(0);
    await child.stop(0);
    expect(JSON.parse(output)).toEqual(args);
  });

  it("kills descendants when the root exits, without touching an unrelated sentinel", async () => {
    const dir = await directory();
    const sentinel = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    try {
      const pidFile = join(dir, "child.pid");
      const child = await launch(
        `
        const {spawn}=require('node:child_process');
        const {writeFileSync}=require('node:fs');
        const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
        writeFileSync(process.argv[1],String(child.pid));
        setTimeout(()=>process.exit(0),100);
      `,
        pidFile,
      );
      await child.exited;
      await child.stop(0);
      const pid = Number(await readFile(pidFile, "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
      expect(() => process.kill(sentinel.pid as number, 0)).not.toThrow();
    } finally {
      sentinel.kill();
    }
  });
  it("retries verification after a delayed group exit without re-signalling an old identifier", async () => {
    const child = await launch("process.exit(0)");
    await child.exited;
    const original = process.kill.bind(process);
    let groupPresent = true;
    const signals: (number | string | undefined)[] = [];
    const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === -child.pid) {
        if (signal === 0 && groupPresent) return true;
        if (signal !== 0) signals.push(signal);
      }
      return original(pid, signal);
    });
    vi.useFakeTimers();
    try {
      const failed = expect(child.stop(0)).rejects.toThrow("cleanup exceeded");
      await vi.advanceTimersByTimeAsync(7_100);
      await failed;
      const previous = [...signals];
      groupPresent = false;
      await child.stop(0);
      expect(signals).toEqual(previous);
    } finally {
      kill.mockRestore();
      vi.useRealTimers();
    }
  });
});
