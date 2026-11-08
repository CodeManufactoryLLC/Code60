import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { DEFAULT_CONFIG, defaultDeps, openWorkspace, prepareRuns } from "../src/core/index.js";
import { ReviewStore } from "../src/desktop/reviews.js";
import { FakeAgents } from "./fakes.js";

let root: string;
let project: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "code60-history-")));
  project = join(root, "project");
  await mkdir(project);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it("required isolation rejects plain and unborn repositories before creating records while CLI defaults still work", async () => {
  const deps = { ...defaultDeps(), agents: new FakeAgents() };
  const env = { XDG_STATE_HOME: join(root, "state") };
  const request = {
    cwd: project,
    env,
    mode: "headless" as const,
    agents: ["claude"],
    prompt: "task",
    requireIsolation: true,
  };
  await expect(prepareRuns(deps, request, DEFAULT_CONFIG)).rejects.toThrow("Set up Git");
  expect(await (await openWorkspace(deps, project, env)).store.list()).toEqual([]);
  await deps.git.setup?.initialize(project);
  await expect(prepareRuns(deps, request, DEFAULT_CONFIG)).rejects.toThrow("Set up Git");
  expect(await (await openWorkspace(deps, project, env)).store.list()).toEqual([]);
  const cli = await prepareRuns(deps, { ...request, requireIsolation: false }, DEFAULT_CONFIG);
  expect(cli.noWorktree).toBe("no_commits");
  cli.orchestrator.start();
  await cli.orchestrator.done;
});
it("keeps old records and events in their original store after initialization and restart", async () => {
  const deps = { ...defaultDeps(), agents: new FakeAgents() };
  const env = { XDG_STATE_HOME: join(root, "state") };
  const old = await prepareRuns(
    deps,
    { cwd: project, env, mode: "headless", agents: ["claude"], prompt: "before Git" },
    DEFAULT_CONFIG,
  );
  old.orchestrator.start();
  await old.orchestrator.done;
  const record = (await old.workspace.store.list())[0];
  if (!record) throw new Error("Missing old run");
  const reviewsRoot = join(root, ".code60_workspace", "reviews");
  const reviews = await ReviewStore.open(reviewsRoot, project);
  const review = await reviews.create("old-chat", 1, "Legacy task");
  await reviews.addWorker(review.id, record.id, "Legacy worker");
  await reviews.capture(review.id, [
    { runId: record.id, error: "No baseline was captured for this run" },
  ]);
  await deps.git.setup?.initialize(project);
  execFileSync("git", ["-C", project, "config", "commit.gpgsign", "false"]);
  await deps.git.setup?.commit(project, [], { name: "Test", email: "test@example.invalid" });
  const desktop = await openWorkspace(deps, project, env, true);
  expect((await desktop.store.list()).map((run) => run.id)).toContain(record.id);
  expect(await desktop.store.readEvents(record.id)).toEqual(
    await old.workspace.store.readEvents(record.id),
  );
  await desktop.store.save({ ...record, reason: "Preserved history" });
  expect((await old.workspace.store.read(record.id)).reason).toBe("Preserved history");
  const next = await prepareRuns(
    deps,
    {
      cwd: project,
      env,
      mode: "headless",
      agents: ["claude"],
      prompt: "after Git",
      requireIsolation: true,
    },
    DEFAULT_CONFIG,
  );
  next.orchestrator.start();
  await next.orchestrator.done;
  const restored = await openWorkspace(deps, project, env, true);
  expect(await restored.store.list()).toHaveLength(2);
  const saved = await ReviewStore.open(reviewsRoot, project);
  expect(saved.get(review.id).workers).toEqual([{ runId: record.id, label: "Legacy worker" }]);
  expect(saved.get(review.id).revisions[0]?.errors[0]?.message).toContain("No baseline");
  expect(await (await openWorkspace(deps, project, env)).store.list()).toHaveLength(1);
});
