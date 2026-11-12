import { describe, expect, it, vi } from "vitest";
import { OrchestratorActions } from "./orchestrator-actions.js";
import { WorkerActions } from "./worker-actions.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<undefined>((yes, no) => {
    resolve = () => yes(undefined);
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("separate chat action owners", () => {
  it("serializes orchestrator actions, forwards captured identity and exposes failures", async () => {
    const pending = deferred();
    const api = { orchestrationChatAction: vi.fn(() => pending.promise) };
    const owner = new OrchestratorActions(api, "db/chat", true);
    const request = { type: "select", id: "chat-a" } as const;
    const result = owner.action(request);
    expect(owner.snapshot().pending).toBe("select");
    expect(await owner.action({ type: "select", id: "chat-b" })).toBe(false);
    expect(api.orchestrationChatAction).toHaveBeenCalledExactlyOnceWith(request);
    pending.reject(new Error("Retry selection"));
    expect(await result).toBe(false);
    expect(owner.snapshot()).toEqual({ pending: null, error: "Retry selection" });
  });
  it("does not send disconnected or disposed conversations", async () => {
    const api = { orchestrationChatAction: vi.fn(async () => {}) };
    const disconnected = new OrchestratorActions(api, "none", false);
    expect(await disconnected.action({ type: "select", id: "chat" })).toBe(false);
    const disposed = new OrchestratorActions(api, "db/chat", true);
    disposed.dispose();
    expect(await disposed.action({ type: "select", id: "chat" })).toBe(false);
    expect(api.orchestrationChatAction).not.toHaveBeenCalled();
  });
  it("invalidates old sends across disposal and effect replay without leaving pending stuck", async () => {
    const pending = deferred();
    const api = {
      orchestrationChatAction: vi
        .fn()
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValue(undefined),
    };
    const owner = new OrchestratorActions(api, "db/chat-a", true);
    const stale = owner.action({ type: "select", id: "chat-a" });
    owner.dispose();
    owner.activate();
    expect(await owner.action({ type: "select", id: "chat-b" })).toBe(true);
    pending.reject(new Error("Old failure"));
    expect(await stale).toBe(false);
    expect(owner.snapshot()).toEqual({ pending: null, error: "" });
  });
  it("keeps worker progress independent and never invents recovery actions", async () => {
    const pending = deferred();
    const api = { action: vi.fn(() => pending.promise) };
    const worker = new WorkerActions(api, "worker-a");
    const result = worker.act({ type: "stop", id: "worker-a" });
    expect(worker.snapshot().busy).toBe(true);
    expect(await worker.act({ type: "stop", id: "worker-b" })).toBe(false);
    pending.resolve();
    expect(await result).toBe(true);
    expect(api.action).toHaveBeenCalledExactlyOnceWith({ type: "stop", id: "worker-a" });
    expect(worker.snapshot()).toEqual({ busy: false, error: "" });
  });
  it("reports worker failure and discards late completion after A to B to A", async () => {
    const pending = deferred();
    const api = {
      action: vi
        .fn()
        .mockReturnValueOnce(pending.promise)
        .mockRejectedValue(new Error("Worker unavailable")),
    };
    const old = new WorkerActions(api, "worker-a");
    const stale = old.act({ type: "stop", id: "worker-a" });
    old.dispose();
    const next = new WorkerActions(api, "worker-a");
    expect(await next.act({ type: "stop", id: "worker-a" })).toBe(false);
    expect(next.snapshot()).toEqual({ busy: false, error: "Worker unavailable" });
    pending.reject(new Error("Old failure"));
    expect(await stale).toBe(false);
    expect(old.snapshot()).toEqual({ busy: false, error: "" });
    expect(next.snapshot().error).toBe("Worker unavailable");
  });
});
