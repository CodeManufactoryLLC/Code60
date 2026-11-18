import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createGit } from "../git/index.js";
import { TaskLoop } from "./task-loop.js";

// Each case runs real Git and, on Windows, a native helper process per private write.
// Unloaded Windows runners take up to 7 seconds per case.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let root: string;
let project: string;
let loop: TaskLoop;
let task: string;
const git = createGit();
const tasks = (() => {
  const value = git.tasks;
  if (!value) throw new Error("Task operations unavailable");
  return value;
})();
const command = (cwd: string, ...args: string[]) =>
  execFileSync(
    "git",
    ["-c", `core.hooksPath=${join(root, "no-hooks")}`, "-c", "commit.gpgsign=false", ...args],
    {
      cwd,
      encoding: "utf8",
    },
  ).trim();
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "code60-task-test-")));
  project = join(root, "project");
  await fs.mkdir(project);
  command(project, "init", "-q");
  command(project, "config", "core.autocrlf", "false");
  command(project, "config", "user.name", "Test");
  command(project, "config", "user.email", "test@example.invalid");
  await fs.writeFile(join(project, "file.txt"), "first\nsecond\nthird\nfourth\nfifth\n");
  command(project, "add", ".");
  command(project, "commit", "-qm", "baseline");
  task = randomUUID();
  loop = new TaskLoop(project, join(root, "tasks"), tasks);
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it("serializes complete checkout transactions while independent checkouts proceed", async () => {
  const events: string[] = [];
  let entered!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = TaskLoop.coordinate([project], async () => {
    events.push("first started");
    entered();
    await gate;
    events.push("first finished");
  });
  await ready;
  const second = TaskLoop.coordinate([project], async () => {
    events.push("second");
  });
  await TaskLoop.coordinate([join(root, "other")], async () => {
    events.push("independent");
  });
  expect(events).toEqual(["first started", "independent"]);
  release();
  await Promise.all([first, second]);
  expect(events).toEqual(["first started", "independent", "first finished", "second"]);
});
it("orders and deduplicates multi-target leases and releases them after failure", async () => {
  const other = join(root, "other");
  let entered!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = TaskLoop.coordinate([project, other, project], async () => {
    entered();
    await gate;
    throw new Error("transaction failed");
  });
  const failure = expect(first).rejects.toThrow("transaction failed");
  await ready;
  let secondEntered = false;
  const second = TaskLoop.coordinate([other, project], async () => {
    secondEntered = true;
    return "second";
  });
  await TaskLoop.coordinate([join(root, "independent")], async () => {});
  expect(secondEntered).toBe(false);
  release();
  await failure;
  await expect(second).resolves.toBe("second");
  await expect(TaskLoop.coordinate([project, other], async () => "next")).resolves.toBe("next");
});
it.each([false, true])(
  "serializes nested roots in either acquisition order (%s)",
  async (childFirst) => {
    const child = join(project, "nested");
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = TaskLoop.coordinate([childFirst ? child : project], async () => {
      entered();
      await gate;
    });
    await ready;
    let secondEntered = false;
    const second = TaskLoop.coordinate([childFirst ? project : child], async () => {
      secondEntered = true;
    });
    await TaskLoop.coordinate([`${project}-independent`], async () => {});
    expect(secondEntered).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(secondEntered).toBe(true);
  },
);
it("binds a previously captured Relay baseline without recapturing later project edits", async () => {
  const captured = await tasks.snapshot(project);
  await fs.writeFile(join(project, "file.txt"), "Edited after dispatch\n");
  const snapshot = vi.fn(async () => {
    throw new Error("Must not recapture");
  });
  const seeded = new TaskLoop(project, join(root, "relay-task"), { ...tasks, snapshot });
  await expect(seeded.baseline(task, captured)).resolves.toBe(captured);
  await expect(seeded.baseline(task)).resolves.toBe(captured);
  await expect(seeded.baseline(task, "b".repeat(40))).rejects.toThrow("already bound");
  await expect(seeded.baseline(randomUUID(), "HEAD")).rejects.toThrow();
  expect(snapshot).not.toHaveBeenCalled();
  const reopened = new TaskLoop(project, join(root, "relay-task"), { ...tasks, snapshot });
  expect((await reopened.state(task)).baseline).toBe(captured);
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe("Edited after dispatch\n");
});
async function worker(name: string) {
  const base = await loop.baseline(task);
  const path = join(root, name);
  await git.addWorktree({ repoDir: project, path, branch: `code60/${name}`, base });
  return { path, base, runId: name };
}
async function capture(workers: Awaited<ReturnType<typeof worker>>[]) {
  const revision = randomUUID();
  const sources = await Promise.all(
    workers.map(async (worker) => ({
      runId: worker.runId,
      base: worker.base,
      commit: await tasks.snapshot(worker.path),
    })),
  );
  return loop.prepare(task, revision, sources);
}
it("starts from current tracked and eligible untracked files without touching HEAD or staging", async () => {
  await fs.writeFile(join(project, "file.txt"), "staged\n");
  command(project, "add", "file.txt");
  await fs.writeFile(join(project, "file.txt"), "current\n");
  await fs.writeFile(join(project, "requirements.md"), "new requirement");
  await fs.writeFile(join(project, ".env"), "DUMMY=example");
  const identity = await tasks.identity(project);
  const w = await worker("current");
  expect(await fs.readFile(join(w.path, "file.txt"), "utf8")).toBe("current\n");
  expect(await fs.readFile(join(w.path, "requirements.md"), "utf8")).toBe("new requirement");
  await expect(fs.access(join(w.path, ".env"))).rejects.toThrow();
  expect(await tasks.identity(project)).toBe(identity);
  expect(await loop.baseline(task)).toBe(w.base);
});
it("applies, survives restart, undoes, and includes accepted files in the next task", async () => {
  const w = await worker("apply");
  await fs.writeFile(join(w.path, "file.txt"), "worker result\n");
  await fs.writeFile(join(w.path, "image.bin"), Buffer.from([0, 255, 128, 9]));
  const identity = await tasks.identity(project);
  const proposal = await capture([w]);
  expect(proposal.conflicts).toEqual([]);
  await loop.execute(task, proposal.id, "apply");
  await loop.execute(task, proposal.id, "apply");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe("worker result\n");
  expect(await tasks.identity(project)).toBe(identity);
  expect((await capture([w])).changes).toEqual([]);
  const next = await loop.baseline(randomUUID());
  const tree = await tasks.tree(project, next);
  expect(
    await tasks.blob(
      project,
      (
        tree["file.txt"] ??
        (() => {
          throw new Error("Missing file");
        })()
      ).oid,
    ),
  ).toEqual(Buffer.from("worker result\n"));
  loop = new TaskLoop(project, join(root, "tasks"), tasks);
  await loop.execute(task, proposal.id, "undo");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toContain("first\n");
  await expect(fs.access(join(project, "image.bin"))).rejects.toThrow();
  expect(await tasks.identity(project)).toBe(identity);
  await fs.access(w.path);
});
it("rewinds several worker updates without losing edits made between or after updates", async () => {
  const lines = Array.from({ length: 30 }, (_, index) => `line ${index}`);
  const text = (edits: Record<number, string>) =>
    `${lines.map((line, index) => edits[index] ?? line).join("\n")}\n`;
  await fs.writeFile(join(project, "file.txt"), text({}));
  const w = await worker("rewind");
  await fs.writeFile(join(w.path, "file.txt"), text({ 0: "worker first" }));
  const first = await capture([w]);
  await loop.execute(task, first.id, "apply");
  await fs.writeFile(join(project, "file.txt"), text({ 0: "worker first", 15: "user between" }));
  await fs.writeFile(join(w.path, "file.txt"), text({ 0: "worker first", 29: "worker last" }));
  const second = await capture([w]);
  await loop.execute(task, second.id, "apply");
  await fs.writeFile(
    join(project, "file.txt"),
    text({ 0: "worker first", 8: "user after", 15: "user between", 29: "worker last" }),
  );
  const identity = await tasks.identity(project);
  const checkpoint = randomUUID();
  const restore = await loop.prepareRewind(checkpoint, [first, second]);
  expect(restore.conflicts).toEqual([]);
  await loop.verifyPrepared(restore);
  await loop.execute(checkpoint, restore.id, "apply");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe(
    text({ 8: "user after", 15: "user between" }),
  );
  expect(await tasks.identity(project)).toBe(identity);
});
it("preflights an inverse transaction and refuses conflicting newer edits without writes", async () => {
  const w = await worker("rewind-conflict");
  await fs.writeFile(join(w.path, "file.txt"), "worker\n");
  const applied = await capture([w]);
  await loop.execute(task, applied.id, "apply");
  await fs.writeFile(join(project, "file.txt"), "user\n");
  const checkpoint = randomUUID();
  const restore = await loop.prepareRewind(checkpoint, [applied]);
  expect(restore.conflicts).toEqual([
    { path: "file.txt", reason: "Newer edits conflict with Undo" },
  ]);
  await expect(loop.execute(checkpoint, restore.id, "apply")).rejects.toThrow("cannot be applied");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe("user\n");
});
it("restores deleted files and removes created files through a restart-safe inverse journal", async () => {
  const w = await worker("rewind-created");
  const original = await fs.readFile(join(project, "file.txt"));
  await fs.rename(join(w.path, "file.txt"), join(w.path, "renamed.txt"));
  await fs.writeFile(join(w.path, "image.bin"), Buffer.from([255, 0, 123]));
  const applied = await capture([w]);
  await loop.execute(task, applied.id, "apply");
  const checkpoint = randomUUID();
  const restore = await loop.prepareRewind(checkpoint, [applied]);
  expect(restore.conflicts).toEqual([]);
  loop = new TaskLoop(project, join(root, "tasks"), tasks);
  await loop.execute(checkpoint, restore.id, "apply");
  expect(await fs.readFile(join(project, "file.txt"))).toEqual(original);
  await expect(fs.access(join(project, "renamed.txt"))).rejects.toThrow();
  await expect(fs.access(join(project, "image.bin"))).rejects.toThrow();
});
it("detects an intervening edit after the multi-target preflight was prepared", async () => {
  const w = await worker("rewind-preflight");
  await fs.writeFile(join(w.path, "file.txt"), "worker\n");
  const applied = await capture([w]);
  await loop.execute(task, applied.id, "apply");
  const checkpoint = randomUUID();
  const restore = await loop.prepareRewind(checkpoint, [applied]);
  await fs.writeFile(join(project, "file.txt"), "newer\n");
  await expect(loop.verifyPrepared(restore)).rejects.toThrow("Newer edits prevent Undo");
  await expect(loop.execute(checkpoint, restore.id, "apply")).rejects.toThrow("changed");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe("newer\n");
});
it("combines disjoint edits and rejects conflicting edits without writes", async () => {
  const a = await worker("a");
  const b = await worker("b");
  await fs.writeFile(join(a.path, "file.txt"), "FIRST\nsecond\nthird\nfourth\nfifth\n");
  await fs.writeFile(join(b.path, "file.txt"), "first\nsecond\nthird\nfourth\nFIFTH\n");
  const proposal = await capture([a, b]);
  expect(proposal.conflicts).toEqual([]);
  await loop.execute(task, proposal.id, "apply");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe(
    "FIRST\nsecond\nthird\nfourth\nFIFTH\n",
  );
  await fs.writeFile(join(a.path, "file.txt"), "worker overwrite\n");
  await fs.writeFile(join(project, "file.txt"), "user edit\n");
  const conflicting = await capture([a]);
  expect(conflicting.conflicts.length).toBeGreaterThan(0);
  await expect(loop.execute(task, conflicting.id, "apply")).rejects.toThrow();
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe("user edit\n");
});
it("refuses stale previews and Undo after intervening edits", async () => {
  const w = await worker("stale");
  await fs.writeFile(join(w.path, "file.txt"), "result\n");
  const proposal = await capture([w]);
  await fs.writeFile(join(project, "file.txt"), "later edit\n");
  await expect(loop.execute(task, proposal.id, "apply")).rejects.toThrow("Project changed");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe("later edit\n");
});
it("rolls back an interrupted multi-file write and allows a fresh proposal", async () => {
  const w = await worker("rollback");
  await fs.writeFile(join(w.path, "file.txt"), "result\n");
  await fs.writeFile(join(w.path, "other.txt"), "new\n");
  const proposal = await capture([w]);
  const abort = new AbortController();
  const io = {
    ...fs,
    rename: async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
      await fs.rename(from, to);
      if (to === join(project, "file.txt")) abort.abort(new Error("Cancelled"));
    },
  };
  const cancellable = new TaskLoop(project, join(root, "tasks"), tasks, io);
  await expect(cancellable.execute(task, proposal.id, "apply", abort.signal)).rejects.toThrow(
    "Cancelled",
  );
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toContain("first\n");
  await expect(fs.access(join(project, "other.txt"))).rejects.toThrow();
  expect((await capture([w])).conflicts).toEqual([]);
});

