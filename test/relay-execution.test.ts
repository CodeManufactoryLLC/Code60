import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, defaultDeps } from "../src/core/index.js";
import { ExecutionHost, type ExecutionOwner } from "../src/desktop/execution-host.js";
import { FakeAgents, FakeGit, FakeProcesses, flush } from "./fakes.js";
import { commitFixture } from "./fixtures/git-repository.js";

let root: string;
let agents: FakeAgents;
let git: FakeGit;
let host: ExecutionHost;
let allowed: boolean;
const owner: ExecutionOwner = { id: randomUUID(), generation: 1, taskId: randomUUID() };
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "code60-targets-")));
  await mkdir(join(root, "a"));
  await mkdir(join(root, "b"));
  agents = new FakeAgents();
  git = new FakeGit();
  git.repoInfo = async () => {
    throw new Error("not a repo");
  };
  allowed = true;
  host = new ExecutionHost(
    { ...defaultDeps(), agents, git, processes: new FakeProcesses() },
    { XDG_STATE_HOME: join(root, "state") },
    {
      authorize: () => {
        if (!allowed) throw new Error("Revoked");
      },
      event: () => {},
      changed: vi.fn(),
      warning: vi.fn(),
    },
  );
});
afterEach(async () => {
  await host.shutdown(true);
  await rm(root, { recursive: true, force: true });
});
const request = (cwd: string, requestId = "one") => ({
  cwd,
  requestId,
  workspaceMode: "direct" as const,
  provider: "claude",
  prompt: "task",
});
it("binds each worker's memory to its canonical subfolder target, not the Git root", async () => {
  git.repoInfo = async () => ({ topLevel: root, commonDir: join(root, ".git") });
  const memory = vi.fn(() => ({
    event: () => {},
    prepare: async () => ({ context: "", rollover: false, used: [] }),
    dispose: () => {},
  }));
  host = new ExecutionHost(
    { ...defaultDeps(), agents, git, processes: new FakeProcesses(), memory },
    { XDG_STATE_HOME: join(root, "state") },
    { authorize: () => {}, event: () => {}, changed: () => {}, warning: () => {} },
  );
  for (const folder of ["a", "b"])
    await host.dispatch(owner, request(join(root, folder), folder), DEFAULT_CONFIG);
  expect(memory.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
    join(root, "a"),
    join(root, "b"),
  ]);
  expect(host.list().every((worker) => worker.record.owner === "relay")).toBe(true);
});
it("runs an already queued Stop after a rejected target control", async () => {
  const worker = await host.dispatch(owner, request(join(root, "a")), DEFAULT_CONFIG);
  await vi.waitFor(() => expect(worker.orchestrator.runs()[0]?.status).toBe("idle"));
  const rejected = host.control(owner, worker.id, async () => {
    throw new Error("Worker busy");
  });
  const stopped = host.control(owner, worker.id, async (worker) => worker.orchestrator.shutdown());
  await expect(rejected).rejects.toThrow("Worker busy");
  await expect(stopped).resolves.toBeUndefined();
  expect(worker.orchestrator.runs()[0]?.status).toBe("finished");
});
it("resolves a symbolic base again for distinct dispatches but not accepted retries", async () => {
  let head = "a".repeat(40);
  git.repoInfo = async (cwd = root) => ({ topLevel: cwd, commonDir: join(cwd, ".git") });
  git.resolveCommit = async (_cwd, base) => (base === "HEAD" ? head : base);
  const req = { ...request(join(root, "a")), workspaceMode: "worktree" as const, base: "HEAD" };
  const first = await host.dispatch(owner, req, DEFAULT_CONFIG);
  head = "b".repeat(40);
  const second = await host.dispatch(owner, { ...req, requestId: "next" }, DEFAULT_CONFIG);
  expect(second.record.base).toBe(head);
  expect(await host.dispatch(owner, req, DEFAULT_CONFIG)).toBe(first);
  expect(first.record.base).toBe("a".repeat(40));
});
it("freezes current files by task and target while resolving explicit bases independently", async () => {
  const initial = "a".repeat(40);
  let current = "b".repeat(40);
  const snapshot = vi.fn(async () => current);
  git.repoInfo = async (cwd?: string) => ({ topLevel: cwd ?? root, commonDir: join(root, ".git") });
  git.resolveCommit = async (_cwd, base) => (base === "HEAD" ? initial : base);
  Object.assign(git, { tasks: { snapshot } });
  const config = { ...DEFAULT_CONFIG, maxParallel: 8 };
  const isolated = (cwd: string, id: string) => ({
    ...request(cwd, id),
    workspaceMode: "worktree" as const,
  });
  const [a, retry] = await Promise.all([
    host.dispatch(owner, isolated(join(root, "a"), "a"), config),
    host.dispatch(owner, isolated(join(root, "a"), "a-two"), config),
  ]);
  expect(a.record.base).toBe("b".repeat(40));
  expect(retry.record.base).toBe(a.record.base);
  expect(snapshot).toHaveBeenCalledTimes(1);
  current = "c".repeat(40);
  const later = await host.dispatch(owner, isolated(join(root, "a"), "a-later"), config);
  expect(later.record.base).toBe(a.record.base);
  const b = await host.dispatch(owner, isolated(join(root, "b"), "b"), config);
  expect(b.record.base).toBe(current);
  const human = await host.dispatch(
    { ...owner, taskId: randomUUID() },
    isolated(join(root, "a"), "human"),
    config,
  );
  expect(human.record.base).toBe(current);
  const explicit = await host.dispatch(
    owner,
    { ...isolated(join(root, "a"), "head"), base: "HEAD" },
    config,
  );
  expect(explicit.record.base).toBe(initial);
  const direct = await host.dispatch(owner, request(join(root, "a"), "direct"), config);
  expect(direct.record.base).toBeNull();
  expect(snapshot).toHaveBeenCalledTimes(3);
});
it("retries failed baseline capture without accepting or spawning a worker", async () => {
  git.repoInfo = async () => ({ topLevel: join(root, "a"), commonDir: join(root, ".git") });
  const snapshot = vi
    .fn()
    .mockRejectedValueOnce(new Error("Files changed during capture"))
    .mockResolvedValue("b".repeat(40));
  Object.assign(git, { tasks: { snapshot } });
  const req = { ...request(join(root, "a")), workspaceMode: "worktree" as const };
  await expect(host.dispatch(owner, req, DEFAULT_CONFIG)).rejects.toThrow("Files changed");
  expect(host.list()).toEqual([]);
  expect(agents.specs).toEqual([]);
  const accepted = await host.dispatch(owner, req, DEFAULT_CONFIG);
  expect(await host.dispatch(owner, req, DEFAULT_CONFIG)).toBe(accepted);
  expect(snapshot).toHaveBeenCalledTimes(2);
});
it("starts real worktrees from saved files without changing HEAD or staging", async () => {
  const target = join(root, "a");
  const command = (...args: string[]) =>
    execFileSync("git", args, { cwd: target, encoding: "utf8" }).trim();
  command("init", "-q");
  await writeFile(join(target, "tracked.txt"), "committed\n");
  command("add", "tracked.txt");
  commitFixture(target);
  const head = command("rev-parse", "HEAD");
  await writeFile(join(target, "tracked.txt"), "staged\n");
  command("add", "tracked.txt");
  const staged = command("diff", "--cached", "--binary");
  await writeFile(join(target, "tracked.txt"), "saved human work\n");
  await writeFile(join(target, "new.txt"), "eligible untracked source\n");
  await writeFile(join(target, ".env"), "synthetic excluded fixture\n");
  host = new ExecutionHost(
    { ...defaultDeps(), agents, processes: new FakeProcesses() },
    { XDG_STATE_HOME: join(root, "state") },
    { authorize: () => {}, event: () => {}, changed: () => {}, warning: () => {} },
  );
  const req = { ...request(target), workspaceMode: "worktree" as const };
  const first = await host.dispatch(owner, req, DEFAULT_CONFIG);
  await vi.waitFor(() => expect(first.orchestrator.runs()[0]?.status).toBe("idle"));
  expect(await readFile(join(first.record.worktree, "tracked.txt"), "utf8")).toBe(
    "saved human work\n",
  );
  expect(await readFile(join(first.record.worktree, "new.txt"), "utf8")).toBe(
    "eligible untracked source\n",
  );
  await expect(readFile(join(first.record.worktree, ".env"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await writeFile(join(target, "tracked.txt"), "later human edits\n");
  const second = await host.dispatch(owner, { ...req, requestId: "same-task" }, DEFAULT_CONFIG);
  await vi.waitFor(() => expect(second.orchestrator.runs()[0]?.status).toBe("idle"));
  expect(second.record.base).toBe(first.record.base);
  expect(await readFile(join(second.record.worktree, "tracked.txt"), "utf8")).toBe(
    "saved human work\n",
  );
  const next = await host.dispatch(
    { ...owner, taskId: randomUUID() },
    { ...req, requestId: "next-task" },
    DEFAULT_CONFIG,
  );
  await vi.waitFor(() => expect(next.orchestrator.runs()[0]?.status).toBe("idle"));
  expect(next.record.base).not.toBe(first.record.base);
  expect(await readFile(join(next.record.worktree, "tracked.txt"), "utf8")).toBe(
    "later human edits\n",
  );
  expect(command("rev-parse", "HEAD")).toBe(head);
  expect(command("diff", "--cached", "--binary")).toBe(staged);
  expect(await readFile(join(target, "tracked.txt"), "utf8")).toBe("later human edits\n");
});
it.each(["folder", "all"] as const)(
  "aborts pending baseline capture on %s stop before an agent starts",
  async (kind) => {
    git.repoInfo = async () => ({ topLevel: join(root, "a"), commonDir: join(root, ".git") });
    const snapshot = vi.fn(
      (_cwd: string, _options: unknown, signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          if (signal.aborted) reject(signal.reason);
        }),
    );
    Object.assign(git, { tasks: { snapshot } });
    const pending = host.dispatch(
      owner,
      { ...request(join(root, "a")), workspaceMode: "worktree" },
      DEFAULT_CONFIG,
    );
    const rejected = expect(pending).rejects.toThrow(kind === "folder" ? "paused" : "stopped");
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalled());
    if (kind === "folder") await host.stopFolder(join(root, "a"), [owner]);
    else await host.stopAll();
    await rejected;
    expect(host.list()).toEqual([]);
    expect(agents.specs).toEqual([]);
  },
);
it("runs explicit direct targets without a project or Git and deduplicates retries", async () => {
  const req = request(join(root, "a"));
  const [first, retry] = await Promise.all([
    host.dispatch(owner, req, DEFAULT_CONFIG),
    host.dispatch(owner, req, DEFAULT_CONFIG),
  ]);
  expect(retry).toBe(first);
  await vi.waitFor(() => expect(agents.specs).toHaveLength(1));
  expect(agents.specs[0]?.cwd).toBe(req.cwd);
  expect(first.orchestrator.runs()[0]?.branch).toBeNull();
  expect(git.worktrees).toHaveLength(0);
  expect(first.target.id).toMatch(/^[a-f0-9-]{36}$/);
  await expect(
    host.dispatch(owner, { ...req, cwd: join(root, "b") }, DEFAULT_CONFIG),
  ).rejects.toThrow("other arguments");
});
it("reserves capacity across targets before asynchronous preparation and counts idle workers", async () => {
  const config = { ...DEFAULT_CONFIG, maxParallel: 1 };
  const first = host.dispatch(owner, request(join(root, "a")), config);
  await expect(host.dispatch(owner, request(join(root, "b"), "two"), config)).rejects.toThrow(
    "slots",
  );
  await first;
  await flush(20);
  expect(host.liveCount(owner)).toBe(1);
  await expect(host.dispatch(owner, request(join(root, "b"), "three"), config)).rejects.toThrow(
    "slots",
  );
});
it("still returns an accepted dispatch retry at the exact lifetime request limit", async () => {
  const req = request(join(root, "a"));
  const worker = await host.dispatch(owner, req, DEFAULT_CONFIG);
  const requests = (host as unknown as { requests: Map<string, unknown> }).requests;
  const accepted = requests.values().next().value;
  for (let index = 0; requests.size < 4096; index++) requests.set(`fixture-${index}`, accepted);
  expect(requests.size).toBe(4096);
  expect(await host.dispatch(owner, req, DEFAULT_CONFIG)).toBe(worker);
  await expect(
    host.dispatch(owner, request(join(root, "b"), "over-limit"), DEFAULT_CONFIG),
  ).rejects.toThrow("request limit");
});
it("rejects foreign generations and revoked authority", async () => {
  const worker = await host.dispatch(owner, request(join(root, "a")), DEFAULT_CONFIG);
  expect(() => host.owned({ ...owner, generation: 2 }, worker.id)).toThrow("does not own");
  expect(() => host.owned({ ...owner, id: randomUUID() }, worker.id)).toThrow("does not own");
  allowed = false;
  await expect(
    host.dispatch(owner, request(join(root, "b"), "two"), DEFAULT_CONFIG),
  ).rejects.toThrow("Revoked");
});
it("never falls back from worktree mode or a refused harness location", async () => {
  await expect(
    host.dispatch(
      owner,
      {
        ...request(join(root, "a")),
        workspaceMode: "worktree",
      },
      DEFAULT_CONFIG,
    ),
  ).rejects.toThrow("Set up Git");
  expect(agents.specs).toHaveLength(0);
  agents.startError = new Error("Harness refuses this location");
  const worker = await host.dispatch(owner, request(join(root, "a")), DEFAULT_CONFIG);
  await worker.orchestrator.done;
  expect(agents.specs).toHaveLength(1);
  expect(worker.orchestrator.runs()[0]).toMatchObject({
    status: "failed",
    reason: expect.stringContaining("Harness refuses"),
  });
  expect(await host.dispatch(owner, request(join(root, "a")), DEFAULT_CONFIG)).toBe(worker);
});
it("preserves mandatory project isolation and CLI defaults through explicit core modes", async () => {
  const { prepareRuns } = await import("../src/core/index.js");
  const deps = { ...defaultDeps(), agents, git };
  const base = {
    cwd: join(root, "a"),
    env: { XDG_STATE_HOME: join(root, "state") },
    mode: "interactive" as const,
    agents: ["claude"],
  };
  await expect(
    prepareRuns(deps, { ...base, workspaceMode: "direct", requireIsolation: true }, DEFAULT_CONFIG),
  ).rejects.toThrow("Direct");
  await expect(
    prepareRuns(deps, { ...base, workspaceMode: "direct", base: "HEAD" }, DEFAULT_CONFIG),
  ).rejects.toThrow("Direct");
  const cli = await prepareRuns(deps, base, DEFAULT_CONFIG);
  expect(cli.noWorktree).toBe("not_a_repository");
  await cli.orchestrator.shutdown();
  git.repoInfo = async () => ({ topLevel: join(root, "a"), commonDir: join(root, "a", ".git") });
  const direct = await prepareRuns(deps, { ...base, workspaceMode: "direct" }, DEFAULT_CONFIG);
  expect(direct.orchestrator.runs()[0]?.branch).toBeNull();
  expect(direct.orchestrator.runs()[0]?.worktree).toBe(base.cwd);
  await direct.orchestrator.shutdown();
});
it("folder stop pauses the affected task/target but leaves other targets running", async () => {
  const a = await host.dispatch(owner, request(join(root, "a")), DEFAULT_CONFIG);
  const b = await host.dispatch(owner, request(join(root, "b"), "two"), DEFAULT_CONFIG);
  await vi.waitFor(() => {
    expect(a.orchestrator.runs()[0]?.status).toBe("idle");
    expect(b.orchestrator.runs()[0]?.status).toBe("idle");
  });
  await host.stopFolder(join(root, "a"));
  expect(a.orchestrator.runs()[0]?.status).toBe("finished");
  expect(b.orchestrator.runs()[0]?.status).toBe("idle");
  await expect(
    host.dispatch(owner, request(join(root, "a"), "three"), DEFAULT_CONFIG),
  ).rejects.toThrow("paused");
  const nextTask = await host.dispatch(
    { ...owner, taskId: randomUUID() },
    request(join(root, "a"), "new-task"),
    DEFAULT_CONFIG,
  );
  expect(nextTask.target.id).toBe(a.target.id);
});
it("folder stop cancels unaccepted preparation and blocks only old tasks in that folder", async () => {
  const deps = defaultDeps();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mkdir = vi.fn<typeof deps.fs.mkdir>(async (path, options) => {
    await gate;
    return deps.fs.mkdir(path, options);
  });
  host = new ExecutionHost(
    { ...deps, fs: { ...deps.fs, mkdir }, agents, git, processes: new FakeProcesses() },
    { XDG_STATE_HOME: join(root, "state") },
    { authorize: () => {}, event: () => {}, changed: () => {}, warning: () => {} },
  );
  const starting = host.dispatch(owner, request(join(root, "a")), DEFAULT_CONFIG);
  const rejected = expect(starting).rejects.toThrow("paused");
  await vi.waitFor(() => expect(mkdir).toHaveBeenCalled());
  const stopping = host.stopFolder(join(root, "a"), [owner]);
  release();
  await stopping;
  await rejected;
  expect(agents.specs).toEqual([]);
  const b = await host.dispatch(owner, request(join(root, "b"), "b"), DEFAULT_CONFIG);
  await vi.waitFor(() => expect(b.orchestrator.runs()[0]?.status).toBe("idle"));
  const unusedTask = { ...owner, taskId: randomUUID() };
  await host.stopFolder(join(root, "a"), [unusedTask]);
  await expect(
    host.dispatch(unusedTask, request(join(root, "a"), "unused"), DEFAULT_CONFIG),
  ).rejects.toThrow("paused");
});
it("keeps accepted dispatches deduplicated even when presentation callbacks fail", async () => {
  const warning = vi.fn();
  host = new ExecutionHost(
    { ...defaultDeps(), agents, git, processes: new FakeProcesses() },
    { XDG_STATE_HOME: join(root, "state") },
    {
      authorize: () => {},
      event: () => {
        throw new Error("Event presentation failed");
      },
      changed: () => {
        throw new Error("UI failed");
      },
      warning,
    },
  );
  const req = request(join(root, "a"));
  const worker = await host.dispatch(owner, req, DEFAULT_CONFIG);
  await vi.waitFor(() => expect(worker.orchestrator.runs()[0]?.status).toBe("idle"));
  expect(await host.dispatch(owner, req, DEFAULT_CONFIG)).toBe(worker);
  expect(agents.specs).toHaveLength(1);
  expect(warning).toHaveBeenCalled();
});
it("blocks replacement dispatch while Stop all is awaiting cleanup and permits forced escalation", async () => {
  const a = await host.dispatch(owner, request(join(root, "a")), DEFAULT_CONFIG);
  const b = await host.dispatch(owner, request(join(root, "b"), "b"), DEFAULT_CONFIG);
  await vi.waitFor(() => expect(agents.specs).toHaveLength(2));
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const shutdown = a.orchestrator.shutdown.bind(a.orchestrator);
  const stopA = vi.spyOn(a.orchestrator, "shutdown").mockImplementation(async (force) => {
    if (!force) await gate;
    return shutdown(force);
  });
  const stopB = vi.spyOn(b.orchestrator, "shutdown");
  const stopping = host.stopAll();
  try {
    await expect(
      host.dispatch(owner, request(join(root, "a"), "replacement"), DEFAULT_CONFIG),
    ).rejects.toThrow("stopping");
    await host.stopAll(true);
    expect(stopA).toHaveBeenCalledWith(true);
    expect(stopB).toHaveBeenCalledWith(true);
    expect(agents.specs).toHaveLength(2);
  } finally {
    release();
    await stopping;
  }
});
it("rejects changed directory identities and malformed or relative targets", async () => {
  for (const cwd of ["relative", "/bad\npath", "x".repeat(32_769)])
    await expect(host.dispatch(owner, request(cwd), DEFAULT_CONFIG)).rejects.toThrow("absolute");
  const original = join(root, "a");
  await host.dispatch(owner, request(original), DEFAULT_CONFIG);
  await rename(original, join(root, "old-a"));
  await mkdir(original);
  await expect(host.dispatch(owner, request(original, "replaced"), DEFAULT_CONFIG)).rejects.toThrow(
    "identity changed",
  );
  if (process.platform !== "win32") {
    await symlink(join(root, "b"), join(root, "alias"));
    const b = await host.dispatch(owner, request(join(root, "alias"), "alias"), DEFAULT_CONFIG);
    expect(b.target.cwd).toBe(join(root, "b"));
  }
});
