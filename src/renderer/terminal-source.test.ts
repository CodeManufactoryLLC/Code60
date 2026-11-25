import { describe, expect, it } from "vitest";
import type { DesktopRun, Snapshot } from "../bridge/index.js";
import type { DesktopState } from "./snapshot-state.js";
import { selectedTerminalSource } from "./terminal-source.js";

const projectUuid = "11111111-1111-4111-8111-111111111111";
const relayUuid = "22222222-2222-4222-8222-222222222222";

function makeState(overrides: Partial<Snapshot> = {}): DesktopState {
  const snapshot = {
    projectInstanceId: projectUuid,
    databaseEpoch: 3,
    directory: "/Users/dev/demo-repo",
    openProjects: [{ id: projectUuid, path: "/Users/dev/demo-repo" }],
    chat: {
      kind: "project",
      projectId: projectUuid,
      conversationId: "chat-1",
      run: null,
      workers: [],
      workerLabels: {},
      events: [],
      error: null,
    },
    chats: [],
    runs: [],
    ...overrides,
  } as unknown as Snapshot;
  return { snapshot } as DesktopState;
}

describe("selectedTerminalSource", () => {
  it("resolves project orchestrator chats to the open project root", () => {
    expect(selectedTerminalSource(makeState(), undefined)).toEqual({
      target: { kind: "project", projectId: projectUuid, databaseEpoch: 3 },
      label: "demo-repo",
    });
  });

  it("resolves Relay and custom assistant chats", () => {
    const state = makeState({
      chat: {
        kind: "relay",
        conversationId: relayUuid,
        generation: 1,
        title: "Researcher",
        run: null,
        workers: [],
        workerLabels: {},
        events: [],
        error: null,
      } as unknown as Snapshot["chat"],
    });
    expect(selectedTerminalSource(state, undefined)).toEqual({
      target: { kind: "relay", conversationId: relayUuid },
      label: "Researcher",
    });
  });

  it("resolves project workers, Relay workers, and flags discarded worktrees", () => {
    const workerRun = {
      record: { id: "run-1", agent: "claude", status: "running", worktree: "/tmp/wt-1" },
    } as unknown as DesktopRun;
    const discardedRun = {
      record: {
        id: "run-2",
        agent: "claude",
        status: "completed",
        discardedAt: "2026-11-25T00:00:00Z",
      },
    } as unknown as DesktopRun;
    const relayWorkerRun = {
      record: { id: "run-3", agent: "codex", status: "running" },
      relay: { conversationId: relayUuid, generation: 2, cwd: "/tmp/other" },
    } as unknown as DesktopRun;
    const state = makeState({ runs: [workerRun, discardedRun, relayWorkerRun] });

    expect(selectedTerminalSource(state, "run-1")).toEqual({
      target: {
        kind: "project-worker",
        runId: "run-1",
        projectId: projectUuid,
        databaseEpoch: 3,
      },
      label: "claude / run-1",
    });
    expect(selectedTerminalSource(state, "run-2")).toMatchObject({
      target: null,
      unavailable: "This agent's worktree was deleted.",
    });
    expect(selectedTerminalSource(state, "run-3")).toEqual({
      target: { kind: "relay-worker", runId: "run-3", conversationId: relayUuid },
      label: "codex / run-3",
    });
  });
});
