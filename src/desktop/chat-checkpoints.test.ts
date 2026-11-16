import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultDeps, TaskLoop } from "../core/index.js";
import { ChatCheckpoints } from "./chat-checkpoints.js";

// Match TaskLoop's real-Git allowance, including native private writes on Windows.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const git = defaultDeps().git;
const tasks = git.tasks;
if (!tasks) throw new Error("Task Git unavailable");
const taskGit = tasks;
let root: string;
let checkpoints: ChatCheckpoints;
let nextWorker = 0;
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
  root = await realpath(await mkdtemp(join(tmpdir(), "code60-checkpoints-")));
  checkpoints = await ChatCheckpoints.open(join(root, "checkpoints"), taskGit);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function project(name: string) {
  const directory = join(root, name);
  await mkdir(directory);
  command(directory, "init", "-q");
  command(directory, "config", "core.autocrlf", "false");
  command(directory, "config", "user.name", "Test");
  command(directory, "config", "user.email", "test@example.invalid");
  await writeFile(join(directory, "file.txt"), "before\n");
  command(directory, "add", ".");
  command(directory, "commit", "-qm", "baseline");
  return directory;
}
const begin = () =>
  checkpoints.begin({
    runId: "chat",
    turn: 1,
    text: "Change the files",
    before: 4,
    taskCount: 0,
  });
