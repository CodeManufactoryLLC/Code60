import { expect, it } from "vitest";
import {
  type DesktopRun,
  type DetailFrame,
  detailScopeKey,
  type OrchestrationChat,
  type Snapshot,
} from "../bridge/index.js";
import { applyDetails, requestedDetails } from "./scoped-details.js";
import { applyUpdate } from "./snapshot-state.js";

const projectId = "ecbf4965-efc3-48ea-bd30-02738cc2d2dc";
const chat = {
  kind: "project",
  projectId,
  generation: 1,
  run: { id: "chat" },
  events: [],
  plans: [],
  directory: "/a",
  updates: { paused: false, pending: 0 },
  error: null,
} as unknown as OrchestrationChat;
const snapshot = {
  revision: 100,
  database: "/db",
  databaseEpoch: 2,
  projectInstanceId: projectId,
  directory: "/a",
  runs: [],
  events: [],
  chat,
  chats: [chat],
  openProjects: [{ id: projectId, path: "/a" }],
} as unknown as Snapshot;
const detail = (): DetailFrame => ({
  subscriptionId: "subscription",
  scope: {
    kind: "conversation",
    conversationId: "chat",
    generation: 1,
    projectId,
    databaseEpoch: 2,
  },
  revision: 5,
  previousRevision: null,
  closed: false,
  payload: {
    kind: "conversation",
    chat: {
      ...chat,
      events: [{ revision: 5, event: { type: "message", runId: "chat", at: "", text: "A reply" } }],
    },
  },
});
const relay = {
  ...chat,
  kind: "relay",
  conversationId: "relay",
  generation: 3,
  run: { ...chat.run, id: "relay-run" },
} as OrchestrationChat;
const worker = (id = "worker-a", targetId = "target-a"): DesktopRun =>
  ({
    record: { id, firstPrompt: "", status: "running" },
    relay: {
      conversationId: "relay",
      generation: 3,
      taskId: "task",
      targetId,
      cwd: `/targets/${targetId}`,
      workspaceMode: "direct",
    },
  }) as DesktopRun;
