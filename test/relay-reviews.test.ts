import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RelayReviewRequest, RelayReviewResponse } from "../src/bridge/index.js";
import { type CoreDeps, DEFAULT_CONFIG, defaultDeps } from "../src/core/index.js";
import {
  ExecutionHost,
  type ExecutionOwner,
  type ExecutionWorker,
} from "../src/desktop/execution-host.js";
import { RelayReviewStore } from "../src/desktop/relay-review-store.js";
import { RelayReviews } from "../src/desktop/relay-reviews.js";
import { RelayService } from "../src/desktop/relay-service.js";
import { FakeAgents, FakeProcesses } from "./fakes.js";
import { commitFixture } from "./fixtures/git-repository.js";

// These real-Git/private-storage journeys exceed 5 s on Windows (the native
// log also has passing cases above 5 s); keep the same assertions and bounds.
if (process.platform === "win32") vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let root: string;
let deps: CoreDeps;
let host: ExecutionHost;
let reviews: RelayReviewStore;
let owner: ExecutionOwner;
let agents: FakeAgents;
let manager: RelayReviews | undefined;
let service: RelayService | undefined;
const feedback = vi.fn();
const confirm = vi.fn(async () => true);
beforeEach(async () => {
  vi.stubEnv("CODE60_NATIVE_DIAG", "1");
  root = await realpath(await mkdtemp(join(tmpdir(), "code60-relay-reviews-")));
  owner = { id: randomUUID(), generation: 1, taskId: randomUUID() };
  agents = new FakeAgents();
  manager = undefined;
  service = undefined;
  feedback.mockReset();
  confirm.mockReset().mockResolvedValue(true);
  deps = { ...defaultDeps(), agents, processes: new FakeProcesses() };
  host = new ExecutionHost(
    deps,
    { XDG_STATE_HOME: join(root, "state") },
    {
      authorize() {},
      event() {},
      changed() {},
      warning() {},
      async checkout() {},
      authorizeTarget(_owner, _request, target) {
        manager?.assertWritableTarget(target);
      },
    },
  );
  reviews = await RelayReviewStore.open(join(root, "reviews"), owner.id, deps);
  manager = new RelayReviews(reviews, deps, { XDG_STATE_HOME: join(root, "state") }, host, {
    valid(request) {
      if (request.conversationId !== owner.id || request.generation !== owner.generation)
        throw new Error("Stale generation");
    },
    live(review) {
      return review.relay?.generation === owner.generation;
    },
    changed() {},
    feedback,
    withdraw() {},
    confirm,
  });
  for (const name of ["a", "b"]) {
    const cwd = join(root, name);
    execFileSync("git", ["init", "-q", cwd]);
    execFileSync("git", ["config", "core.autocrlf", "false"], { cwd });
    execFileSync("git", ["config", "core.hooksPath", join(root, "no-hooks")], { cwd });
    await writeFile(join(cwd, "file.txt"), "Before\n");
    execFileSync("git", ["add", "."], { cwd });
    commitFixture(cwd);
  }
});
afterEach(async () => {
  await service?.shutdown(true);
  await host.shutdown(true);
  await manager?.stop();
  await reviews.settled();
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
async function relayTool(name: string, args: unknown = {}) {
  const server = agents.specs
    .find((spec) => spec.mcpServers?.some((server) => server.name === "code60"))
    ?.mcpServers?.find((server) => server.name === "code60");
  if (!server || "type" in server) throw new Error("Missing Relay gateway");
  const env = Object.fromEntries((server.env ?? []).map(({ name, value }) => [name, value]));
  const response = await fetch(required(env.CODE60_MCP_GATEWAY_URL), {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.CODE60_MCP_GATEWAY_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name, arguments: args }),
  });
  const body = (await response.json()) as { result: Record<string, unknown>; error?: string };
  if (!response.ok) throw new Error(body.error);
  return body.result;
}
it("automatically captures settled work once and publishes only compact conversation metadata", async () => {
  const source = await ready();
  const worktree = required(source.accepted.orchestrator.runs()[0]?.worktree);
  await writeFile(join(worktree, "file.txt"), "Automatic result\n");
  for (let i = 0; i < 3; i++) required(manager).scheduleCapture(source.address);
  await vi.waitFor(
    async () => {
      const review = (await reviews.read(source.id)).get(source.id);
      expect(review.revisions).toHaveLength(1);
      expect(review.revisions[0]?.files[0]?.path).toBe("file.txt");
    },
    { timeout: 10_000 },
  );
  const timeline = await required(manager).request({
    type: "timeline",
    conversationId: owner.id,
    generation: owner.generation,
  });
  expect(timeline).toMatchObject({
    type: "timeline",
    entries: [
      {
        summary: {
          revisions: [
            {
              fileCount: 1,
              incomplete: false,
              outcomes: [{ runId: source.accepted.id, status: "finished" }],
            },
          ],
        },
      },
    ],
    cursor: null,
  });
  expect(JSON.stringify(timeline)).not.toContain("Automatic result");
  expect(JSON.stringify(timeline)).not.toContain('"sources"');
  expect(JSON.stringify(timeline)).not.toContain('"checkout"');
  expect(await readFile(join(root, "a", "file.txt"), "utf8")).toBe("Before\n");
  expect(confirm).not.toHaveBeenCalled();
});
it("lets an explicit action preempt automatic capture without saving a failure or applying files", async () => {
  const source = await ready();
  const snapshot = required(deps.git.tasks).snapshot.bind(required(deps.git.tasks));
  let started = false;
  let cancelled = false;
  vi.spyOn(required(deps.git.tasks), "snapshot").mockImplementation(
    async (cwd, options, signal) => {
      if (cwd !== source.accepted.record.worktree) return snapshot(cwd, options, signal);
      started = true;
      await new Promise<void>((resolve) => {
        signal?.addEventListener("abort", () => resolve(), { once: true });
        if (signal?.aborted) resolve();
      });
      cancelled = true;
      signal?.throwIfAborted();
      throw new Error("Expected capture cancellation");
    },
  );
  required(manager).scheduleCapture(source.address);
  await vi.waitFor(() => expect(started).toBe(true));
  expect(() => required(manager).assertWritableTarget(source.accepted.target)).not.toThrow();
  await vi.waitFor(() => expect(cancelled).toBe(true));
  await required(manager).rendererGone();
  const review = (await reviews.read(source.id)).get(source.id);
  expect(review.revisions).toHaveLength(0);
  expect(review.error).toBeUndefined();
  expect(await readFile(join(root, "a", "file.txt"), "utf8")).toBe("Before\n");
});
it("keeps partial automatic capture failures visible and allows explicit refresh", async () => {
  const source = await ready();
  const read = vi
    .spyOn(deps.git, "reviewSnapshot")
    .mockRejectedValue(new Error("Snapshot unavailable"));
  required(manager).scheduleCapture(source.address);
  await vi.waitFor(
    async () =>
      expect((await reviews.read(source.id)).get(source.id).revisions[0]?.errors).toEqual([
        { runId: source.accepted.id, message: "Snapshot unavailable" },
      ]),
    { timeout: 5000 },
  );
  read.mockRestore();
  await required(manager).rendererGone();
  const review = await capture(source);
  expect(review.revisions.at(-1)?.errors).toEqual([]);
});
it("reports damaged conversation evidence per review without hiding other records", async () => {
  const a = await ready();
  const b = await ready(join(root, "b"), "second");
  await capture(a);
  await capture(b);
  const store = await reviews.read(a.id);
  await writeFile(join(store.root, `${a.id}.json`), "broken");
  const result = await required(manager).request({
    type: "timeline",
    conversationId: owner.id,
    generation: owner.generation,
  });
  if (result.type !== "timeline") throw new Error("Missing timeline");
  expect(result.entries.find(({ entry }) => entry.id === a.id)?.error).toBeTruthy();
  expect(result.entries.find(({ entry }) => entry.id === b.id)?.summary?.revisions).toHaveLength(1);
});
it.each(["failed", "cancelled"] as const)(
  "automatically captures partial work and the actual %s worker turn outcome",
  async (status) => {
    agents.script = (text) => (text === "Worker with partial changes" ? "hang" : "end_turn");
    service = new RelayService(deps, { XDG_STATE_HOME: join(root, "relay-state") }, () => {}, {
      confirm,
    });
    await service.sync("claude", DEFAULT_CONFIG);
    await vi.waitFor(() => expect(service?.snapshot().run?.status).toBe("idle"));
    await service.action({
      type: "send",
      id: required(service.snapshot().run?.id),
      text: "Partial task",
    });
    await vi.waitFor(() => expect(service?.snapshot().run?.status).toBe("idle"));
    const context = await relayTool("code60_get_context");
    const accepted = await relayTool("code60_dispatch_agent", {
      scope: context.scope,
      requestId: "partial-worker",
      cwd: join(root, "a"),
      workspaceMode: "worktree",
      prompt: "Worker with partial changes",
    });
    await vi.waitFor(() =>
      expect(
        agents.sessions.some((session) => session.prompts.includes("Worker with partial changes")),
      ).toBe(true),
    );
    const worker = required(
      service.execution.list().find((worker) => worker.id === accepted.runId),
    );
    const worktree = required(worker.orchestrator.runs()[0]?.worktree);
    await writeFile(join(worktree, "file.txt"), "Partial retained result\n");
    const session = required(
      agents.sessions.find((session) => session.prompts.includes("Worker with partial changes")),
    );
    if (status === "failed") session.failTurn(new Error("Synthetic worker failure"));
    else expect(worker.orchestrator.cancelTurn(worker.id)).toBe(true);
    if (status === "failed") await worker.orchestrator.done;
    else await vi.waitFor(() => expect(worker.orchestrator.runs()[0]?.status).toBe("idle"));
    await vi.waitFor(
      async () => {
        const result = await service?.reviewRequest({
          type: "timeline",
          conversationId: required(service.snapshot().conversationId),
          generation: required(service.snapshot().generation),
        });
        expect(result).toMatchObject({
          type: "timeline",
          entries: [
            {
              summary: {
                revisions: [{ fileCount: 1, outcomes: [{ runId: worker.id, status }] }],
              },
            },
          ],
        });
      },
      // Windows CI needed up to 16 s for sibling automatic captures. Under the full
      // parallel suite, native worktree and snapshot processes on an ARM64 VM needed more.
      { timeout: process.platform === "win32" ? 45_000 : 20_000 },
    );
    expect(await readFile(join(root, "a", "file.txt"), "utf8")).toBe("Before\n");
    expect(await readFile(join(worktree, "file.txt"), "utf8")).toBe("Partial retained result\n");
    expect(session.stops).toHaveLength(status === "failed" ? 1 : 0);
    expect(session.cancels).toBe(status === "cancelled" ? 1 : 0);
    expect(confirm).not.toHaveBeenCalled();
  },
  process.platform === "win32" ? 60_000 : undefined,
);
it("routes real Relay dispatch, review capture and between-turn feedback to the originating task", async () => {
  const associations = vi.spyOn(RelayReviewStore.prototype, "associate");
  service = new RelayService(deps, { XDG_STATE_HOME: join(root, "relay-state") }, () => {}, {
    confirm,
  });
  await service.sync("claude", DEFAULT_CONFIG);
  await vi.waitFor(() => expect(service?.snapshot().run?.status).toBe("idle"));
  expect(agents.sessions[0]?.prompts).toEqual([]);
  await service.action({ type: "send", id: required(service.snapshot().run?.id), text: "Task A" });
  await vi.waitFor(() => expect(service?.snapshot().run?.status).toBe("idle"));
  const initial = await relayTool("code60_get_context");
  const accepted = await relayTool("code60_dispatch_agent", {
    scope: initial.scope,
    requestId: "from-relay",
    cwd: join(root, "a"),
    workspaceMode: "worktree",
    prompt: "First task worker",
  });
  const runId = accepted.runId as string;
  await vi.waitFor(() => expect(service?.workerSnapshot().runs[0]?.record.status).toBe("idle"));
  for (const result of associations.mock.results)
    await expect(result.value).resolves.toEqual(expect.any(String));
  await vi.waitFor(() => {
    expect(service?.workerSnapshot().runs[0]?.record.status).toBe("idle");
    expect(service?.snapshot().run?.status).toBe("idle");
    expect(service?.snapshot().updates?.pending).toBe(0);
  });
  const live = required(service.execution.list().find((worker) => worker.id === runId));
  await writeFile(
    join(required(live.orchestrator.runs()[0]?.worktree), "file.txt"),
    "Relay worker changes\n",
  );
  const request = {
    conversationId: required(service.snapshot().conversationId),
    generation: required(service.snapshot().generation),
    targetId: accepted.targetId as string,
    reviewId: accepted.reviewId as string,
  };
  const captured = await service.reviewRequest({
    type: "capture",
    ...request,
    requestId: randomUUID(),
  });
  if (captured.type !== "review") throw new Error("Missing captured Relay review");
  expect(captured.review.originChatId).toBe(service.snapshot().run?.id);
  expect(captured.review.turn).toBe(1);
  expect(service.workerSnapshot(true).runs[0]?.relay?.reviewId).toBe(request.reviewId);
  await service.action({
    type: "send",
    id: required(service.snapshot().run?.id),
    text: "Unrelated task B",
  });
  await vi.waitFor(() => expect(service?.snapshot().run?.status).toBe("idle"));
  expect((await relayTool("code60_get_context")).taskId).not.toBe(accepted.taskId);
  const revisionId = required(captured.review.revisions.at(-1)?.id);
  await service.reviewRequest({
    type: "action",
    ...request,
    action: {
      type: "comment",
      id: randomUUID(),
      revisionId,
      text: "Feedback specifically for task A",
    },
  });
  await service.reviewRequest({
    type: "action",
    ...request,
    action: {
      type: "submit",
      id: randomUUID(),
      revisionId,
    },
  });
  await vi.waitFor(() =>
    expect(
      agents.sessions[0]?.prompts.some((text) => text.includes("Feedback specifically for task A")),
    ).toBe(true),
  );
  await vi.waitFor(() => expect(service?.snapshot().run?.status).toBe("idle"));
  expect((await relayTool("code60_get_context")).taskId).toBe(accepted.taskId);
  await vi.waitFor(async () => {
    const result = await service?.reviewRequest({
      type: "read",
      ...request,
      requestId: randomUUID(),
    });
    expect(result).toMatchObject({
      type: "review",
      live: true,
      review: { submissions: [{ state: "delivered" }] },
    });
  });
  await service.cancelReviewReads();
  expect(service.workerSnapshot(true).runs[0]?.relay?.reviewId).toBe(request.reviewId);
});
it("saves checkout pins for sequential human requests in two target owners", async () => {
  const associations = vi.spyOn(RelayReviewStore.prototype, "associate");
  service = new RelayService(deps, { XDG_STATE_HOME: join(root, "relay-state") }, () => {}, {
    confirm,
  });
  await service.sync("claude", DEFAULT_CONFIG);
  await vi.waitFor(() => expect(service?.snapshot().run?.status).toBe("idle"));
  const tasks = new Set<string>();
  for (const name of ["a", "b"]) {
    await service.action({
      type: "send",
      id: required(service.snapshot().run?.id),
      text: `Human request for target ${name}`,
    });
    await vi.waitFor(() => expect(service?.snapshot().run?.status).toBe("idle"));
    const context = await relayTool("code60_get_context");
    const accepted = await relayTool("code60_dispatch_agent", {
      scope: context.scope,
      requestId: `worker-${name}`,
      cwd: join(root, name),
      workspaceMode: "worktree",
      prompt: `Target ${name} work`,
    });
    const worker = required(
      service.execution.list().find((worker) => worker.id === accepted.runId),
    );
    await vi.waitFor(() => expect(worker.orchestrator.runs()[0]?.status).toBe("idle"));
    for (const result of associations.mock.results)
      await expect(result.value).resolves.toEqual(expect.any(String));
    const response = await service.reviewRequest({
      type: "read",
      conversationId: required(service.snapshot().conversationId),
      generation: required(service.snapshot().generation),
      targetId: accepted.targetId as string,
      reviewId: accepted.reviewId as string,
      requestId: randomUUID(),
    });
    expect(response).toMatchObject({
      type: "review",
      review: {
        relay: { cwd: join(root, name), taskId: accepted.taskId },
        workers: [
          {
            runId: worker.id,
            checkout: {
              cwd: worker.checkout?.cwd,
              device: worker.checkout?.device.toString(),
              inode: worker.checkout?.inode.toString(),
              base: worker.record.base,
              branch: worker.record.branch,
            },
          },
        ],
      },
    });
    expect(worker.checkout).toBeDefined();
    tasks.add(accepted.taskId as string);
  }
  expect(tasks.size).toBe(2);
});
it("cancels one target's capture after cleanup without holding another target's review", async () => {
  const a = await ready();
  const b = await ready(join(root, "b"), "two");
  const git = required(deps.git.tasks);
  const original = git.snapshot.bind(git);
  let started = false;
  let cleaned = false;
  vi.spyOn(git, "snapshot").mockImplementation(async (cwd, parent, signal) => {
    if (cwd !== a.accepted.orchestrator.runs()[0]?.worktree) return original(cwd, parent, signal);
    started = true;
    await new Promise<void>((resolve) => {
      signal?.addEventListener("abort", () => resolve(), { once: true });
      if (signal?.aborted) resolve();
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    cleaned = true;
    signal?.throwIfAborted();
    throw new Error("Unexpected uncancelled capture");
  });
  const requestId = randomUUID();
  const pending = required(manager).request({ type: "capture", ...a.address, requestId });
  const rejection = expect(pending).rejects.toThrow("cancelled");
  await vi.waitFor(() => expect(started).toBe(true));
  expect(() => required(manager).assertWritableTarget(a.accepted.target)).toThrow(
    "review operation",
  );
  expect(() => required(manager).assertWritableTarget(b.accepted.target)).not.toThrow();
  await required(manager).request({ type: "cancel", ...b.address, requestId });
  expect(cleaned).toBe(false);
  expect((await capture(b)).revisions).toHaveLength(1);
  await required(manager).request({ type: "cancel", ...a.address, requestId });
  await rejection;
  expect(cleaned).toBe(true);
  expect(() => required(manager).assertWritableTarget(a.accepted.target)).not.toThrow();
});
it("keeps explicit bases independent until the first default dispatch freezes its baseline", async () => {
  const explicit = await host.dispatch(
    owner,
    {
      cwd: join(root, "a"),
      requestId: "explicit",
      workspaceMode: "worktree",
      base: "HEAD",
      provider: "claude",
      prompt: "Explicit revision",
    },
    DEFAULT_CONFIG,
  );
  const id = required(await reviews.associate(explicit, 1));
  expect((await reviews.read(id)).get(id).relay?.baseline).toBeUndefined();
  await writeFile(join(root, "a", "file.txt"), "Saved before first default dispatch\n");
  const defaultWorker = await worker(join(root, "a"), "default");
  expect(defaultWorker.taskBaseline?.taskId).toBe(owner.taskId);
  expect(await reviews.associate(defaultWorker, 1)).toBe(id);
  const review = (await reviews.read(id)).get(id);
  expect(review.relay?.baseline).toBe(defaultWorker.taskBaseline?.commit);
  expect(review.relay?.baseline).not.toBe(explicit.record.base);
});
function address(worker: ExecutionWorker, reviewId: string) {
  return {
    conversationId: owner.id,
    generation: owner.generation,
    targetId: worker.target.id,
    reviewId,
  };
}
async function ready(cwd = join(root, "a"), requestId = "one") {
  const accepted = await worker(cwd, requestId);
  await vi.waitFor(() => expect(accepted.orchestrator.runs()[0]?.status).toBe("idle"));
  const id = required(await reviews.associate(accepted, 1));
  return { accepted, id, address: address(accepted, id) };
}
async function capture(source: Awaited<ReturnType<typeof ready>>, text = "Worker changes\n") {
  const cwd = required(source.accepted.orchestrator.runs()[0]?.worktree);
  await writeFile(join(cwd, "file.txt"), text);
  const result = await required(manager).request({
    type: "capture",
    ...source.address,
    requestId: randomUUID(),
  });
  if (result.type !== "review") throw new Error("Missing capture");
  return result.review;
}
async function task(
  source: Awaited<ReturnType<typeof ready>>,
  action: Extract<RelayReviewRequest, { type: "task" }>["action"],
) {
  const result = await required(manager).request({ type: "task", ...source.address, action });
  if (result.type !== "task") throw new Error("Missing task response");
  return result.task;
}
it("applies repository-relative additions and modifications from a subdirectory target and undoes them", async () => {
  const repo = join(root, "a");
  await mkdir(join(repo, "src"));
  await writeFile(join(repo, "src", "existing.ts"), "before\n");
  execFileSync("git", ["add", "."], { cwd: repo });
  commitFixture(repo);
  const source = await ready(join(repo, "src"));
  const checkout = source.accepted.record.worktree;
  await writeFile(join(checkout, "src", "existing.ts"), "after\n");
  await writeFile(join(checkout, "src", "new.ts"), "added\n");
  const review = await capture(source);
  const prepared = await task(source, {
    type: "prepare",
    revisionId: required(review.revisions.at(-1)?.id),
  });
  expect(prepared.operation?.conflicts).toEqual([]);
  const operationId = required(prepared.operation?.id);
  await task(source, { type: "apply", operationId });
  expect(await readFile(join(repo, "src", "new.ts"), "utf8")).toBe("added\n");
  expect(await readFile(join(repo, "src", "existing.ts"), "utf8")).toBe("after\n");
  await expect(readFile(join(repo, "src", "src", "new.ts"))).rejects.toThrow();
  expect(review.relay?.cwd).toBe(join(repo, "src"));
  await task(source, { type: "undo", operationId });
  expect(await readFile(join(repo, "src", "existing.ts"), "utf8")).toBe("before\n");
  await expect(readFile(join(repo, "src", "new.ts"))).rejects.toThrow();
});
it("preserves review turn ownership when retrying dispatch after a human follow-up", async () => {
  service = new RelayService(deps, { XDG_STATE_HOME: join(root, "relay-state") }, () => {}, {
    confirm,
  });
  await service.sync("claude", DEFAULT_CONFIG);
  await vi.waitFor(() => expect(service?.snapshot().run?.status).toBe("idle"));
  await service.action({ type: "send", id: required(service.snapshot().run?.id), text: "Task" });
  await vi.waitFor(() => expect(service?.snapshot().run?.status).toBe("idle"));
  await service.action({ type: "cancel", id: required(service.snapshot().run?.id) });
  const { scope } = await relayTool("code60_get_context");
  const request = {
    scope,
    requestId: "retry-turn",
    cwd: join(root, "a"),
    workspaceMode: "worktree",
    prompt: "Task",
  };
  const accepted = await relayTool("code60_dispatch_agent", request);
  const worker = required(service.execution.list()[0]);
  await vi.waitFor(() => expect(worker.orchestrator.runs()[0]?.status).toBe("idle"));
  await service.workerAction({ type: "reply", id: worker.id, text: "Follow-up" });
  await vi.waitFor(() =>
    expect(worker.orchestrator.runs()[0]).toMatchObject({ status: "idle", turns: 2 }),
  );
  expect((await relayTool("code60_dispatch_agent", request)).runId).toBe(accepted.runId);
  const result = await service.reviewRequest({
    type: "capture",
    conversationId: required(service.snapshot().conversationId),
    generation: required(service.snapshot().generation),
    targetId: String(accepted.targetId),
    reviewId: String(accepted.reviewId),
    requestId: randomUUID(),
  });
  expect(result).toMatchObject({ type: "review", live: true, review: { workers: [{ turn: 2 }] } });
});
it("captures, previews, confirms, applies and undoes only the addressed checkout without a database", async () => {
  const a = await ready();
  const b = await ready(join(root, "b"), "two");
  const aReview = await capture(a);
  const bReview = await capture(b, "Other target's changes\n");
  expect(bReview.relay?.targetId).not.toBe(aReview.relay?.targetId);
  const revision = required(aReview.revisions.at(-1));
  const prepared = await task(a, { type: "prepare", revisionId: revision.id });
  const operationId = required(prepared.operation?.id);
  expect(prepared.source).toBe("Current saved files");
  const fileId = required(prepared.operation?.changes[0]?.id);
  expect((await task(a, { type: "file", operationId, fileId })).file).toMatchObject({
    original: "Before\n",
    modified: "Worker changes\n",
  });
  expect(await readFile(join(root, "a", "file.txt"), "utf8")).toBe("Before\n");
  expect((await task(a, { type: "apply", operationId })).operation?.status).toBe("applied");
  expect(confirm).toHaveBeenCalledWith(
    "Apply reviewed changes?",
    expect.stringContaining(join(root, "a")),
  );
  expect(await readFile(join(root, "a", "file.txt"), "utf8")).toBe("Worker changes\n");
  expect(await readFile(join(root, "b", "file.txt"), "utf8")).toBe("Before\n");
  expect((await task(a, { type: "undo", operationId })).operation?.status).toBe("undone");
  expect(await readFile(join(root, "a", "file.txt"), "utf8")).toBe("Before\n");
});
it("rejects mixed target IDs, stale generations and revision/file path substitutions", async () => {
  const a = await ready();
  const review = await capture(a);
  const revision = required(review.revisions.at(-1));
  await expect(
    required(manager).request({
      type: "read",
      ...a.address,
      targetId: randomUUID(),
      requestId: randomUUID(),
    }),
  ).rejects.toThrow("target does not match");
  await expect(
    required(manager).request({
      type: "read",
      ...a.address,
      generation: owner.generation - 1,
      requestId: randomUUID(),
    }),
  ).rejects.toThrow("Stale generation");
  await expect(
    required(manager).request({
      type: "file",
      ...a.address,
      requestId: randomUUID(),
      revisionId: revision.id,
      fileKey: "/etc/passwd",
    }),
  ).rejects.toThrow();
  await expect(
    required(manager).request({
      type: "read",
      ...a.address,
      requestId: randomUUID(),
      cwd: join(root, "b"),
    }),
  ).rejects.toThrow();
});
it("refuses a changed worker source and preserves newer checkout edits after confirmation", async () => {
  const a = await ready();
  const review = await capture(a);
  const revisionId = required(review.revisions.at(-1)?.id);
  const operationId = required((await task(a, { type: "prepare", revisionId })).operation?.id);
  await writeFile(
    join(required(a.accepted.orchestrator.runs()[0]?.worktree), "file.txt"),
    "Unreviewed changes\n",
  );
  await expect(task(a, { type: "apply", operationId })).rejects.toThrow("Worker files changed");
  expect(await readFile(join(root, "a", "file.txt"), "utf8")).toBe("Before\n");
  const refreshed = await capture(a);
  const nextId = required(
    (
      await task(a, {
        type: "prepare",
        revisionId: required(refreshed.revisions.at(-1)?.id),
      })
    ).operation?.id,
  );
  confirm.mockImplementationOnce(async () => {
    await writeFile(join(root, "a", "file.txt"), "Newer user edits\n");
    return true;
  });
  await expect(task(a, { type: "apply", operationId: nextId })).rejects.toThrow(
    "Nothing was applied",
  );
  expect(await readFile(join(root, "a", "file.txt"), "utf8")).toBe("Newer user edits\n");
});
it("rejects worker record redirection into another checkout of the same repository", async () => {
  const a = await ready();
  const b = await ready(join(root, "a"), "second-checkout");
  const captured = await capture(a);
  const saved = await a.accepted.workspace.store.read(a.accepted.id);
  await a.accepted.workspace.store.save({ ...saved, worktree: b.accepted.record.worktree });
  await expect(
    required(manager).request({
      type: "capture",
      ...a.address,
      requestId: randomUUID(),
    }),
  ).rejects.toThrow("ownership or turn changed");
  expect((await reviews.read(a.id)).get(a.id).revisions).toEqual(captured.revisions);
  expect(await readFile(join(root, "a", "file.txt"), "utf8")).toBe("Before\n");
});
it("rejects worker checkout replacement and leaves its saved capture readable", async () => {
  const a = await ready();
  const captured = await capture(a);
  const cwd = a.accepted.record.worktree;
  await rename(cwd, `${cwd}-original`);
  await mkdir(cwd);
  await expect(
    required(manager).request({
      type: "capture",
      ...a.address,
      requestId: randomUUID(),
    }),
  ).rejects.toThrow("saved worker checkout was replaced");
  const loaded = await required(manager).request({
    type: "read",
    ...a.address,
    requestId: randomUUID(),
  });
  expect(loaded).toMatchObject({ type: "review", review: { revisions: captured.revisions } });
});
it("keeps unpinned earlier evidence readable without granting recapture authority", async () => {
  const a = await ready();
  const captured = await capture(a);
  await reviews.write(a.id, (store) =>
    store.mutate(a.id, (review) => {
      for (const worker of review.workers) delete worker.checkout;
    }),
  );
  await expect(
    required(manager).request({
      type: "capture",
      ...a.address,
      requestId: randomUUID(),
    }),
  ).rejects.toThrow("checkout identity is unavailable");
  expect((await reviews.read(a.id)).get(a.id).revisions).toEqual(captured.revisions);
});
it("rejects a replaced native target and checks generation again after human confirmation", async () => {
  const a = await ready();
  const review = await capture(a);
  const revisionId = required(review.revisions.at(-1)?.id);
  const operationId = required((await task(a, { type: "prepare", revisionId })).operation?.id);
  confirm.mockImplementationOnce(async () => {
    owner = { ...owner, generation: owner.generation + 1 };
    return true;
  });
  await expect(task(a, { type: "apply", operationId })).rejects.toThrow("Stale generation");
  owner = { ...owner, generation: a.address.generation };
  await rename(join(root, "a"), join(root, "original-a"));
  await mkdir(join(root, "a"));
  await writeFile(join(root, "a", "file.txt"), "Replacement\n");
  await expect(task(a, { type: "apply", operationId })).rejects.toThrow("replaced or moved");
  expect(await readFile(join(root, "a", "file.txt"), "utf8")).toBe("Replacement\n");
});
it("keeps historical feedback failed and rejects replay or worker-turn reassignment", async () => {
  const a = await ready();
  const review = await capture(a);
  const revisionId = required(review.revisions.at(-1)?.id);
  const commentId = randomUUID();
  const batchId = randomUUID();
  const act = (action: Extract<RelayReviewRequest, { type: "action" }>["action"]) =>
    required(manager).request({ type: "action", ...a.address, action });
  await act({ type: "comment", id: commentId, revisionId, text: "Preserve this behavior" });
  await act({ type: "submit", id: batchId, revisionId });
  expect(feedback).toHaveBeenCalledWith(
    expect.objectContaining({ id: a.id }),
    batchId,
    expect.stringContaining("Preserve this behavior"),
  );
  expect((await reviews.read(a.id)).get(a.id).submissions[0]?.state).toBe("pending");
  await required(manager).beginFeedback(a.id, batchId);
  await required(manager).finishFeedback(a.id, batchId, {
    accepted: true,
    turn: 2,
    runId: "relay-run",
  });
  await expect(act({ type: "retry", id: batchId })).rejects.toThrow("already delivered");
  a.accepted.owner = { ...a.accepted.owner, taskId: randomUUID() };
  await expect(act({ type: "submit", id: randomUUID(), revisionId })).rejects.toThrow(
    "originating task",
  );
  await expect(
    required(manager).request({ type: "capture", ...a.address, requestId: randomUUID() }),
  ).rejects.toThrow("ownership or turn changed");
  expect(
    (await required(manager).request({
      type: "read",
      ...a.address,
      requestId: randomUUID(),
    })) satisfies RelayReviewResponse,
  ).toMatchObject({ type: "review", live: false });
});
async function worker(cwd = join(root, "a"), requestId = "one") {
  return host.dispatch(
    owner,
    {
      cwd,
      requestId,
      workspaceMode: "worktree",
      provider: "claude",
      prompt: "Task",
    },
    DEFAULT_CONFIG,
  );
}
const required = <T>(value: T | undefined | null): T => {
  if (value === undefined || value === null) throw new Error("Missing fixture");
  return value;
};
it("binds an accepted worker to its target and already frozen baseline without recapturing", async () => {
  const accepted = await worker();
  const baseline = required(accepted.record.base);
  await writeFile(join(root, "a", "file.txt"), "Edited after worker dispatch\n");
  const snapshot = vi.spyOn(required(deps.git.tasks), "snapshot");
  const id = required(await reviews.associate(accepted, 1, baseline));
  expect(snapshot).not.toHaveBeenCalled();
  const review = (await reviews.read(id)).get(id);
  expect(review.project).toBe(owner.id);
  expect(review.relay).toMatchObject({
    conversationId: owner.id,
    taskId: owner.taskId,
    generation: owner.generation,
    targetId: accepted.target.id,
    cwd: accepted.target.cwd,
    baseline,
    inode: accepted.target.inode.toString(),
    device: accepted.target.device.toString(),
  });
  expect((await required(await reviews.loop(review)).state(id)).baseline).toBe(baseline);
  expect(review.workers).toMatchObject([{ runId: accepted.id, turn: 1 }]);
  await reviews.associate(accepted, 1, baseline);
  expect((await reviews.index.read()).entries).toHaveLength(1);
});
it("separates task and target groups and keeps old evidence after generation reset", async () => {
  const first = await worker();
  const second = await worker(join(root, "b"), "two");
  const a = required(await reviews.associate(first, 1, required(first.record.base)));
  const b = required(await reviews.associate(second, 1, required(second.record.base)));
  expect(a).not.toBe(b);
  const retasked: ExecutionWorker = { ...first, owner: { ...owner, taskId: randomUUID() } };
  const next = required(await reviews.associate(retasked, 2));
  expect(next).not.toBe(a);
  expect((await reviews.read(a)).get(a).relay?.taskId).toBe(owner.taskId);
  expect(reviews.assignment(first.id)).toMatchObject({ reviewId: next, turn: 2 });
  reviews.reset();
  expect(reviews.assignment(first.id)).toBeUndefined();
  const reopened = await RelayReviewStore.open(reviews.root, owner.id, deps);
  expect(reopened.assignment(first.id)).toBeUndefined();
  expect((await reopened.index.read()).entries).toHaveLength(3);
  expect((await reopened.read(a)).get(a).workers[0]?.turn).toBe(1);
});
it("retains the accepted worker's review link after an index failure without repeating association", async () => {
  const accepted = await worker();
  const append = vi.spyOn(reviews.index, "append").mockRejectedValueOnce(new Error("Index failed"));
  await expect(reviews.associate(accepted, 1, required(accepted.record.base))).rejects.toThrow(
    "Index failed",
  );
  const link = required(reviews.assignment(accepted.id));
  expect((await reviews.read(link.reviewId)).get(link.reviewId).workers).toMatchObject([
    { runId: accepted.id, turn: 1 },
  ]);
  expect(await reviews.associate(accepted, 1, required(accepted.record.base))).toBe(link.reviewId);
  expect(append).toHaveBeenCalledOnce();
  expect(await worker()).toBe(accepted);
  await vi.waitFor(() => expect(agents.specs).toHaveLength(1));
  expect(host.list()).toHaveLength(1);
});
it("splits bounded worker groups without moving earlier workers or losing new assignments", async () => {
  const accepted = await worker();
  const part = (i: number): ExecutionWorker => ({ ...accepted, id: `worker-${i}` });
  const first = required(await reviews.associate(part(0), 1));
  for (let i = 1; i < 100; i++) expect(await reviews.associate(part(i), 1)).toBe(first);
  const second = required(await reviews.associate(part(100), 1));
  expect(second).not.toBe(first);
  expect(await reviews.associate(part(0), 2)).toBe(first);
  expect(await reviews.associate(part(101), 1)).toBe(second);
  expect((await reviews.read(first)).get(first).workers).toHaveLength(100);
  expect((await reviews.read(second)).get(second).workers).toHaveLength(2);
  expect((await reviews.index.read()).entries).toHaveLength(2);
}, 120_000); // 102 private review writes took 32 s on Windows, one helper launch each.
it("does not restore an assignment when a queued association outlives reset", async () => {
  const first = await worker();
  await reviews.associate(first, 1);
  const second = await worker(join(root, "a"), "second");
  const read = reviews.read.bind(reviews);
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(reviews, "read").mockImplementationOnce(async (...args) => {
    enter();
    await held;
    return read(...args);
  });
  const association = reviews.associate(second, 1);
  const result = expect(association).rejects.toThrow("superseded");
  await entered;
  reviews.reset();
  release();
  await result;
  expect(reviews.assignment(first.id)).toBeUndefined();
  expect(reviews.assignment(second.id)).toBeUndefined();
});
it("preserves failed revision feedback when the delivery queue refuses it", async () => {
  const a = await ready();
  const review = await capture(a);
  await writeFile(join(root, "a", "file.txt"), "Conflicting human changes\n");
  const prepared = await task(a, {
    type: "prepare",
    revisionId: required(review.revisions.at(-1)?.id),
  });
  expect(prepared.operation?.conflicts).not.toHaveLength(0);
  feedback.mockImplementationOnce(() => {
    throw new Error("Feedback queue full");
  });
  await expect(
    task(a, {
      type: "revise",
      operationId: required(prepared.operation?.id),
    }),
  ).rejects.toThrow("Feedback queue full");
  const saved = (await reviews.read(a.id)).get(a.id);
  expect(saved.submissions.at(-1)).toMatchObject({ state: "failed", error: "Feedback queue full" });
  expect(reviews.liveSubmissions.size).toBe(0);
});
it("offers no isolated review for a direct worker and rejects a foreign Relay owner", async () => {
  const cwd = join(root, "direct");
  await mkdir(cwd);
  const direct = await host.dispatch(
    owner,
    {
      cwd,
      requestId: "direct",
      workspaceMode: "direct",
      provider: "claude",
      prompt: "Direct task",
    },
    DEFAULT_CONFIG,
  );
  expect(await reviews.associate(direct, 1)).toBeUndefined();
  expect(reviews.assignment(direct.id)).toBeUndefined();
  expect((await reviews.index.read()).entries).toEqual([]);
  const foreign = { ...(await worker()), owner: { ...owner, id: randomUUID() } };
  await expect(reviews.associate(foreign, 1)).rejects.toThrow("another Relay");
});