async function associate(id: string, store = checkpoints) {
  await store.integrate(
    new TaskLoop(root, join(root, "associations"), taskGit),
    async () => ({
      format: 1,
      id: randomUUID(),
      taskId: randomUUID(),
      revisionId: id,
      identity: "",
      status: "prepared",
      changes: [],
      conflicts: [],
      sources: [],
      previousSources: [],
    }),
    () => {},
  );
}
it("retains bounded request associations across checkpoints and reopening", async () => {
  await begin();
  const firstSource = randomUUID();
  await associate(firstSource);
  await checkpoints.begin({ runId: "chat", turn: 2, text: "Next", before: 8, taskCount: 1 });
  const nextSource = randomUUID();
  await associate(nextSource);
  await associate(firstSource);
  checkpoints = await ChatCheckpoints.open(checkpoints.root, taskGit);
  expect(checkpoints.requestForSource(firstSource)).toEqual({ chatId: "chat", turn: 1 });
  expect(checkpoints.requestForSource(nextSource)).toEqual({ chatId: "chat", turn: 2 });
  expect(checkpoints.requestForSource(randomUUID())).toBeUndefined();
});
it("retains the original saved-code references through reopening and conversation-only Undo", async () => {
  const references = [
    {
      reviewId: randomUUID(),
      revisionId: randomUUID(),
      fileKey: "worker:file.ts",
      side: "original" as const,
      start: 2,
      end: 4,
    },
  ];
  const id = await checkpoints.begin({
    runId: "chat",
    turn: 1,
    text: "Original correction",
    references,
    before: 0,
    taskCount: 0,
  });
  checkpoints = await ChatCheckpoints.open(checkpoints.root, taskGit);
  expect((await checkpoints.restore(id, 2)).references).toEqual(references);
});
it("persists worker rewind boundaries before execution ownership can be forgotten", async () => {
  const id = await checkpoints.begin({
    runId: "chat",
    turn: 3,
    text: "Undo this worker request",
    before: 10,
    taskCount: 1,
    workers: [{ runId: "surviving-worker", turn: 2 }],
  });
  await checkpoints.retainWorkers(id, ["surviving-worker", "new-worker"]);
  checkpoints = await ChatCheckpoints.open(checkpoints.root, taskGit);
  await checkpoints.restore(id, 20);
  checkpoints = await ChatCheckpoints.open(checkpoints.root, taskGit);
  expect(checkpoints.pendingRewind).toBe(true);
  expect(checkpoints.undoTarget?.workers).toEqual([
    { runId: "surviving-worker", turn: 2 },
    { runId: "new-worker", turn: 0 },
  ]);
});
it("counts unchanged direct contents toward the combined current-folder Undo bound", async () => {
  const second = join(root, "large-b");
  const targets = [join(root, "large-a"), second];
  for (const target of targets) {
    await mkdir(target);
    await writeFile(join(target, "large.bin"), Buffer.alloc(16_777_216, 1));
  }
  const id = await checkpoints.begin({
    runId: "chat",
    turn: 1,
    text: "Bounded targets",
    before: 0,
    taskCount: 0,
    directProjects: targets,
  });
  await writeFile(join(second, "extra.txt"), "x");
  await expect(checkpoints.restore(id, 1)).rejects.toThrow("32 MiB");
  expect(checkpoints.latest?.phase).toBe("active");
  expect(await readFile(join(second, "extra.txt"), "utf8")).toBe("x");
}, 10_000);
it("deduplicates direct preimages, survives restart without Git and restores repeated request boundaries", async () => {
  const directory = join(root, "plain");
  await mkdir(directory);
  await writeFile(join(directory, "file.txt"), "original");
  await writeFile(join(directory, "stable.bin"), Buffer.alloc(1_048_576, 7));
  checkpoints = await ChatCheckpoints.open(join(root, "plain-checkpoints"));
  const first = await begin();
  await checkpoints.coverDirect(directory, () => {});
  expect(checkpoints.latest?.direct[0]?.bytes).toBeGreaterThan(1_048_576);
  await writeFile(join(directory, "file.txt"), "after first request");
  const second = await checkpoints.begin({
    runId: "chat",
    turn: 2,
    text: "Second",
    before: 8,
    taskCount: 1,
    directProjects: [directory],
  });
  expect(checkpoints.latest?.direct[0]?.bytes).toBeLessThan(1024);
  await writeFile(join(directory, "file.txt"), "after second request");
  checkpoints = await ChatCheckpoints.open(checkpoints.root);
  expect(await readFile(join(directory, "file.txt"), "utf8")).toBe("after second request");
  await checkpoints.restore(second, 12);
  await checkpoints.complete(second);
  expect(await readFile(join(directory, "file.txt"), "utf8")).toBe("after first request");
  expect(checkpoints.undoTarget?.id).toBe(first);
  await checkpoints.restore(first, 12);
  expect(await readFile(join(directory, "file.txt"), "utf8")).toBe("original");
});
it.each([false, true])(
  "consolidates nested isolated inverses with direct coverage enrolled after earlier writes: %s",
  async (earlier) => {
    const parent = join(root, "parent");
    await mkdir(parent);
    const child = await project("parent/child");
    const head = command(child, "rev-parse", "HEAD");
    const index = await readFile(join(child, ".git", "index"));
    const id = await begin();
    if (earlier) {
      const { loop, operation } = await proposal(child, "earlier isolated\n");
      await checkpoints.integrate(
        loop,
        async () => operation,
        () => {},
      );
    }
    await checkpoints.coverDirect(parent, () => {});
    const { loop, operation } = await proposal(child, "later isolated\n");
    await checkpoints.integrate(
      loop,
      async () => operation,
      () => {},
    );
    await writeFile(join(parent, "manual.txt"), "manual edits are covered too");
    checkpoints = await ChatCheckpoints.open(checkpoints.root, taskGit);
    await checkpoints.restore(id, 12);
    expect(checkpoints.latest?.restores).toHaveLength(1);
    expect(await readFile(join(child, "file.txt"), "utf8")).toBe("before\n");
    await expect(readFile(join(parent, "manual.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(command(child, "rev-parse", "HEAD")).toBe(head);
    expect(await readFile(join(child, ".git", "index"))).toEqual(index);
  },
);

it.each(["prepared", "applied"] as const)(
  "recovers an inverse lock retained around its %s status write",
  async (status) => {
    const directory = await project("locked");
    const id = await begin();
    const { loop, operation } = await proposal(directory, "after\n");
    await checkpoints.integrate(
      loop,
      async () => operation,
      () => {},
    );
    const interrupt = vi
      .spyOn(TaskLoop.prototype, "execute")
      .mockRejectedValueOnce(new Error("Stopped before inverse execution"));
    await expect(checkpoints.restore(id, 12)).rejects.toThrow("Stopped");
    interrupt.mockRestore();
    const entry = checkpoints.latest?.restores[0];
    if (!entry) throw new Error("Missing inverse");
    const inverseLoop = new TaskLoop(entry.project, entry.root, taskGit);
    const inverse = await inverseLoop.proposal(entry.taskId, entry.operationId);
    inverse.status = status;
    if (status === "applied") await writeFile(join(directory, "file.txt"), "before\n");
    await writeFile(join(entry.root, `${inverse.id}.op`), JSON.stringify(inverse));
    await writeFile(
      await taskGit.lockPath(directory),
      JSON.stringify({
        pid: process.pid,
        taskId: id,
        operation: inverse.id,
        root: createHash("sha256").update(entry.root).digest("hex"),
      }),
    );
    checkpoints = await ChatCheckpoints.open(checkpoints.root, taskGit);
    await checkpoints.restore(id, 12);
    expect(await readFile(join(directory, "file.txt"), "utf8")).toBe("before\n");
    expect(await inverseLoop.pendingOperation(id)).toBeNull();
    await checkpoints.complete(id);
    await begin();
  },
);

it("preflights mixed direct and isolated targets before restoring either", async () => {
  const a = await project("direct"),
    b = await project("isolated");
  const id = await begin();
  await checkpoints.coverDirect(a, () => {});
  await writeFile(join(a, "file.txt"), "direct result");
  const { loop, operation } = await proposal(b, "isolated result");
  await checkpoints.integrate(
    loop,
    async () => operation,
    () => {},
  );
  await writeFile(join(b, "file.txt"), "conflicting manual change");
  await expect(checkpoints.restore(id, 12)).rejects.toThrow("blocked");
  expect(await readFile(join(a, "file.txt"), "utf8")).toBe("direct result");
  expect(await readFile(join(b, "file.txt"), "utf8")).toBe("conflicting manual change");
  await writeFile(join(b, "file.txt"), "isolated result");
  await checkpoints.restore(id, 12);
  for (const directory of [a, b])
    expect(await readFile(join(directory, "file.txt"), "utf8")).toBe("before\n");
});
it("deduplicates covered nested targets and refuses a late parent before editable launch", async () => {
  const parent = join(root, "nested-parent"),
    child = join(parent, "child");
  await mkdir(child, { recursive: true });
  await writeFile(join(child, "file.txt"), "before");
  const id = await checkpoints.begin({
    runId: "chat",
    turn: 1,
    text: "Nested targets",
    before: 0,
    taskCount: 0,
    directProjects: [child, parent],
  });
  expect(checkpoints.latest?.direct.map((entry) => entry.project)).toEqual([parent]);
  await checkpoints.coverDirect(child, () => {});
  expect(checkpoints.latest?.direct).toHaveLength(1);
  await writeFile(join(child, "file.txt"), "after");
  await checkpoints.restore(id, 1);
  await checkpoints.complete(id);
  await begin();
  await checkpoints.coverDirect(child, () => {});
  await expect(checkpoints.coverDirect(parent, () => {})).rejects.toThrow("Cannot enlarge");
  expect(checkpoints.latest?.direct.map((entry) => entry.project)).toEqual([child]);
  expect(await readFile(join(child, "file.txt"), "utf8")).toBe("before");
});
it("requires explicit restart recovery after a mixed folder and Git restore is interrupted", async () => {
  const a = join(root, "plain");
  await mkdir(a);
  await writeFile(join(a, "file.txt"), "before\n");
  const b = await project("isolated");
  const id = await begin();
  await checkpoints.coverDirect(a, () => {});
  await writeFile(join(a, "file.txt"), "direct result");
  const { loop, operation } = await proposal(b, "isolated result");
  await checkpoints.integrate(
    loop,
    async () => operation,
    () => {},
  );
  const execute = TaskLoop.prototype.execute;
  const interrupt = vi.spyOn(TaskLoop.prototype, "execute").mockImplementation(function (
    this: TaskLoop,
    ...args
  ) {
    if (this.project === a && this.root.startsWith(checkpoints.root))
      return Promise.reject(new Error("Interrupted folder restore"));
    return execute.apply(this, args);
  });
  await expect(checkpoints.restore(id, 12)).rejects.toThrow("Interrupted folder restore");
  interrupt.mockRestore();
  expect(await readFile(join(a, "file.txt"), "utf8")).toBe("direct result");
  expect(await readFile(join(b, "file.txt"), "utf8")).toBe("before\n");
  checkpoints = await ChatCheckpoints.open(checkpoints.root, taskGit);
  expect(checkpoints.latest?.phase).toBe("undoing");
  expect(await readFile(join(a, "file.txt"), "utf8")).toBe("direct result");
  await expect(begin()).rejects.toThrow("interrupted Undo");
  await checkpoints.restore(id, 12);
  await checkpoints.complete(id);
  expect(await readFile(join(a, "file.txt"), "utf8")).toBe("before\n");
});
async function proposal(directory: string, text: string) {
  const id = randomUUID();
  const loop = new TaskLoop(directory, join(root, randomUUID()), taskGit);
  const base = await loop.baseline(id);
  const worker = join(root, `worker-${++nextWorker}`);
  await git.addWorktree({
    repoDir: directory,
    path: worker,
    branch: `code60/worker-${nextWorker}`,
    base,
  });
  await writeFile(join(worker, "file.txt"), text);
  const operation = await loop.prepare(id, randomUUID(), [
    {
      runId: `worker-${nextWorker}`,
      base,
      commit: await taskGit.snapshot(worker),
    },
  ]);
  return { loop, operation };
}
it("persists a zero-edit checkpoint and rewinds its transcript/source boundary idempotently", async () => {
  const id = await begin();
  const source = randomUUID();
  await associate(source);
  checkpoints = await ChatCheckpoints.open(checkpoints.root, taskGit);
  const restored = await checkpoints.restore(id, 12);
  expect(restored).toMatchObject({ phase: "restored", text: "Change the files" });
  expect(checkpoints.hidden.has(source)).toBe(true);
  expect(checkpoints.visible("chat", 3)).toBe(true);
  expect(checkpoints.visible("chat", 4)).toBe(false);
  expect(checkpoints.visible("chat", 12)).toBe(true);
  expect(checkpoints.visible("another-chat", 4)).toBe(true);
  await expect(checkpoints.restore(id, 20)).resolves.toEqual(restored);
  await expect(associate(randomUUID())).rejects.toThrow("no longer writable");
  expect(checkpoints.latest?.sources).toEqual([source]);
});
it("automatically integrates and restores two targets without changing their indexes or HEADs", async () => {
  const a = await project("a"),
    b = await project("b");
  const identity = [await taskGit.identity(a), await taskGit.identity(b)];
  const id = await begin();
  for (const directory of [a, b]) {
    const { loop, operation } = await proposal(directory, "after\n");
    await checkpoints.integrate(
      loop,
      async () => operation,
      () => {},
    );
    expect(await readFile(join(directory, "file.txt"), "utf8")).toBe("after\n");
  }
  checkpoints = await ChatCheckpoints.open(checkpoints.root, taskGit);
  await checkpoints.restore(id, 12);
  for (const [index, directory] of [a, b].entries()) {
    expect(await readFile(join(directory, "file.txt"), "utf8")).toBe("before\n");
    expect(await taskGit.identity(directory)).toBe(identity[index]);
  }
});
it("preflights all targets and preserves both if one has conflicting newer edits", async () => {
  const a = await project("a"),
    b = await project("b");
  const id = await begin();
  for (const directory of [a, b]) {
    const { loop, operation } = await proposal(directory, "after\n");
    await checkpoints.integrate(
      loop,
      async () => operation,
      () => {},
    );
  }
  await writeFile(join(b, "file.txt"), "manual edit\n");
  await expect(checkpoints.restore(id, 12)).rejects.toThrow("newer edits");
  expect(await readFile(join(a, "file.txt"), "utf8")).toBe("after\n");
  expect(await readFile(join(b, "file.txt"), "utf8")).toBe("manual edit\n");
  expect(checkpoints.latest?.phase).toBe("active");
});
it("keeps durable intent when integration fails and never treats an unexecuted proposal as edits", async () => {
  const directory = await project("a");
  const id = await begin();
  const { loop, operation } = await proposal(directory, "after\n");
  vi.spyOn(loop, "execute").mockRejectedValueOnce(new Error("Synthetic interrupted integration"));
  await expect(
    checkpoints.integrate(
      loop,
      async () => operation,
      () => {},
    ),
  ).rejects.toThrow("interrupted");
  checkpoints = await ChatCheckpoints.open(checkpoints.root, taskGit);
  expect(checkpoints.latest?.operations).toHaveLength(1);
  await checkpoints.restore(id, 12);
  expect(await readFile(join(directory, "file.txt"), "utf8")).toBe("before\n");
});
it("charges prepared journals durably even when authority expires before integration", async () => {
  const directory = await project("quota");
  await begin();
  const { loop, operation } = await proposal(directory, "after\n");
  const valid = vi
    .fn()
    .mockImplementationOnce(() => {})
    .mockImplementation(() => {
      throw new Error("Expired authority");
    });
  await expect(
    checkpoints.integrate(
      loop,
      (available, reserve) =>
        loop.prepare(
          operation.taskId,
          operation.revisionId,
          operation.sources,
          undefined,
          available,
          reserve,
        ),
      valid,
    ),
  ).rejects.toThrow("Expired authority");
  const saved = JSON.parse(await readFile(join(checkpoints.root, "state.json"), "utf8"));
  expect(saved.recordedBytes).toBeGreaterThan(Buffer.byteLength(JSON.stringify(operation)));
  checkpoints = await ChatCheckpoints.open(checkpoints.root, taskGit);
  expect(checkpoints.latest?.operations).toEqual([]);
  expect(await readFile(join(directory, "file.txt"), "utf8")).toBe("before\n");
});
it("rejects changed metadata rather than overwriting a successor's checkpoint", async () => {
  const stale = await ChatCheckpoints.open(checkpoints.root, taskGit);
  const id = await begin();
  await expect(
    stale.begin({ runId: "chat", turn: 2, text: "stale", before: 10, taskCount: 0 }),
  ).rejects.toThrow("already exists");
  const current = await ChatCheckpoints.open(checkpoints.root, taskGit);
  expect(current.latest?.id).toBe(id);
  await associate(randomUUID());
  await expect(associate(randomUUID(), current)).rejects.toThrow("metadata changed");
});
it("rejects stale restoration requests and late integration after restoration", async () => {
  const directory = await project("a");
  const id = await begin();
  const { loop, operation } = await proposal(directory, "after\n");
  await expect(checkpoints.restore(randomUUID(), 12)).rejects.toThrow("no longer the latest");
  await checkpoints.restore(id, 12);
  await expect(
    checkpoints.integrate(
      loop,
      async () => operation,
      () => {},
    ),
  ).rejects.toThrow("no longer writable");
  expect(await readFile(join(directory, "file.txt"), "utf8")).toBe("before\n");
});
it("binds a capture crossing a new Send to the latest checkpoint at actual integration", async () => {
  const directory = await project("a");
  await begin();
  const { loop, operation } = await proposal(directory, "after\n");
  const latest = await checkpoints.begin({
    runId: "chat",
    turn: 2,
    text: "Next request",
    before: 10,
    taskCount: 1,
  });
  await checkpoints.integrate(
    loop,
    async () => operation,
    () => {},
  );
  expect(checkpoints.latest?.id).toBe(latest);
  expect(checkpoints.requestForSource(operation.revisionId)).toEqual({ chatId: "chat", turn: 2 });
  expect(await readFile(join(directory, "file.txt"), "utf8")).toBe("after\n");
});
it("rejects an exhausted journal budget before another preparation or checkout write", async () => {
  const directory = await project("a");
  await begin();
  const { loop, operation } = await proposal(directory, "after\n");
  const path = join(checkpoints.root, "state.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...saved, recordedBytes: 268_435_456 }));
  checkpoints = await ChatCheckpoints.open(checkpoints.root, taskGit);
  const prepare = vi.fn().mockResolvedValue(operation);
  await expect(checkpoints.integrate(loop, prepare, () => {})).rejects.toThrow("256 MiB");
  expect(prepare).not.toHaveBeenCalled();
  expect(await readFile(join(directory, "file.txt"), "utf8")).toBe("before\n");
});
it("requires explicit completion after file restoration and permits repeated message Undo", async () => {
  const first = await begin();
  const second = await checkpoints.begin({
    runId: "chat",
    turn: 2,
    text: "Second request",
    before: 10,
    taskCount: 1,
  });
  await checkpoints.restore(second, 20);
  checkpoints = await ChatCheckpoints.open(checkpoints.root, taskGit);
  expect(checkpoints.pendingRewind).toBe(true);
  expect(checkpoints.undoTarget?.id).toBe(second);
  await expect(begin()).rejects.toThrow("interrupted Undo");
  await checkpoints.complete(second);
  expect(checkpoints.undoTarget?.id).toBe(first);
  await checkpoints.restore(first, 20);
  expect(checkpoints.visible("chat", 4)).toBe(false);
  await checkpoints.complete(first);
  expect(checkpoints.undoTarget).toBeNull();
});
it("pins native checkout identities and refuses replacement even when the file bytes match", async () => {
  const directory = await project("a");
  const id = await begin();
  const { loop, operation } = await proposal(directory, "after\n");
  await checkpoints.integrate(
    loop,
    async () => operation,
    () => {},
  );
  await rename(directory, `${directory}-saved`);
  await mkdir(directory);
  await writeFile(join(directory, "file.txt"), "after\n");
  await expect(checkpoints.restore(id, 12)).rejects.toThrow("replaced");
  expect(await readFile(join(directory, "file.txt"), "utf8")).toBe("after\n");
  expect(await readFile(join(`${directory}-saved`, "file.txt"), "utf8")).toBe("after\n");
});
it("persists a half-finished multi-target restore and resumes explicitly without replaying finished writes", async () => {
  const a = await project("a"),
    b = await project("b");
  const id = await begin();
  for (const directory of [a, b]) {
    const { loop, operation } = await proposal(directory, "after\n");
    await checkpoints.integrate(
      loop,
      async () => operation,
      () => {},
    );
  }
  const execute = TaskLoop.prototype.execute;
  const interrupt = vi.spyOn(TaskLoop.prototype, "execute").mockImplementation(function (
    this: TaskLoop,
    ...args
  ) {
    if (this.project === b && this.root.startsWith(checkpoints.root))
      return Promise.reject(new Error("Synthetic interruption"));
    return execute.apply(this, args);
  });
  await expect(checkpoints.restore(id, 12)).rejects.toThrow("interruption");
  interrupt.mockRestore();
  expect(checkpoints.latest?.phase).toBe("undoing");
  expect(await readFile(join(a, "file.txt"), "utf8")).toBe("before\n");
  expect(await readFile(join(b, "file.txt"), "utf8")).toBe("after\n");
  checkpoints = await ChatCheckpoints.open(checkpoints.root, taskGit);
  await expect(begin()).rejects.toThrow("interrupted Undo");
  const completed = vi.spyOn(TaskLoop.prototype, "execute");
  await checkpoints.restore(id, 12);
  expect(
    completed.mock.contexts.filter((loop) => loop instanceof TaskLoop && loop.project === a),
  ).toHaveLength(0);
  completed.mockRestore();
  expect(await readFile(join(b, "file.txt"), "utf8")).toBe("before\n");
});
it("recovers a partially written inverse journal without overwriting newer files in another target", async () => {
  const a = await project("a"),
    b = await project("b");
  const id = await begin();
  for (const directory of [a, b]) {
    const { loop, operation } = await proposal(directory, "after\n");
    await checkpoints.integrate(
      loop,
      async () => operation,
      () => {},
    );
  }
  const interrupt = vi
    .spyOn(TaskLoop.prototype, "execute")
    .mockRejectedValueOnce(new Error("Stopped"));
  await expect(checkpoints.restore(id, 12)).rejects.toThrow("Stopped");
  interrupt.mockRestore();
  const entry = checkpoints.latest?.restores[0];
  if (!entry) throw new Error("Missing inverse intent");
  const loop = new TaskLoop(entry.project, entry.root, taskGit);
  const inverse = await loop.proposal(entry.taskId, entry.operationId);
  inverse.status = "applying";
  inverse.direction = "apply";
  await writeFile(join(entry.root, `${inverse.id}.op`), JSON.stringify(inverse));
  const change = inverse.changes[0];
  if (!change?.after) throw new Error("Missing inverse content");
  await writeFile(join(a, change.path), Buffer.from(change.after.data, "base64"));
  await writeFile(
    await taskGit.lockPath(a),
    JSON.stringify({
      pid: process.pid,
      taskId: id,
      operation: inverse.id,
      root: createHash("sha256").update(entry.root).digest("hex"),
    }),
  );
  await writeFile(join(b, "file.txt"), "newer manual edit\n");
  checkpoints = await ChatCheckpoints.open(checkpoints.root, taskGit);
  await expect(checkpoints.restore(id, 12)).rejects.toThrow("Newer edits");
  expect(await readFile(join(a, "file.txt"), "utf8")).toBe("before\n");
  expect(await readFile(join(b, "file.txt"), "utf8")).toBe("newer manual edit\n");
  await writeFile(join(b, "file.txt"), "after\n");
  await checkpoints.restore(id, 12);
  expect(await readFile(join(a, "file.txt"), "utf8")).toBe("before\n");
  expect(await readFile(join(b, "file.txt"), "utf8")).toBe("before\n");
}); // File default: sibling two-target restores took 15-19 s on Windows CI.
