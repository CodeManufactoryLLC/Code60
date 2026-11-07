import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultDeps } from "../src/core/index.js";
import { createRecordStore } from "../src/core/records.js";
import { atomicReplace, verifyPrivateSync } from "../src/platform/index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), "code60-win-storage-"));
  directories.push(dir);
  return dir;
}

async function lock(path: string) {
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `
    $ErrorActionPreference = 'Stop'
    $file = [System.IO.File]::Open($env:CODE60_LOCK_FILE, 'Open', 'Read', 'Read')
    try { [Console]::Out.WriteLine('ready'); [Console]::In.ReadLine() | Out-Null }
    finally { $file.Dispose() }
  `,
    ],
    {
      env: { ...process.env, CODE60_LOCK_FILE: path },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Sharing-lock fixture timed out")), 5_000);
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Sharing-lock fixture exited before readiness")));
      child.stdout.once("data", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  } catch (error) {
    child.kill();
    throw error;
  }
  return {
    release() {
      child.stdin.end("\n");
    },
    async close() {
      child.kill();
      await closed;
    },
  };
}

describe.runIf(process.platform === "win32")("real Windows storage", () => {
  it("does not treat a real read-only destination as a transient sharing violation", async () => {
    const dir = await directory();
    const from = join(dir, "new"),
      to = join(dir, "old");
    await writeFile(from, "new");
    await writeFile(to, "old");
    await chmod(to, 0o400);
    try {
      await expect(atomicReplace(from, to)).rejects.toMatchObject({ code: "EACCES" });
      expect(await readFile(to, "utf8")).toBe("old");
    } finally {
      await chmod(to, 0o600);
    }
  });

  it("creates restrictive record and event ACLs through the default dependencies", async () => {
    const dir = await directory();
    const store = createRecordStore(defaultDeps().fs, join(dir, "records"));
    await store.save({
      id: "run-1",
      agent: "fake",
      status: "queued",
      firstPrompt: "",
      turns: 0,
      base: null,
      branch: null,
      worktree: dir,
      ownerPid: process.pid,
      startedAt: new Date().toISOString(),
    });
    await store.appendEvent({
      runId: "run-1",
      type: "message",
      text: "fixture",
      at: new Date().toISOString(),
    });
    for (const path of [
      join(dir, "records", "run-1"),
      join(dir, "records", "run-1", "run.json"),
      join(dir, "records", "run-1", "events.jsonl"),
    ])
      expect(() => verifyPrivateSync(path)).not.toThrow();
  });
  it("retries an actual sharing violation and never removes the old destination", async () => {
    const dir = await directory();
    const from = join(dir, "new"),
      to = join(dir, "old");
    await writeFile(from, "new");
    await writeFile(to, "old");
    const handle = await lock(to);
    let release: ReturnType<typeof setTimeout> | undefined;
    try {
      const replacement = atomicReplace(from, to);
      void replacement.catch(() => {});
      expect(await readFile(to, "utf8")).toBe("old");
      release = setTimeout(() => handle.release(), 80);
      await replacement;
      expect(await readFile(to, "utf8")).toBe("new");
    } finally {
      clearTimeout(release);
      await handle.close();
    }
  });
  it("bounds persistent sharing violations and preserves both files", async () => {
    const dir = await directory();
    const from = join(dir, "new"),
      to = join(dir, "old");
    await writeFile(from, "new");
    await writeFile(to, "old");
    const handle = await lock(to);
    try {
      const started = performance.now();
      await expect(atomicReplace(from, to)).rejects.toMatchObject({ code: "EBUSY" });
      expect(performance.now() - started).toBeLessThan(700);
      expect(await readFile(to, "utf8")).toBe("old");
      expect(await readFile(from, "utf8")).toBe("new");
    } finally {
      await handle.close();
    }
  });
});
