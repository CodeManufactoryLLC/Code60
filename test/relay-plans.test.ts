import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlanCreate } from "../src/bridge/index.js";
import { DEFAULT_CONFIG, defaultDeps } from "../src/core/index.js";
import { ExecutionHost, type ExecutionOwner } from "../src/desktop/execution-host.js";
import { RelayPlans } from "../src/desktop/relay-plans.js";
import { FakeAgents, FakeGit, FakeProcesses } from "./fakes.js";

let root: string;
let host: ExecutionHost;
let plans: RelayPlans;
let agents: FakeAgents;
let snapshot: ReturnType<typeof vi.fn>;
let current: string;
const owner: ExecutionOwner = { id: randomUUID(), generation: 1, taskId: randomUUID() };
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "code60-relay-plans-")));
  await mkdir(join(root, "target"));
  await mkdir(join(root, "direct"));
  agents = new FakeAgents();
  const git = new FakeGit();
  git.repoInfo = async (cwd = root) => ({ topLevel: cwd, commonDir: join(root, ".git") });
  git.resolveCommit = async (_cwd, base) => (base === "HEAD" ? "a".repeat(40) : base);
  current = "b".repeat(40);
  snapshot = vi.fn(async () => current);
  Object.assign(git, { tasks: { snapshot } });
  host = new ExecutionHost(
    { ...defaultDeps(), git, agents, processes: new FakeProcesses() },
    { XDG_STATE_HOME: join(root, "state") },
    {
      authorize: () => {},
      authorizeTarget: (owner, request, target) => plans.validate(owner, request, target),
      event: () => {},
      changed: () => {},
      warning: () => {},
    },
  );
  plans = await RelayPlans.open(join(root, "documents"), owner.id, host, () => {});
});
afterEach(async () => {
  await host.shutdown(true);
  await rm(root, { recursive: true, force: true });
});
function proposal(): PlanCreate {
  return {
    requestId: "proposal",
    title: "Review each target",
    description: "",
    tasks: [
      { text: "First", target: { cwd: join(root, "target"), workspaceMode: "worktree" } },
      { text: "Same target", target: { cwd: join(root, "target"), workspaceMode: "worktree" } },
      { text: "Direct edits", target: { cwd: join(root, "direct"), workspaceMode: "direct" } },
    ],
  };
}
it("freezes an accepted target at its first default-base dispatch and preserves explicit bases", async () => {
  const plan = await plans.create(proposal(), owner);
  expect(snapshot).not.toHaveBeenCalled();
  const accepted = await plans.action({
    type: "accept",
    chatId: owner.id,
    planId: plan.id,
    revision: plan.revision,
  });
  expect(snapshot).not.toHaveBeenCalled();
  expect(host.list()).toEqual([]);
  expect(agents.specs).toEqual([]);
  await plans.running(accepted);
  const request = {
    requestId: "worker",
    cwd: join(root, "target"),
    workspaceMode: "worktree" as const,
    provider: "claude",
    prompt: "Use accepted files",
    planTaskId: plan.tasks[0]?.id,
  };
  const worker = await host.dispatch(owner, request, DEFAULT_CONFIG);
  expect(worker.record.base).toBe("b".repeat(40));
  current = "c".repeat(40);
  const later = await host.dispatch(owner, { ...request, requestId: "later" }, DEFAULT_CONFIG);
  expect(later.record.base).toBe(worker.record.base);
  expect(snapshot).toHaveBeenCalledTimes(1);
  expect(snapshot.mock.calls[0]?.[0]).toBe(join(root, "target"));
  const explicit = await host.dispatch(
    owner,
    { ...request, requestId: "override", base: "HEAD" },
    DEFAULT_CONFIG,
  );
  expect(explicit.record.base).toBe("a".repeat(40));
  expect(host.list()).toHaveLength(3);
});
it("rejects stale acceptance and never accepts a worker after a failed baseline capture", async () => {
  const plan = await plans.create(proposal(), owner);
  const action = {
    type: "accept" as const,
    chatId: owner.id,
    planId: plan.id,
    revision: plan.revision,
  };
  await expect(plans.action({ ...action, revision: plan.revision + 1 })).rejects.toThrow("changed");
  expect(snapshot).not.toHaveBeenCalled();
  await plans.running(await plans.action(action));
  const request = {
    requestId: "worker",
    cwd: join(root, "target"),
    workspaceMode: "worktree" as const,
    provider: "claude",
    prompt: "Work",
    planTaskId: plan.tasks[0]?.id,
  };
  snapshot.mockRejectedValueOnce(new Error("Files changed during capture"));
  await expect(host.dispatch(owner, request, DEFAULT_CONFIG)).rejects.toThrow("Files changed");
  expect(plans.get(plan.id).state).toBe("running");
  expect(host.list()).toEqual([]);
  expect(agents.specs).toEqual([]);
  await host.dispatch(owner, request, DEFAULT_CONFIG);
  expect(snapshot).toHaveBeenCalledTimes(2);
});
it("never grants a saved draft authority through an identical create retry", async () => {
  const request = proposal();
  const plan = await plans.create(request, owner);
  expect((await plans.create(request, owner)).id).toBe(plan.id);
  // Keep the exact same host and canonical target IDs, as on an in-process reconnect.
  plans = await RelayPlans.open(join(root, "documents"), owner.id, host, () => {});
  await expect(plans.create(request, owner)).rejects.toThrow("no live task authority");
  await expect(
    plans.action({
      type: "accept",
      chatId: owner.id,
      planId: plan.id,
      revision: plan.revision,
    }),
  ).rejects.toThrow("no live task authority");
  expect(plans.get(plan.id).state).toBe("draft");
  expect(snapshot).not.toHaveBeenCalled();
});
it.each(["folder", "all"] as const)(
  "cancels accepted-plan worker preparation on %s stop without starting work",
  async (kind) => {
    snapshot.mockImplementation(
      (_cwd: string, _options: unknown, signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          if (signal.aborted) reject(signal.reason);
        }),
    );
    const plan = await plans.create(proposal(), owner);
    await plans.running(
      await plans.action({
        type: "accept",
        chatId: owner.id,
        planId: plan.id,
        revision: plan.revision,
      }),
    );
    const pending = host.dispatch(
      owner,
      {
        requestId: "worker",
        cwd: join(root, "target"),
        workspaceMode: "worktree",
        provider: "claude",
        prompt: "Work",
        planTaskId: plan.tasks[0]?.id,
      },
      DEFAULT_CONFIG,
    );
    const rejected = expect(pending).rejects.toThrow(kind === "folder" ? "paused" : "stopped");
    await vi.waitFor(() => expect(snapshot).toHaveBeenCalledTimes(1));
    if (kind === "folder") await host.stopFolder(join(root, "target"), [owner]);
    else await host.stopAll();
    await rejected;
    expect(plans.get(plan.id).state).toBe("running");
    expect(host.list()).toEqual([]);
    expect(agents.specs).toEqual([]);
  },
);
it("does not capture a direct-only plan even without Git", async () => {
  const request = proposal();
  request.tasks = request.tasks.filter((task) => task.target?.workspaceMode === "direct");
  const plan = await plans.create(request, owner);
  await plans.action({
    type: "accept",
    chatId: owner.id,
    planId: plan.id,
    revision: plan.revision,
  });
  expect(snapshot).not.toHaveBeenCalled();
  expect(host.list()).toEqual([]);
});