it("revalidates turn authority after awaited file preparation before any checkout replacement", async () => {
  const w = await worker("stale-turn");
  await fs.writeFile(join(w.path, "file.txt"), "result\n");
  const proposal = await capture([w]);
  const target = join(project, "file.txt");
  const before = await fs.readFile(target);
  const index = await fs.readFile(join(project, ".git", "index"));
  const head = command(project, "rev-parse", "HEAD");
  let current = true;
  let replacements = 0;
  const guarded = new TaskLoop(project, join(root, "tasks"), tasks, {
    ...fs,
    open: async (...args) => {
      const handle = await fs.open(...args);
      if (String(args[0]).startsWith(join(project, ".code60-"))) current = false;
      return handle;
    },
    rename: async (from, to) => {
      if (to === target) replacements++;
      await fs.rename(from, to);
    },
  });
  await expect(
    guarded.execute(task, proposal.id, "apply", undefined, () => {
      if (!current) throw new Error("Worker turn changed");
    }),
  ).rejects.toThrow("Worker turn changed");
  expect(replacements).toBe(0);
  expect(await fs.readFile(target)).toEqual(before);
  expect(await fs.readFile(join(project, ".git", "index"))).toEqual(index);
  expect(command(project, "rev-parse", "HEAD")).toBe(head);
  expect(await guarded.pendingOperation(task)).toBeNull();
});

