import { execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createGit } from "../src/git/index.js";
import { coordinateMetadata } from "../src/git/metadata.js";
import { commitFixture } from "./fixtures/git-repository.js";

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, stat: vi.fn(fs.stat) };
});

let root: string;
let a: string;
let b: string;
const deferred = () => {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};
async function queued(directory = a) {
  const canonical = await realpath(directory);
  const calls = vi.mocked(stat);
  await vi.waitFor(() => expect(calls).toHaveBeenCalledWith(canonical, { bigint: true }));
  const index = calls.mock.calls.findLastIndex(([path]) => path === canonical);
  await calls.mock.results[index]?.value;
  // The last identity read has resolved. Drain its continuation, which installs
  // the queue entry without more I/O, before changing the directory or signal.
  await new Promise<void>((resolve) => setImmediate(resolve));
}
function linkedCheckout() {
  commitFixture(a);
  const linked = join(root, "linked");
  execFileSync("git", ["worktree", "add", "--detach", "-q", linked], { cwd: a });
  return linked;
}
beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(join(tmpdir(), "code60-git-metadata-"));
  a = join(root, "a");
  b = join(root, "b");
  for (const repo of [a, b]) execFileSync("git", ["init", "-q", repo]);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it("serializes canonical aliases while unrelated repositories make independent progress", async () => {
  const alias = join(root, "alias");
  await symlink(a, alias, process.platform === "win32" ? "junction" : "dir");
  const gate = deferred();
  const first = vi.fn(async () => gate.promise);
  const second = vi.fn(async () => {});
  const one = coordinateMetadata(a, first);
  await vi.waitFor(() => expect(first).toHaveBeenCalledOnce());
  const two = coordinateMetadata(alias, second);
  const other = vi.fn(async () => {});
  await coordinateMetadata(b, other);
  expect(other).toHaveBeenCalledOnce();
  expect(second).not.toHaveBeenCalled();
  gate.release();
  await Promise.all([one, two]);
  expect(second).toHaveBeenCalledOnce();
});
it("uses the shared common directory for linked checkouts", async () => {
  const linked = linkedCheckout();
  const gate = deferred();
  const entered = vi.fn(async () => gate.promise);
  const first = coordinateMetadata(a, entered);
  await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
  const waiting = vi.fn(async () => {});
  const next = coordinateMetadata(linked, waiting);
  await coordinateMetadata(b, async () => {});
  expect(waiting).not.toHaveBeenCalled();
  gate.release();
  await Promise.all([first, next]);
  expect(waiting).toHaveBeenCalledOnce();
});
it("cancels queued work without waiting for another owner's active operation", async () => {
  const gate = deferred();
  const entered = vi.fn(async () => gate.promise);
  const first = coordinateMetadata(a, entered);
  await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
  vi.mocked(stat).mockClear();
  const abort = new AbortController();
  const waiting = vi.fn(async () => {});
  const next = coordinateMetadata(a, waiting, abort.signal);
  const rejected = expect(next).rejects.toThrow("cancel queued");
  await queued();
  abort.abort(new Error("cancel queued"));
  await rejected;
  expect(waiting).not.toHaveBeenCalled();
  gate.release();
  await first;
  await coordinateMetadata(a, async () => {});
  expect(waiting).not.toHaveBeenCalled();
});
it("cancels actual worktree creation while another Git instance owns the metadata queue", async () => {
  commitFixture(a);
  const gate = deferred();
  const entered = vi.fn(async () => gate.promise);
  const first = coordinateMetadata(a, entered);
  await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
  vi.mocked(stat).mockClear();
  const abort = new AbortController();
  const path = join(root, "cancelled-worker");
  const work = createGit().addWorktree(
    {
      repoDir: a,
      path,
      branch: "code60/cancelled-worker",
      base: "HEAD",
    },
    abort.signal,
  );
  const rejected = expect(work).rejects.toThrow("cancel queued");
  try {
    await queued();
    abort.abort(new Error("cancel queued"));
    await rejected;
    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    gate.release();
    await first;
  }
  await coordinateMetadata(a, async () => {});
  expect(
    execFileSync("git", ["for-each-ref", "refs/heads/code60/"], {
      cwd: a,
      encoding: "utf8",
    }),
  ).toBe("");
  await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
});
it.skipIf(process.platform === "win32")(
  "stops a started worktree hook before releasing its metadata queue",
  async () => {
    commitFixture(a);
    const hooks = join(a, ".git", "hooks");
    await writeFile(
      join(hooks, "post-checkout"),
      '#!/bin/sh\necho $$ > "$PWD/../hook-pid"\nexec sleep 60\n',
      { mode: 0o700 },
    );
    execFileSync("git", ["config", "core.hooksPath", hooks], { cwd: a });
    const abort = new AbortController();
    const path = join(root, "started-worker");
    const work = createGit().addWorktree(
      {
        repoDir: a,
        path,
        branch: "code60/started-worker",
        base: "HEAD",
      },
      abort.signal,
    );
    const rejected = expect(work).rejects.toThrow("cancel started");
    let pid = 0;
    try {
      await vi.waitFor(
        async () => {
          pid = Number(await readFile(join(root, "hook-pid"), "utf8"));
          expect(pid).toBeGreaterThan(0);
        },
        { timeout: 10_000 },
      );
    } finally {
      abort.abort(new Error("cancel started"));
      await rejected;
    }
    expect(() => process.kill(pid, 0)).toThrow();
    await coordinateMetadata(a, async () => {});
    // Git may already have created the worktree. Preserve it as evidence.
    expect((await stat(path)).isDirectory()).toBe(true);
  },
  20_000,
);
it("waits for started work's cleanup on cancellation and releases the queue after failure", async () => {
  const abort = new AbortController();
  const cleanup = deferred();
  const entered = vi.fn(async () => {
    await cleanup.promise;
    abort.signal.throwIfAborted();
  });
  const first = coordinateMetadata(a, entered, abort.signal);
  const rejected = expect(first).rejects.toThrow("cancel active");
  let settled = false;
  void first.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
  abort.abort(new Error("cancel active"));
  await coordinateMetadata(b, async () => {});
  expect(settled).toBe(false);
  cleanup.release();
  await rejected;
  await expect(coordinateMetadata(a, async () => "next")).resolves.toBe("next");
});
it("refuses a replaced common directory before a queued callback can mutate it", async () => {
  const gate = deferred();
  const entered = vi.fn(async () => gate.promise);
  const first = coordinateMetadata(a, entered);
  await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
  vi.mocked(stat).mockClear();
  const waiting = vi.fn(async () => {});
  const next = coordinateMetadata(a, waiting);
  const rejected = expect(next).rejects.toThrow();
  await queued();
  await rename(join(a, ".git"), join(a, "original.git"));
  await mkdir(join(a, ".git"));
  gate.release();
  await first;
  await rejected;
  expect(waiting).not.toHaveBeenCalled();
});
it("refuses a linked checkout redirected to another still-existing repository while queued", async () => {
  const linked = linkedCheckout();
  const gate = deferred();
  const entered = vi.fn(async () => gate.promise);
  const first = coordinateMetadata(a, entered);
  await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
  vi.mocked(stat).mockClear();
  const waiting = vi.fn(async () => {});
  const next = coordinateMetadata(linked, waiting);
  const rejected = expect(next).rejects.toThrow("changed while waiting");
  await queued(linked);
  await writeFile(join(linked, ".git"), `gitdir: ${join(b, ".git")}\n`);
  gate.release();
  await first;
  await rejected;
  expect(waiting).not.toHaveBeenCalled();
});
it("refuses a replaced checkout even when it still points to the original common directory", async () => {
  const linked = linkedCheckout();
  const metadata = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
    cwd: linked,
    encoding: "utf8",
  }).trim();
  const gate = deferred();
  const entered = vi.fn(async () => gate.promise);
  const first = coordinateMetadata(a, entered);
  await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
  vi.mocked(stat).mockClear();
  const waiting = vi.fn(async () => {});
  const next = coordinateMetadata(linked, waiting);
  const rejected = expect(next).rejects.toThrow("changed while waiting");
  await queued(linked);
  await rename(linked, join(root, "old-linked"));
  await mkdir(linked);
  await writeFile(join(linked, ".git"), `gitdir: ${metadata}\n`);
  gate.release();
  await first;
  await rejected;
  expect(waiting).not.toHaveBeenCalled();
});
