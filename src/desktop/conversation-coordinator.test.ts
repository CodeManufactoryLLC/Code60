import { afterEach, describe, expect, it, vi } from "vitest";
import type { Orchestrator, RunView } from "../core/index.js";
import { ConversationCoordinator } from "./conversation-coordinator.js";
import { captureTask } from "./tactic-context.js";

function harness() {
  let directory = "/project";
  const chat = { id: "chat", status: "idle", stopping: false } as RunView;
  const worker = { id: "worker", status: "idle", turns: 1, stopping: false } as RunView;
  let dispatch = true;
  const deliver = vi.fn(() => {
    if (chat.status !== "idle") throw new Error("not ready");
    chat.status = "running";
    return Promise.resolve(dispatch);
  });
  const coordinator = new ConversationCoordinator({
    directory: () => directory,
    view: (id) => (id === "worker" || id === "other" ? worker : undefined),
    closing: () => false,
    changed: vi.fn(),
    formatUpdates: JSON.stringify,
    deliver,
  });
  const session = coordinator.current;
  session.chat = { runs: () => [chat] } as Orchestrator;
  coordinator.register("worker", session, directory, "claude");
  const end = () =>
    coordinator.trackWorker({
      type: "status",
      runId: "worker",
      at: "2026-01-01",
      status: "idle",
      reason: "turn 1 ended",
    });
  return {
    coordinator,
    session,
    chat,
    worker,
    deliver,
    end,
    refuse: () => {
      dispatch = false;
    },
    project: (value: string) => {
      directory = value;
    },
  };
}
afterEach(() => vi.useRealTimers());