it("preserves private file modes, renames, deletions and binary contents through Undo", async () => {
  if (process.platform !== "win32") await fs.chmod(join(project, "file.txt"), 0o600);
  const w = await worker("files");
  await fs.rename(join(w.path, "file.txt"), join(w.path, "renamed.txt"));
  await fs.writeFile(join(w.path, "image.bin"), Buffer.from([0, 128, 255]));
  const proposal = await capture([w]);
  await loop.execute(task, proposal.id, "apply");
  await expect(fs.access(join(project, "file.txt"))).rejects.toThrow();
  expect(await fs.readFile(join(project, "image.bin"))).toEqual(Buffer.from([0, 128, 255]));
  if (process.platform !== "win32")
    expect((await fs.stat(join(project, "renamed.txt"))).mode & 0o777).toBe(0o600);
  await loop.execute(task, proposal.id, "undo");
  if (process.platform !== "win32")
    expect((await fs.stat(join(project, "file.txt"))).mode & 0o777).toBe(0o600);
  await expect(fs.access(join(project, "renamed.txt"))).rejects.toThrow();
});

it("preserves later edits when Undo is refused", async () => {
  const w = await worker("undo-edits");
  await fs.writeFile(join(w.path, "file.txt"), "result\n");
  const proposal = await capture([w]);
  await loop.execute(task, proposal.id, "apply");
  await fs.writeFile(join(project, "file.txt"), "new user work\n");
  await expect(loop.execute(task, proposal.id, "undo")).rejects.toThrow("Project changed");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe("new user work\n");
});

