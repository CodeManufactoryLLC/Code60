import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTIVITY_LIFETIME_MS, parseActivityContextArgs } from "../bridge/index.js";
import type { RunEvent, RunView } from "../core/index.js";
import { ActivityDisplay } from "./activity-display.js";

function harness() {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  let generation = 0;
  const changed = vi.fn();
  const display = new ActivityDisplay({
    changed,
    now: () => Date.now(),
    newScope: () => `scope-${++generation}`,
  });
  const run = { id: "chat", status: "running", turns: 1, stopping: false } as RunView;
  const emit = (body: Omit<RunEvent, "runId" | "at">) =>
    display.event({ runId: "chat", at: "2026-11-08", ...body } as RunEvent);
  const start = () => emit({ type: "prompt", turn: 1, text: "work" } as RunEvent);
  const tool = (id: string, kind = "search", status = "in_progress") =>
    emit({
      type: "toolCall",
      toolCallId: id,
      kind,
      status,
      title: "Not used for classification",
    } as RunEvent);
  const report = (sequence = 1, label = "Check cancellation") => ({
    scope: display.context().scope,
    sequence,
    operation: "set",
    activityType: "verifying",
    label,
  });
  const snapshot = () => display.snapshot(run, null, 0);
  start();
  return { display, run, emit, start, tool, report, snapshot, changed };
}
afterEach(() => vi.useRealTimers());