it("requests only the selected Relay worker target and refuses historical generations", () => {
  const state = applyUpdate(undefined, {
    ...snapshot,
    summaryOnly: true,
    chat: relay,
    chats: [relay],
    runs: [worker(), worker("worker-b", "target-b")],
  });
  expect(requestedDetails(state, "worker-a")).toEqual([
    { kind: "project", projectId, databaseEpoch: 2 },
    { kind: "target", targetId: "target-a", conversationId: "relay", generation: 3 },
  ]);
  const stale = worker();
  if (!stale.relay) throw new Error("fixture");
  stale.relay.generation = 2;
  expect(
    requestedDetails({ ...state, snapshot: { ...state.snapshot, runs: [stale] } }, "worker-a"),
  ).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: "target" })]));
});
it("hydrates target events independently of app revisions without regressing pushed status or crossing targets", () => {
  const state = applyUpdate(undefined, {
    ...snapshot,
    summaryOnly: true,
    chat: relay,
    chats: [relay],
    runs: [worker(), worker("worker-b", "target-b")],
    liveIds: ["worker-a", "worker-b"],
  });
  const frame: DetailFrame = {
    subscriptionId: "target-view",
    scope: { kind: "target", targetId: "target-a", conversationId: "relay", generation: 3 },
    revision: 5,
    previousRevision: null,
    closed: false,
    payload: {
      kind: "target",
      targetId: "target-a",
      cwd: "/targets/target-a",
      runs: [
        {
          ...worker(),
          record: { ...worker().record, status: "idle", firstPrompt: "Original prompt" },
        },
      ],
      events: [
        { revision: 1, event: { type: "message", runId: "worker-a", at: "", text: "Owned reply" } },
        {
          revision: 2,
          event: { type: "message", runId: "worker-b", at: "", text: "Other target" },
        },
      ],
    },
  };
  const frames = { [detailScopeKey(frame.scope)]: frame };
  const next = applyDetails(state, frames);
  expect(next?.events["worker-a"]).toMatchObject([{ text: "Owned reply" }]);
  expect(next?.events["worker-b"]).toEqual(state.events["worker-b"]);
  expect(next?.snapshot.runs[0]?.record).toMatchObject({
    status: "running",
    firstPrompt: "Original prompt",
  });
  const replaced = { ...relay, generation: 4 };
  expect(
    applyDetails(
      { ...state, snapshot: { ...state.snapshot, chat: replaced, chats: [replaced] } },
      frames,
    )?.events["worker-a"],
  ).toEqual(state.events["worker-a"]);
});
it("does not let summary metadata advance a project detail fence or clear requested content", () => {
  const state = applyUpdate(undefined, { ...snapshot, summaryOnly: true });
  const frame: DetailFrame = {
    subscriptionId: "project-view",
    scope: { kind: "project", projectId, databaseEpoch: 2 },
    revision: 5,
    previousRevision: null,
    closed: false,
    payload: {
      kind: "project",
      projectId,
      databaseEpoch: 2,
      directory: "/a",
      runs: [],
      liveIds: [],
      events: [
        {
          revision: 5,
          event: { type: "message", runId: "project-worker", at: "", text: "Project reply" },
        },
      ],
      worktrees: { repository: "/a", worktrees: [] },
      files: null,
      reviews: [],
    },
  };
  const frames = { [detailScopeKey(frame.scope)]: frame };
  expect(state.projectViews?.[projectId]?.revision).toBe(-1);
  const advanced = applyUpdate(state, { ...snapshot, summaryOnly: true, revision: 200 });
  const merged = applyDetails(advanced, frames);
  expect(merged?.events["project-worker"]).toMatchObject([{ text: "Project reply" }]);
  expect(merged?.snapshot.worktrees?.repository).toBe("/a");
  expect(merged?.snapshot.revision).toBe(200);
});
it("requests explicit selected project/conversation identities and never invents an epoch or legacy authority", () => {
  expect(requestedDetails(undefined)).toEqual([]);
  const state = applyUpdate(undefined, snapshot);
  const legacy: OrchestrationChat = { ...chat, kind: "legacy" };
  delete legacy.projectId;
  expect(requestedDetails(state)).toEqual([
    { kind: "project", projectId, databaseEpoch: 2 },
    { kind: "conversation", conversationId: "chat", generation: 1, projectId, databaseEpoch: 2 },
  ]);
  expect(
    requestedDetails({
      ...state,
      snapshot: {
        ...snapshot,
        projectInstanceId: null,
        chat: legacy,
      },
    }),
  ).toEqual([]);
  const relay = { ...chat, kind: "relay", conversationId: "relay" } as OrchestrationChat;
  expect(
    requestedDetails({
      ...state,
      snapshot: { ...snapshot, projectInstanceId: null, database: null, chat: relay },
    }),
  ).toEqual([{ kind: "conversation", conversationId: "relay", generation: 1 }]);
});
it("merges detail revisions independently of app revisions and refuses stale generations/epochs", () => {
  const state = applyUpdate(undefined, snapshot);
  const frame = detail();
  const frames = { [detailScopeKey(frame.scope)]: frame };
  const merged = applyDetails(state, frames);
  expect(merged?.chatEvents).toMatchObject([{ text: "A reply" }]);
  expect(merged?.snapshot.revision).toBe(100);
  expect(
    applyDetails({ ...state, snapshot: { ...snapshot, databaseEpoch: 3 } }, frames)?.chatEvents,
  ).toEqual([]);
  expect(
    applyDetails({ ...state, snapshot: { ...snapshot, chat: { ...chat, generation: 2 } } }, frames)
      ?.chatEvents,
  ).toEqual([]);
  expect(applyDetails(undefined, frames)).toBeUndefined();
  expect(
    applyDetails(state, { [detailScopeKey(frame.scope)]: { ...frame, closed: true } })?.chatEvents,
  ).toEqual([]);
});
it("does not replace newer pushed conversation events with a cached pre-navigation detail", () => {
  const newer = {
    ...chat,
    events: [
      {
        revision: 80,
        event: { type: "message" as const, runId: "chat", at: "", text: "New reply" },
      },
    ],
  };
  const state = applyUpdate(undefined, { ...snapshot, chat: newer, chats: [newer] });
  const frame = detail();
  expect(applyDetails(state, { [detailScopeKey(frame.scope)]: frame })?.chatEvents).toMatchObject([
    { text: "New reply" },
  ]);
});

