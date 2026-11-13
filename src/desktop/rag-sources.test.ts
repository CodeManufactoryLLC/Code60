import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultDeps, openWorkspace, type RunEvent, type RunRecord } from "../core/index.js";
import { mergeRagEvents, ragProjectSources } from "./rag-sources.js";
import type { RagConversation } from "./rag-worker.js";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "code60-rag-sources-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
describe("RAG history snapshot", () => {
  it("deduplicates disk/live copies by multiplicity without dropping repeated chunks", () => {
    const event: RunEvent = { type: "message", runId: "run", at: "now", text: "same" };
    expect(mergeRagEvents([event], [event, event])).toEqual([event, event]);
    const live = {
      type: "acp",
      runId: "run",
      at: "now",
      size: 3,
      payload: { z: 1, a: { b: 2, a: 1 } },
    } as unknown as RunEvent;
    const disk = {
      at: "now",
      runId: "run",
      type: "acp",
      payload: { a: { a: 1, b: 2 }, z: 1 },
      size: 3,
    } as unknown as RunEvent;
    expect(mergeRagEvents([disk], [live, live])).toEqual([disk, live]);
  });
  it("reads all projects plus legacy directory records without reconciling statuses", async () => {
    const deps = defaultDeps();
    const env = { XDG_STATE_HOME: join(directory, "state") };
    const projects = [join(directory, "one"), join(directory, "two")];
    for (const project of projects) await mkdir(project);
    deps.git.repoInfo = async () => {
      throw new Error("Not a Git repository");
    };
    const saved: { path: string; text: string }[] = [];
    for (const [n, project] of projects.entries()) {
      const workspace = await openWorkspace(deps, project, env);
      const record: RunRecord = {
        id: `legacy-${n}`,
        agent: "fixture",
        status: "running",
        firstPrompt: "human",
        turns: 1,
        base: null,
        branch: null,
        worktree: project,
        ownerPid: 99999999,
        startedAt: "2026-01-01T00:00:00Z",
      };
      await workspace.store.save(record);
      await workspace.store.appendEvent({
        type: "prompt",
        runId: record.id,
        at: record.startedAt,
        turn: 1,
        text: "human",
      });
      const path = join(workspace.store.dir, record.id, "run.json");
      saved.push({ path, text: await readFile(path, "utf8") });
    }
    deps.git.repoInfo = async (path) => ({ topLevel: path, commonDir: join(path, ".git") });
    for (const [n, project] of projects.entries()) {
      const workspace = await openWorkspace(deps, project, env);
      await workspace.store.save({
        id: `git-${n}`,
        agent: "fixture",
        status: "finished",
        firstPrompt: "git prompt",
        turns: 1,
        base: "abc",
        branch: "worker",
        worktree: project,
        ownerPid: 99999999,
        startedAt: "2026-01-02T00:00:00Z",
      });
      await workspace.store.appendEvent({
        type: "message",
        runId: `git-${n}`,
        at: "2026-01-02T00:00:00Z",
        text: "reply",
      });
      const record = await workspace.store.read(`git-${n}`);
      await workspace.store.save({ ...record, id: `relay-${n}`, owner: "relay" });
    }
    const sources: RagConversation[] = [];
    await ragProjectSources(deps, env, projects, [], new AbortController().signal, (s) =>
      sources.push(s),
    );
    expect(sources.map((s) => s.source.runId).sort()).toEqual([
      "git-0",
      "git-1",
      "legacy-0",
      "legacy-1",
    ]);
    for (const file of saved) expect(await readFile(file.path, "utf8")).toBe(file.text);
    const workspace = await openWorkspace(deps, projects[0] ?? "", env);
    await writeFile(join(workspace.store.dir, "git-0", "run.json"), "{");
    await expect(
      ragProjectSources(deps, env, projects, [], new AbortController().signal, () => {}),
    ).rejects.toThrow();
  });
  it("rejects missing projects and cancellation", async () => {
    const deps = defaultDeps();
    await expect(
      ragProjectSources(
        deps,
        {},
        [join(directory, "missing")],
        [],
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow();
    const abort = new AbortController();
    abort.abort();
    await expect(
      ragProjectSources(deps, {}, [directory], [], abort.signal, () => {}),
    ).rejects.toThrow();
  });
});