it("recovers a persisted partial operation after restart", async () => {
  const w = await worker("recovery");
  await fs.writeFile(join(w.path, "file.txt"), "result\n");
  const proposal = await capture([w]);
  const file = proposal.changes[0];
  if (!file?.after) throw new Error("Missing proposal");
  // Simulate the persisted boundary immediately after the first file replacement.
  proposal.status = "applying";
  proposal.direction = "apply";
  await fs.writeFile(join(root, "tasks", `${proposal.id}.op`), JSON.stringify(proposal));
  await fs.writeFile(join(project, file.path), Buffer.from(file.after.data, "base64"));
  loop = new TaskLoop(project, join(root, "tasks"), tasks);
  await loop.execute(task, proposal.id, "recover");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toContain("first\n");
  expect((await loop.proposal(task, proposal.id)).status).toBe("failed");
});

it("retains newer files on incomplete recovery and prevents another application", async () => {
  const w = await worker("external-recovery");
  await fs.writeFile(join(w.path, "file.txt"), "result\n");
  const proposal = await capture([w]);
  proposal.status = "applying";
  proposal.direction = "apply";
  await fs.writeFile(join(root, "tasks", `${proposal.id}.op`), JSON.stringify(proposal));
  await fs.writeFile(join(project, "file.txt"), "external work\n");
  await expect(loop.execute(task, proposal.id, "recover")).rejects.toThrow(
    "newer edits were preserved",
  );
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe("external work\n");
  expect((await loop.pendingOperation(task))?.id).toBe(proposal.id);
  await expect(capture([w])).rejects.toThrow("Recover");
});