it("retains inactive conversation details without changing selection and drops closed owners", () => {
  const other: OrchestrationChat = {
    ...chat,
    projectId: "other-project",
    run: { ...chat.run, id: "other-chat" } as NonNullable<OrchestrationChat["run"]>,
  };
  const state = applyUpdate(undefined, { ...snapshot, chat: other, chats: [chat, other] });
  const frame = detail();
  const frames = { [detailScopeKey(frame.scope)]: frame };
  expect(applyDetails(state, frames)?.chatEventsByRun.chat).toMatchObject([{ text: "A reply" }]);
  expect(applyDetails(state, frames)?.snapshot.chat.run?.id).toBe("other-chat");
  expect(applyDetails(state, frames)?.chatEvents).toEqual([]);
  const closed = applyUpdate(state, {
    ...snapshot,
    revision: 101,
    chat: other,
    chats: [other],
    openProjects: [],
  });
  expect(applyDetails(closed, frames)?.chatEventsByRun.chat).toBeUndefined();
});

it("does not replace newer pushed background plan progress with a pre-navigation detail cache", () => {
  const currentPlan = {
    id: "plan",
    chatId: "chat",
    project: "/a",
    title: "Revised plan",
    revision: 3,
    proposalRevision: 2,
    state: "completed" as const,
    completed: 2,
    total: 2,
  };
  const other = { ...chat, run: { ...chat.run, id: "other-chat" } } as OrchestrationChat;
  const state = applyUpdate(undefined, {
    ...snapshot,
    chat: other,
    chats: [{ ...chat, plans: [currentPlan] }, other],
  });
  const frame = detail();
  const merged = applyDetails(state, { [detailScopeKey(frame.scope)]: frame });
  expect(merged?.snapshot.chats[0]?.plans).toEqual([currentPlan]);
  expect(merged?.chatEventsByRun.chat).toMatchObject([{ text: "A reply" }]);
});

it("does not publish plan revisions ahead of the app's atomic selection/summary frame", () => {
  const state = applyUpdate(undefined, snapshot);
  const frame = detail();
  if (frame.closed || frame.payload.kind !== "conversation") throw new Error("fixture");
  frame.revision = 101;
  frame.payload.chat.plans = [
    {
      id: "background-plan",
      chatId: "chat",
      project: "/a",
      title: "Background revision",
      revision: 2,
      proposalRevision: 2,
      state: "draft",
      completed: 0,
      total: 2,
    },
  ];
  const merged = applyDetails(state, { [detailScopeKey(frame.scope)]: frame });
  expect(merged?.snapshot.chat.plans).toEqual([]);
  expect(merged?.chatEvents).toMatchObject([{ text: "A reply" }]);
});

it("merges requested project details into only their owning retained view", () => {
  const state = applyUpdate(undefined, snapshot);
  const frame: DetailFrame = {
    subscriptionId: "project-subscription",
    scope: { kind: "project", projectId, databaseEpoch: 2 },
    revision: 101,
    previousRevision: null,
    closed: false,
    payload: {
      kind: "project",
      projectId,
      databaseEpoch: 2,
      directory: "/a",
      runs: [],
      liveIds: [],
      worktrees: null as unknown as Snapshot["worktrees"],
      files: null,
      reviews: [],
      events: [
        {
          revision: 101,
          event: { type: "message", runId: "worker-a", at: "", text: "A worker reply" },
        },
      ],
    },
  };
  const frames = { [detailScopeKey(frame.scope)]: frame };
  expect(applyDetails(state, frames)?.events["worker-a"]).toMatchObject([
    { text: "A worker reply" },
  ]);
  const other = {
    ...state,
    snapshot: { ...snapshot, revision: 150, projectInstanceId: "other-project", directory: "/b" },
  };
  const retained = applyDetails(other, frames);
  expect(retained?.events["worker-a"]).toBeUndefined();
  expect(retained?.projectViews?.[projectId]?.events["worker-a"]).toMatchObject([
    { text: "A worker reply" },
  ]);
  expect(retained?.snapshot.directory).toBe("/b");
});