describe("conversation coordination", () => {
  it("keeps worker updates queued and pauses delivery when the chat refuses dispatch", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.refuse();
    h.end();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.deliver).toHaveBeenCalledTimes(1);
    expect(h.session.inbox).toHaveLength(1);
    expect(h.session.updatesPaused).toBe(true);
    expect(h.session.chatError).toContain("did not accept");
  });
  it("retains task tactics across new human requests and groups interleaved updates by originating task", async () => {
    vi.useFakeTimers();
    const h = harness();
    const original = captureTask("implement-and-review", "Original implementation", 1, "/project");
    const newer = captureTask("explore-the-codebase", "New exploration", 2, "/project");
    h.session.tasks.push(original, newer);
    h.session.taskId = original.id;
    h.coordinator.register("worker", h.session, "/project", "claude", "Implementer");
    h.coordinator.trackWorker({
      type: "prompt",
      runId: "worker",
      at: "now",
      turn: 1,
      text: "Build",
    });
    h.end();
    h.session.taskId = newer.id;
    h.session.tactic = null;
    h.coordinator.register("other", h.session, "/project", "claude", "Code scout");
    h.coordinator.trackWorker({
      type: "status",
      runId: "other",
      at: "now",
      status: "failed",
      reason: "unavailable",
    });
    h.coordinator.trackWorker({
      type: "prompt",
      runId: "worker",
      at: "now",
      turn: 2,
      text: "Correct",
    });
    h.worker.turns = 2;
    h.coordinator.trackWorker({
      type: "status",
      runId: "worker",
      at: "now",
      status: "idle",
      reason: "turn 2 ended",
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(h.deliver).toHaveBeenNthCalledWith(
      1,
      h.session,
      expect.any(String),
      "automatic",
      expect.stringContaining("Original implementation"),
    );
    expect(h.deliver).toHaveBeenNthCalledWith(
      1,
      h.session,
      expect.any(String),
      "automatic",
      expect.stringContaining("two correction rounds"),
    );
    expect(h.deliver).toHaveBeenNthCalledWith(
      1,
      h.session,
      expect.any(String),
      "automatic",
      expect.not.stringContaining("New exploration"),
    );
    expect(h.session.inbox).toHaveLength(1);
    expect(h.session.taskId).toBe(original.id);
    expect(original.workers).toMatchObject([
      { runId: "worker", turn: 1, label: "Implementer" },
      { runId: "worker", turn: 2 },
    ]);
    h.chat.status = "idle";
    h.coordinator.scheduleUpdates();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.deliver).toHaveBeenNthCalledWith(
      2,
      h.session,
      expect.any(String),
      "automatic",
      expect.stringContaining("New exploration"),
    );
    expect(h.deliver).toHaveBeenNthCalledWith(
      2,
      h.session,
      expect.any(String),
      "automatic",
      expect.stringContaining("unavailable"),
    );
    expect(h.session.taskId).toBe(newer.id);
    h.coordinator.stop();
  });

  it("holds worker updates while task context is being persisted", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.session.deliveryPending = true;
    h.end();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.deliver).not.toHaveBeenCalled();
    h.session.deliveryPending = false;
    h.coordinator.scheduleUpdates();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.deliver).toHaveBeenCalledOnce();
    h.coordinator.stop();
  });
  it("retains dispatch role labels without inventing labels for older workers", () => {
    const h = harness();
    expect(h.coordinator.ownedWorker("worker", h.session)).not.toHaveProperty("label");
    h.coordinator.register("worker", h.session, "/project", "claude", "Market researcher");
    expect(h.coordinator.ownedWorker("worker", h.session)).toMatchObject({
      provider: "claude",
      label: "Market researcher",
    });
    h.coordinator.stop();
  });

  it("rejects missing project scope and sends without an available orchestration run", () => {
    const h = harness();
    h.project("");
    expect(() => h.coordinator.requireScope(h.session.workerScope, h.session)).toThrow(
      "Open a project",
    );
    h.session.chat = undefined;
    expect(() => h.coordinator.send(h.session, "/plan A request")).toThrow(
      "No orchestration session",
    );
    h.session.chat = { runs: () => [] } as unknown as Orchestrator;
    expect(() => h.coordinator.send(h.session, "A request")).toThrow("No orchestration session");
    expect(h.deliver).not.toHaveBeenCalled();
    h.coordinator.stop();
  });

  it("keeps worker authority in the owning generation and project", () => {
    const h = harness();
    expect(h.coordinator.ownedWorker("worker", h.session).provider).toBe("claude");
    expect(() => h.coordinator.assertCapacity(h.session, 1)).toThrow("slots are in use");
    const other = h.coordinator.create();
    expect(() => h.coordinator.ownedWorker("worker", other)).toThrow("No worker");
    const oldScope = h.session.workerScope;
    h.coordinator.rotateScopes();
    expect(() => h.coordinator.requireScope(oldScope, h.session)).toThrow("stale");
    h.project("/other");
    expect(() => h.coordinator.ownedWorker("worker", h.session)).toThrow("No worker");
    h.coordinator.revoke(h.session);
    expect(() => h.coordinator.send(h.session, "hello")).toThrow("no longer current");
    expect(h.deliver).not.toHaveBeenCalled();
  });

  it("coalesces worker updates and sends only between turns, respecting pause and human sends", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.chat.status = "running";
    h.end();
    h.end();
    expect(h.session.inbox).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(h.deliver).not.toHaveBeenCalled();
    expect(() => h.coordinator.send(h.session, "too early")).toThrow("not ready");
    h.deliver.mockClear();
    h.coordinator.pause(h.session);
    h.chat.status = "idle";
    h.coordinator.scheduleUpdates();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.deliver).not.toHaveBeenCalled();
    h.coordinator.send(h.session, "human message");
    expect(h.session.updatesPaused).toBe(false);
    h.coordinator.scheduleUpdates();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.deliver).toHaveBeenCalledTimes(1);
    h.chat.status = "idle";
    h.coordinator.scheduleUpdates();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.deliver).toHaveBeenCalledTimes(2);
    expect(h.deliver.mock.calls[1]).toEqual([
      h.session,
      expect.stringContaining("worker"),
      "automatic",
      undefined,
    ]);
    expect(h.session.inbox).toHaveLength(0);
    h.coordinator.stop();
  });

  it("passes command expansion separately from the literal human message", () => {
    const h = harness();
    h.coordinator.send(h.session, "/review My changes", undefined, "Inspect my changes.");
    expect(h.deliver).toHaveBeenCalledExactlyOnceWith(
      h.session,
      "/review My changes",
      undefined,
      "Inspect my changes.",
    );
    h.coordinator.stop();
  });

  it("holds automatic updates while a harness mode change is pending", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.chat.modeChanging = true;
    h.end();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.deliver).not.toHaveBeenCalled();
    expect(h.session.inbox).toHaveLength(1);
    h.chat.modeChanging = false;
    h.coordinator.scheduleUpdates();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.deliver).toHaveBeenCalledTimes(1);
    expect(h.session.inbox).toHaveLength(0);
    h.coordinator.stop();
  });

  it("keeps failed automatic delivery visible and clears pending work on revocation", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.deliver.mockImplementationOnce(() => {
      throw new Error("delivery failed");
    });
    h.end();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.session.chatError).toContain("delivery failed");
    expect(h.session.inbox).toHaveLength(1);
    h.coordinator.scheduleUpdates();
    h.coordinator.revoke(h.session);
    await vi.advanceTimersByTimeAsync(50);
    expect(h.session.inbox).toHaveLength(0);
    expect(h.deliver).toHaveBeenCalledTimes(1);
    h.coordinator.stop();
  });

  it("reports receipt only after successful delivery, never while a result is queued", async () => {
    vi.useFakeTimers();
    const h = harness();
    const received = vi.spyOn(h.session.activity, "received");
    h.chat.status = "running";
    h.end();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.session.inbox).toHaveLength(1);
    expect(received).not.toHaveBeenCalled();
    h.chat.status = "idle";
    h.deliver.mockImplementationOnce(() => {
      throw new Error("not delivered");
    });
    h.coordinator.scheduleUpdates();
    await vi.advanceTimersByTimeAsync(50);
    expect(received).not.toHaveBeenCalled();
    h.coordinator.scheduleUpdates();
    await vi.advanceTimersByTimeAsync(50);
    expect(received).toHaveBeenCalledTimes(1);
    expect(h.session.inbox).toHaveLength(0);
    h.coordinator.stop();
  });

  it("deduplicates dispatches and permits retry after a failed start", async () => {
    const h = harness();
    const start = vi.fn(async () => "accepted");
    const first = h.coordinator.deduplicate(h.session, "request", "same", start);
    expect(h.coordinator.deduplicate(h.session, "request", "same", start)).toBe(first);
    await expect(
      h.coordinator.deduplicate(h.session, "request", "different", start),
    ).rejects.toThrow("other arguments");
    expect(await first).toBe("accepted");
    expect(start).toHaveBeenCalledTimes(1);
    const fails = () => Promise.reject(new Error("failed"));
    await expect(h.coordinator.deduplicate(h.session, "retry", "same", fails)).rejects.toThrow(
      "failed",
    );
    expect(await h.coordinator.deduplicate(h.session, "retry", "same", start)).toBe("accepted");
  });
});
