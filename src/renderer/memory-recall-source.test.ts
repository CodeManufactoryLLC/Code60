import { expect, it, vi } from "vitest";
import type { DesktopRun, OrchestrationChat, Snapshot } from "../bridge/index.js";
import { selectedRecallSource } from "./memory-recall-source.js";
import type { DesktopState } from "./snapshot-state.js";

const project: OrchestrationChat = {
  kind: "project",
  projectId: "project-a",
  conversationId: "conversation-a",
  generation: 1,
  run: { id: "run-a", turns: 2 },
  workers: ["worker"],
  history: { older: false, incomplete: false },
} as OrchestrationChat;
const relay = {
  ...project,
  kind: "relay",
  conversationId: "relay",
  run: { id: "relay-run", turns: 1 },
} as OrchestrationChat;
const worker = {
  record: { id: "worker", startedAt: "today", turns: 3 },
} as DesktopRun;
function state(chat = project) {
  return {
    snapshot: {
      chat,
      chats: [project, relay],
      projectInstanceId: "project-a",
      databaseEpoch: 1,
      runs: [worker],
      liveIds: ["worker"],
    } as Snapshot,
    chatEventsByRun: { "run-a": [], "relay-run": [] },
  } as unknown as DesktopState;
}
const transcripts = { events: { worker: [] }, errors: {}, retry: vi.fn() };

it("binds project recall to conversation, run, project runtime and database lifecycle", () => {
  const original = selectedRecallSource(state(), undefined, transcripts, "a");
  expect(original).toMatchObject({ runId: "run-a", incomplete: false });
  for (const change of [
    { generation: 2 },
    { conversationId: "conversation-b" },
    { run: { ...project.run, id: "run-b" } },
  ]) {
    expect(
      selectedRecallSource(
        state({ ...project, ...change } as OrchestrationChat),
        undefined,
        transcripts,
        "a",
      )?.owner,
    ).not.toBe(original?.owner);
  }
  const replaced = state();
  replaced.snapshot.databaseEpoch = 2;
  expect(selectedRecallSource(replaced, undefined, transcripts, "a")?.owner).not.toBe(
    original?.owner,
  );
  expect(selectedRecallSource(state(), undefined, transcripts, "replacement-a")?.owner).not.toBe(
    original?.owner,
  );
});

it("keeps Relay independent of the database and selected project but rejects generation replacement", () => {
  const first = state(relay);
  const original = selectedRecallSource(first, undefined, transcripts, "project-a");
  first.snapshot.databaseEpoch = 99;
  first.snapshot.projectInstanceId = "project-b";
  first.snapshot.database = null;
  expect(selectedRecallSource(first, undefined, transcripts, "project-b")?.owner).toBe(
    original?.owner,
  );
  first.snapshot.chat = { ...relay, generation: 2 };
  expect(selectedRecallSource(first, undefined, transcripts, "project-b")?.owner).not.toBe(
    original?.owner,
  );
});

it("uses the displayed worker's events rather than the selected orchestrator's events", () => {
  const value = selectedRecallSource(state(relay), "worker", transcripts, "project");
  expect(value).toMatchObject({
    runId: "worker",
    incomplete: false,
    loading: false,
  });
  expect(value?.events).toBe(transcripts.events.worker);
  const replaced = state();
  replaced.snapshot.chats = [{ ...project, generation: 2 }, relay];
  expect(selectedRecallSource(replaced, "worker", transcripts, "project")?.owner).not.toBe(
    value?.owner,
  );
  expect(selectedRecallSource(state(), "missing", transcripts, "project")).toBeUndefined();
  expect(selectedRecallSource(undefined, undefined, transcripts, "project")).toBeUndefined();
});

it("keeps Relay-worker identity independent of database changes and includes target, task and generation", () => {
  const current = state(relay);
  const provenance: NonNullable<DesktopRun["relay"]> = {
    conversationId: "relay",
    generation: 1,
    targetId: "target",
    taskId: "task",
    cwd: "/synthetic",
    workspaceMode: "direct",
  };
  current.snapshot.runs = [{ ...worker, relay: provenance }];
  const owner = selectedRecallSource(current, "worker", transcripts, "a")?.owner;
  current.snapshot.databaseEpoch = 5;
  expect(selectedRecallSource(current, "worker", transcripts, "b")?.owner).toBe(owner);
  for (const change of [{ generation: 2 }, { targetId: "replacement" }, { taskId: "new-task" }]) {
    current.snapshot.runs = [{ ...worker, relay: { ...provenance, ...change } }];
    expect(selectedRecallSource(current, "worker", transcripts, "b")?.owner).not.toBe(owner);
  }
});

it("labels missing/truncated history and exposes the existing transcript Retry", () => {
  const current = state();
  current.snapshot.runs = [{ ...worker, historyIncomplete: true }];
  current.snapshot.liveIds = [];
  expect(
    selectedRecallSource(current, "worker", { ...transcripts, events: {} }, "a"),
  ).toMatchObject({ loading: true, incomplete: true });
  const failed = selectedRecallSource(
    current,
    "worker",
    { ...transcripts, events: {}, errors: { worker: "failed" } },
    "a",
  );
  expect(failed).toMatchObject({ error: true, loading: false });
  failed?.retry?.();
  expect(transcripts.retry).toHaveBeenCalledOnce();
  current.snapshot.chat = { ...project, restored: true };
  expect(selectedRecallSource(current, undefined, transcripts, "a")?.incomplete).toBe(true);
  current.snapshot.chat = { ...project, run: null };
  expect(selectedRecallSource(current, undefined, transcripts, "a")).toBeUndefined();
});

it("labels prior Relay history without inventing recalled records from text-only restored messages", () => {
  const current = state(relay);
  current.snapshot.chat = {
    ...relay,
    history: {
      serialized: "Saved messages without recall annotations",
      characters: 100,
      older: false,
      incomplete: false,
      cursor: null,
    },
  };
  const source = selectedRecallSource(current, undefined, transcripts, "a");
  expect(source?.incomplete).toBe(true);
  expect(source?.events).toEqual([]);
});
