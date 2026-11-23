import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SavedChat } from "../bridge/index.js";
import { createRecordStore, defaultDeps, directoryRunsDir, type RunRecord } from "../core/index.js";
import { ChatStore } from "./chat-store.js";
import {
  projectChatRoot,
  projectEvidenceReader,
  type SearchEvidence,
} from "./project-search-reader.js";

let root: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "c60-search-reader-")));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const record = (id: string, path: string, extra: Partial<RunRecord> = {}): RunRecord => ({
  id,
  agent: "claude",
  status: "running",
  firstPrompt: "needle task",
  turns: 1,
  base: null,
  branch: null,
  worktree: path,
  ownerPid: 999999,
  startedAt: "2026-01-01",
  ...extra,
});

it("reads workers and archived project conversations without reconciling or initializing storage", async () => {
  const project = join(root, "project");
  await mkdir(project);
  const deps = defaultDeps();
  deps.git.repoInfo = async () => {
    throw new Error("Not a Git repository");
  };
  const start = vi.spyOn(deps.agents, "start");
  const env = { XDG_STATE_HOME: join(root, "state") };
  const database = join(root, "db.sqlite");
  const runs = directoryRunsDir(env.XDG_STATE_HOME, project);
  const store = createRecordStore(deps.fs, runs);
  await store.save(record("same-run", project));
  await store.appendEvent({
    type: "message",
    runId: "same-run",
    at: "2026-01-01",
    text: "needle one ",
  });
  await store.appendEvent({
    type: "acp",
    runId: "same-run",
    at: "2026-01-01",
    update: "plan",
    payload: "{}",
    size: 2,
  });
  await store.appendEvent({
    type: "message",
    runId: "same-run",
    at: "2026-01-01",
    text: "streamed answer",
  });
  await store.save(record("relay-run", project, { owner: "relay" }));
  await store.appendEvent({
    type: "message",
    runId: "relay-run",
    at: "2026-01-01",
    text: "excluded relay evidence",
  });
  const chat: SavedChat = {
    format: 1,
    directoryId: randomUUID(),
    runId: "archived-chat",
    provider: "claude",
    commandHash: "a".repeat(64),
    archived: true,
    selectedAt: 1,
    tasks: [],
    title: "Archived title",
  };
  const chatStore = new ChatStore(projectChatRoot(database, project));
  await chatStore.save(chat);
  const chatDirectory = join(chatStore.root, chat.directoryId);
  const chatRuns = createRecordStore(deps.fs, join(chatDirectory, ".code60", "runs"));
  await chatRuns.save(record(chat.runId, chatDirectory));
  await chatRuns.appendEvent({
    type: "prompt",
    runId: chat.runId,
    at: "2026-01-01",
    text: "needle archived request",
    turn: 1,
  });
  const before = await readFile(join(runs, "same-run/run.json"));
  const beforeChat = await readFile(join(chatRuns.dir, `${chat.runId}/run.json`));
  const sources: SearchEvidence[] = [];
  const issues: string[] = [];
  await projectEvidenceReader(deps, env, database, new Map())(
    project,
    "needle",
    false,
    new AbortController().signal,
    (s) => sources.push(s),
    (issue) => issues.push(issue),
  );
  expect(issues).toEqual([]);
  expect(sources.some((s) => s.runId === chat.runId && s.kind === "prompt")).toBe(true);
  expect(sources.find((s) => s.runId === "same-run" && s.kind === "message")).toMatchObject({
    text: "needle one streamed answer",
    eventIndex: 0,
  });
  expect(sources.some((s) => s.runId === "relay-run")).toBe(false);
  expect(await readFile(join(runs, "same-run/run.json"))).toEqual(before);
  expect(await readFile(join(chatRuns.dir, `${chat.runId}/run.json`))).toEqual(beforeChat);
  await expect(lstat(join(chatDirectory, "checkpoints"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(start).not.toHaveBeenCalled();
});

it("keeps healthy history/files when a record is corrupt and never creates missing chat directories", async () => {
  const project = join(root, "project");
  await mkdir(project);
  const deps = defaultDeps();
  deps.git.repoInfo = async () => {
    throw new Error("Not a Git repository");
  };
  const env = { XDG_STATE_HOME: join(root, "state") };
  const database = join(root, "db.sqlite");
  const runs = createRecordStore(deps.fs, directoryRunsDir(env.XDG_STATE_HOME, project));
  await runs.save(record("good", project));
  await runs.appendEvent({
    type: "message",
    runId: "good",
    at: "2026-01-01",
    text: "healthy needle",
  });
  await mkdir(join(runs.dir, "broken"));
  await writeFile(join(runs.dir, "broken/run.json"), "{");
  await writeFile(join(project, "README.md"), "needle documentation");
  const chatRoot = projectChatRoot(database, project);
  await mkdir(chatRoot, { recursive: true });
  const sources: SearchEvidence[] = [];
  const issues: string[] = [];
  await projectEvidenceReader(deps, env, database, new Map())(
    project,
    "needle",
    true,
    new AbortController().signal,
    (s) => sources.push(s),
    (issue) => issues.push(issue),
  );
  expect(sources.some((s) => s.kind === "file" && s.path === "README.md")).toBe(true);
  expect(sources.some((s) => s.runId === "good")).toBe(true);
  expect(issues.length).toBeGreaterThan(0);
  await expect(lstat(join(chatRoot, "chats"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(runs.dir, "broken/run.json"), "utf8")).toBe("{");
});

it("respects cancellation before reading project history", async () => {
  const deps = defaultDeps();
  const abort = new AbortController();
  abort.abort();
  await expect(
    projectEvidenceReader(deps, {}, join(root, "db"), new Map())(
      root,
      "needle",
      false,
      abort.signal,
      () => {},
      () => {},
    ),
  ).rejects.toThrow();
});