describe("live activity display", () => {
  it("discovers semantic types, validates strict reports and returns no visual metadata", () => {
    const h = harness();
    const context = h.display.context();
    expect(context.activityTypes).toContainEqual({
      type: "testing",
      description: "Running tests.",
    });
    expect(JSON.stringify(context)).not.toMatch(/animation|asset|filename|preview/);
    expect(() => parseActivityContextArgs({ extra: true })).toThrow();
    for (const fields of [
      { label: "" },
      { label: " " },
      { label: "x".repeat(161) },
      { label: "line\nbreak" },
      { label: "hello\u001b" },
      { sequence: 0 },
      { sequence: 1.5 },
      { sequence: "1" },
      { activityType: "passed" },
      { animation: "custom.gif" },
      { scope: "old" },
    ]) {
      expect(() => h.display.report({ ...h.report(), ...fields })).toThrow();
    }
    expect(() => h.display.report({ ...h.report(), activityType: "unknown" })).toThrow(
      "get_activity_context",
    );
    h.display.report(h.report());
    expect(h.snapshot()).toMatchObject({
      state: "verifying",
      source: "declared",
      label: "Check cancellation",
    });
  });

  it("replaces, clears and deduplicates without renewing a retry, including after expiry", () => {
    const h = harness();
    const request = h.report();
    const acknowledgment = h.display.report(request);
    vi.advanceTimersByTime(50_000);
    expect(h.display.report(request)).toEqual(acknowledgment);
    expect(() => h.display.report({ ...request, label: "different" })).toThrow("sequence");
    vi.advanceTimersByTime(ACTIVITY_LIFETIME_MS - 50_000);
    expect(h.snapshot()).toMatchObject({ state: "working", declaration: null });
    expect(h.display.report(request)).toEqual(acknowledgment);
    expect(h.display.context().declaration).toBeNull();
    h.display.report(h.report(2, "Compare results"));
    expect(h.snapshot().label).toBe("Compare results");
    expect(() => h.display.report(request)).toThrow("sequence");
    expect(h.display.report({ scope: request.scope, sequence: 3, operation: "clear" })).toEqual({
      sequence: 3,
      expiresAt: null,
    });
    expect(h.snapshot().declaration).toBeNull();
  });

  it("prioritizes observed work without promoting execution to verified testing", () => {
    const h = harness();
    h.display.report({ ...h.report(), activityType: "testing" });
    h.tool("test", "execute");
    expect(h.snapshot()).toMatchObject({
      state: "executing",
      label: "Running command",
      source: "observed",
      declaration: { activityType: "testing" },
    });
    h.run.status = "waiting";
    expect(h.snapshot()).toMatchObject({ state: "waiting_for_approval", urgent: true });
    h.run.status = "running";
    h.tool("test", "execute", "completed");
    h.tool("fetch", "fetch");
    expect(h.snapshot().state).toBe("retrieving");
    h.run.stopping = true;
    expect(h.snapshot().state).toBe("stopping");
    expect(h.display.snapshot(h.run, "connection lost", 2).state).toBe("failed");
  });

  it("tracks concurrent IDs and keeps original start order across updates", () => {
    const h = harness();
    h.tool("first");
    h.tool("second", "read", "pending");
    expect(h.snapshot()).toMatchObject({ state: "preparing", otherOperations: 1 });
    h.tool("first");
    expect(h.snapshot().state).toBe("preparing");
    h.tool("second", "read");
    expect(h.snapshot().state).toBe("reading");
    h.tool("second", "read", "failed");
    expect(h.snapshot()).toMatchObject({ state: "searching", otherOperations: 0 });
    vi.advanceTimersByTime(1_000_000);
    expect(h.snapshot().state).toBe("searching");
    h.tool("first", "search", "cancelled");
    expect(h.snapshot().state).toBe("working");
  });

  it("expires streaming after silence and interrupts it for substantive new work", () => {
    const h = harness();
    h.tool("first");
    h.emit({ type: "message", text: "reply" } as RunEvent);
    expect(h.snapshot().state).toBe("responding");
    h.tool("unknown", "other");
    expect(h.snapshot().state).toBe("responding");
    vi.advanceTimersByTime(2_000);
    expect(h.snapshot()).toMatchObject({ state: "working", source: "observed" });
    h.tool("unknown", "other", "completed");
    expect(h.snapshot().state).toBe("searching");
    h.emit({ type: "message", text: "more" } as RunEvent);
    h.tool("second", "read");
    expect(h.snapshot().state).toBe("reading");
    expect(h.changed).toHaveBeenCalled();
  });

  it("suppresses identified display tools and lets declarations outrank unknown calls", () => {
    const h = harness();
    h.display.report(h.report());
    h.tool("opaque", "other");
    expect(h.snapshot()).toMatchObject({ state: "verifying", source: "declared" });
    h.emit({
      type: "acp",
      update: "tool_call",
      size: 100,
      payload: JSON.stringify({ toolCallId: "display", name: "code60_report_activity" }),
    } as RunEvent);
    h.tool("display", "execute");
    expect(h.snapshot()).toMatchObject({ state: "verifying", otherOperations: 1 });
    h.tool("ordinary", "execute");
    expect(h.snapshot().state).toBe("executing");
  });

  it("invalidates scopes and late callbacks at boundaries; saved events cannot start live work", () => {
    const h = harness();
    const request = h.report();
    h.display.report(request);
    const done = h.display.beginOperation("dispatching");
    h.emit({ type: "turnEnd", turn: 1, stopReason: "cancelled", outcome: "cancelled" } as RunEvent);
    h.run.status = "idle";
    expect(h.snapshot()).toMatchObject({ state: "cancelled", declaration: null });
    h.tool("late");
    expect(() => h.display.report(request)).toThrow("scope");
    expect(vi.getTimerCount()).toBe(0);
    h.start();
    h.run.status = "running";
    const newer = h.display.beginOperation("sending");
    done();
    expect(h.snapshot().state).toBe("sending");
    expect(() => h.display.report(request)).toThrow("scope");
    newer();
    h.display.invalidate();
    expect(h.display.context().scope).toBeNull();
    const fresh = new ActivityDisplay({ changed: vi.fn() });
    fresh.event({
      runId: "chat",
      at: "old",
      type: "toolCall",
      toolCallId: "historical",
      title: "Searching",
      kind: "search",
      status: "in_progress",
    });
    expect(fresh.snapshot({ ...h.run, status: "idle" }, null, 0).state).toBe("idle");
  });

  it("shows host coordination only for actual operations and keeps workers separate", () => {
    const h = harness();
    const done = h.display.beginOperation("dispatching");
    expect(h.snapshot().state).toBe("dispatching");
    done();
    expect(h.snapshot().state).toBe("working");
    h.display.received();
    expect(h.snapshot().state).toBe("receiving");
    vi.advanceTimersByTime(250);
    expect(h.snapshot().state).toBe("working");
    h.display.invalidate();
    h.run.status = "idle";
    expect(h.display.snapshot(h.run, null, 2)).toMatchObject({
      state: "waiting_for_workers",
      workerCount: 2,
    });
    expect(h.display.snapshot(h.run, null, 0).state).toBe("idle");
  });
});