it("rejects changed symlinks and symlinked project targets", async () => {
  if (process.platform === "win32") return;
  const w = await worker("links");
  await fs.symlink("file.txt", join(w.path, "link.txt"));
  expect((await capture([w])).conflicts[0]?.reason).toContain("symlinks");
  await fs.unlink(join(w.path, "link.txt"));
  await fs.writeFile(join(w.path, "file.txt"), "result\n");
  const outside = join(root, "outside.txt");
  await fs.writeFile(outside, "preserve\n");
  await fs.unlink(join(project, "file.txt"));
  await fs.symlink(outside, join(project, "file.txt"));
  expect((await capture([w])).conflicts.length).toBeGreaterThan(0);
  expect(await fs.readFile(outside, "utf8")).toBe("preserve\n");
});

it("rejects a project file replaced after its handle opens", async () => {
  const w = await worker("swapped-target");
  await fs.writeFile(join(w.path, "file.txt"), "worker result\n");
  const target = join(project, "file.txt");
  const original = join(project, "original.txt");
  loop = new TaskLoop(project, join(root, "tasks"), tasks, {
    ...fs,
    open: async (...args) => {
      const handle = await fs.open(...args);
      if (args[0] === target) {
        try {
          await fs.rename(target, original);
          await fs.writeFile(target, "replacement\n");
        } catch (cause) {
          await handle.close();
          throw cause;
        }
      }
      return handle;
    },
  });
  const proposal = await capture([w]);
  expect(proposal.changes).toEqual([]);
  expect(proposal.conflicts).toEqual([
    { path: "file.txt", reason: "Project file changed while opening" },
  ]);
  expect(await fs.readFile(target, "utf8")).toBe("replacement\n");
  expect(await fs.readFile(original, "utf8")).toContain("first\n");
});

it("serializes competing applications with a checkout lock", async () => {
  const w = await worker("concurrent");
  await fs.writeFile(join(w.path, "file.txt"), "result\n");
  const proposal = await capture([w]);
  const second = await capture([w]);
  let entered!: () => void;
  let resume!: () => void;
  const writing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const paused = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const writer = new TaskLoop(project, join(root, "tasks"), tasks, {
    ...fs,
    rename: async (from, to) => {
      if (to === join(project, "file.txt")) {
        entered();
        await paused;
      }
      await fs.rename(from, to);
    },
  });
  const applying = writer.execute(task, proposal.id, "apply");
  try {
    await writing;
    const other = new TaskLoop(project, join(root, "tasks"), tasks);
    await expect(other.execute(task, second.id, "apply")).rejects.toThrow("owns this project");
  } finally {
    resume();
    await applying;
  }
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe("result\n");
});

it("accepts a worker correction against the conflict context explicitly sent for revision", async () => {
  const w = await worker("revise-conflict");
  await fs.writeFile(join(w.path, "file.txt"), "worker overwrite\n");
  await fs.writeFile(join(project, "file.txt"), "user edit\n");
  const conflict = await capture([w]);
  expect(conflict.conflicts).toHaveLength(1);
  await loop.requestRevision(task, conflict.id);
  expect((await capture([w])).conflicts).toHaveLength(1);
  await fs.writeFile(join(w.path, "file.txt"), "user edit\nworker correction\n");
  const corrected = await capture([w]);
  expect(corrected.conflicts).toEqual([]);
  await loop.execute(task, corrected.id, "apply");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe(
    "user edit\nworker correction\n",
  );
  await loop.execute(task, corrected.id, "undo");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe("user edit\n");
});

it("preserves checkout line endings during apply and Undo", async () => {
  command(project, "config", "core.autocrlf", "true");
  await fs.writeFile(join(project, "file.txt"), "first\r\nsecond\r\nthird\r\nfourth\r\nfifth\r\n");
  const w = await worker("crlf");
  await fs.writeFile(join(w.path, "file.txt"), "worker result\r\n");
  const proposal = await capture([w]);
  expect(proposal.conflicts).toEqual([]);
  await loop.execute(task, proposal.id, "apply");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe("worker result\r\n");
  await loop.execute(task, proposal.id, "undo");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toContain("first\r\nsecond\r\n");
});

it("applies and undoes worker edits in an LF checkout with autocrlf enabled", async () => {
  command(project, "config", "core.autocrlf", "true");
  const before = await fs.readFile(join(project, "file.txt"), "utf8");
  const identity = await tasks.identity(project);
  const w = await worker("lf-checkout");
  await fs.writeFile(join(w.path, "file.txt"), "worker result\r\n");
  const proposal = await capture([w]);
  expect(proposal.conflicts).toEqual([]);
  await loop.execute(task, proposal.id, "apply");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe("worker result\n");
  await loop.execute(task, proposal.id, "undo");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe(before);
  expect(await tasks.identity(project)).toBe(identity);
});

it("merges independent LF checkout edits with autocrlf enabled but rejects overlaps", async () => {
  command(project, "config", "core.autocrlf", "true");
  const w = await worker("lf-merge");
  await fs.writeFile(join(w.path, "file.txt"), "worker\r\nsecond\r\nthird\r\nfourth\r\nfifth\r\n");
  const before = "first\nsecond\nthird\nfourth\nuser\n";
  await fs.writeFile(join(project, "file.txt"), before);
  const proposal = await capture([w]);
  expect(proposal.conflicts).toEqual([]);
  await loop.execute(task, proposal.id, "apply");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe(
    "worker\nsecond\nthird\nfourth\nuser\n",
  );
  await loop.execute(task, proposal.id, "undo");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe(before);
  await fs.writeFile(join(project, "file.txt"), "user\nsecond\nthird\nfourth\nfifth\n");
  expect((await capture([w])).conflicts).toHaveLength(1);
});

it("rejects a line-ending change after preparing an LF checkout application", async () => {
  command(project, "config", "core.autocrlf", "true");
  const w = await worker("lf-guard");
  await fs.writeFile(join(w.path, "file.txt"), "worker result\r\n");
  const proposal = await capture([w]);
  expect(proposal.conflicts).toEqual([]);
  const changed = "first\r\nsecond\r\nthird\r\nfourth\r\nfifth\r\n";
  await fs.writeFile(join(project, "file.txt"), changed);
  await expect(loop.execute(task, proposal.id, "apply")).rejects.toThrow("Project changed");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe(changed);
});

it("does not normalize bytes when Git attributes disable text conversion", async () => {
  command(project, "config", "core.autocrlf", "true");
  await fs.writeFile(join(project, ".gitattributes"), "file.txt -text\n");
  const w = await worker("no-text-conversion");
  await fs.writeFile(join(w.path, "file.txt"), "worker result\r\n");
  const proposal = await capture([w]);
  expect(proposal.conflicts).toEqual([]);
  await loop.execute(task, proposal.id, "apply");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe("worker result\r\n");
  await loop.execute(task, proposal.id, "undo");
  expect(await fs.readFile(join(project, "file.txt"), "utf8")).toBe(
    "first\nsecond\nthird\nfourth\nfifth\n",
  );
});
