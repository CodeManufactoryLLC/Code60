import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlertService } from "./alerts.js";

const roots: string[] = [];

async function tempRoot() {
  const dir = await mkdtemp(join(tmpdir(), "code60-alerts-"));
  roots.push(dir);
  return join(dir, "alerts");
}

afterEach(async () => {
  while (roots.length) {
    const dir = roots.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("AlertService", () => {
  it("persists alerts and read/unread transitions across reloads", async () => {
    const root = await tempRoot();
    let clock = Date.parse("2026-11-27T10:00:00.000Z");
    const nextNow = () => {
      clock += 1000;
      return new Date(clock);
    };
    const service = new AlertService(root, nextNow);
    await service.load();

    const updates: number[] = [];
    const unsubscribe = service.subscribe((snapshot) => updates.push(snapshot.unreadCount));

    const first = await service.publish({
      dedupeKey: "event:job:1",
      source: "automation",
      severity: "error",
      title: "Scheduled job failed: Nightly check",
      target: { kind: "page", id: "automations" },
    });
    const second = await service.publish({
      dedupeKey: "event:job:2",
      source: "workflow",
      severity: "warning",
      title: "Workflow needs input: Release",
      target: { kind: "workflow", id: "550e8400-e29b-41d4-a716-446655440000" },
    });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) throw new Error("Expected alerts to be created");
    expect(service.snapshot().unreadCount).toBe(2);
    expect(service.snapshot().alerts.map((a) => a.title)).toEqual([
      "Workflow needs input: Release",
      "Scheduled job failed: Nightly check",
    ]);

    const afterRead = await service.handle({ action: "mark-read", id: first.id });
    expect(afterRead.unreadCount).toBe(1);
    expect(afterRead.alerts.find((a) => a.id === first.id)?.read).toBe(true);

    const afterUnread = await service.handle({ action: "mark-unread", id: first.id });
    expect(afterUnread.unreadCount).toBe(2);
    expect(afterUnread.alerts.find((a) => a.id === first.id)?.read).toBe(false);

    await service.handle({ action: "mark-read", id: second.id });
    unsubscribe();
    await service.close();

    // Reload into a fresh AlertService instance.
    const reloaded = new AlertService(root, nextNow);
    await reloaded.load();
    const snap = reloaded.snapshot();
    expect(snap.unreadCount).toBe(1);
    expect(snap.alerts).toHaveLength(2);
    expect(snap.alerts.find((a) => a.id === second.id)?.read).toBe(true);
    expect(snap.alerts.find((a) => a.id === first.id)?.read).toBe(false);
    expect(updates.length).toBeGreaterThanOrEqual(4);
  });

  it("deduplicates unchanged alerts without resetting read status and suppresses dismissed keys", async () => {
    const root = await tempRoot();
    const service = new AlertService(root, () => new Date("2026-11-27T10:00:00.000Z"));
    await service.load();

    const created = await service.publish({
      dedupeKey: "event:plan-failed:1",
      source: "plan",
      severity: "error",
      title: "Plan failed: Refactor",
      target: { kind: "conversation", id: "chat-1" },
    });
    if (!created) throw new Error("Expected alert to be created");
    await service.handle({ action: "mark-read", id: created.id });

    // Re-publishing identical content preserves read state and does not bump revision.
    const revisionBefore = service.snapshot().revision;
    const again = await service.publish({
      dedupeKey: "event:plan-failed:1",
      source: "plan",
      severity: "error",
      title: "Plan failed: Refactor",
      target: { kind: "conversation", id: "chat-1" },
    });
    expect(again?.id).toBe(created.id);
    expect(again?.read).toBe(true);
    expect(service.snapshot().revision).toBe(revisionBefore);

    // Clearing read records the dedupeKey so it does not resurrect.
    await service.handle({ action: "clear-read" });
    expect(service.snapshot().alerts).toHaveLength(0);
    const suppressed = await service.publish({
      dedupeKey: "event:plan-failed:1",
      source: "plan",
      severity: "error",
      title: "Plan failed: Refactor",
      target: { kind: "conversation", id: "chat-1" },
    });
    expect(suppressed).toBeNull();
    expect(service.snapshot().alerts).toHaveLength(0);
  });

  it("syncs live sources, auto-resolves cleared conditions, and allows future recurrences", async () => {
    const root = await tempRoot();
    const service = new AlertService(root, () => new Date("2026-11-27T10:00:00.000Z"));
    await service.load();

    const activeApproval = {
      dedupeKey: "live:approval:run-1:perm#1",
      source: "approval",
      severity: "warning" as const,
      title: "Approval needed: Relay",
      target: { kind: "conversation" as const, id: "run-1" },
    };

    await service.syncSource("live:approval:", [activeApproval]);
    expect(service.snapshot().alerts).toHaveLength(1);
    const id = service.snapshot().alerts[0]?.id;
    if (!id) throw new Error("Expected active alert");

    // User dismisses while still active: stays hidden while condition persists.
    await service.handle({ action: "dismiss", id });
    await service.syncSource("live:approval:", [activeApproval]);
    expect(service.snapshot().alerts).toHaveLength(0);

    // Condition clears: dismissed key is forgotten.
    await service.syncSource("live:approval:", []);

    // Future recurrence with the same key creates a fresh unread alert.
    await service.syncSource("live:approval:", [activeApproval]);
    expect(service.snapshot().alerts).toHaveLength(1);
    expect(service.snapshot().unreadCount).toBe(1);

    // Condition clears again: alert auto-resolves.
    await service.syncSource("live:approval:", []);
    expect(service.snapshot().alerts).toHaveLength(0);
    expect(service.snapshot().unreadCount).toBe(0);
  });

  it("supports mark-all-read, scheduler history seeding, and capacity eviction of oldest read alerts first", async () => {
    const root = await tempRoot();
    let tick = Date.parse("2026-11-27T00:00:00.000Z");
    const limit = 5;
    const service = new AlertService(
      root,
      () => {
        tick += 1000;
        return new Date(tick);
      },
      limit,
    );
    await service.load();

    expect(service.schedulerHistorySeeded).toBe(false);
    await service.markSchedulerHistorySeeded(["event:automation-exec:old-1"]);
    expect(service.schedulerHistorySeeded).toBe(true);
    expect(
      await service.publish({
        dedupeKey: "event:automation-exec:old-1",
        source: "automation",
        severity: "error",
        title: "Old failure",
        target: { kind: "page", id: "automations" },
      }),
    ).toBeNull();

    const first = await service.publish({
      source: "system",
      severity: "info",
      title: "Read alert",
      target: { kind: "page", id: "home" },
    });
    await service.handle({ action: "mark-all-read" });
    expect(service.snapshot().unreadCount).toBe(0);
    if (!first) throw new Error("Expected alert");

    for (let i = 0; i < limit; i++) {
      await service.publish({
        source: "system",
        severity: "info",
        title: `Unread ${i}`,
        target: { kind: "page", id: "home" },
      });
    }
    const snap = service.snapshot();
    expect(snap.alerts).toHaveLength(limit);
    expect(snap.alerts.some((item) => item.id === first.id)).toBe(false);
    expect(snap.unreadCount).toBe(limit);
  });

  it("preserves corrupted state files without overwriting them and isolates listener errors", async () => {
    const root = await tempRoot();
    const service = new AlertService(root);
    await service.load();
    await service.publish({
      source: "system",
      severity: "info",
      title: "Init",
      target: { kind: "page", id: "home" },
    });
    await service.close();

    const statePath = join(root, "state.json");
    const corrupt = "{corrupt-json";
    await chmod(statePath, 0o600);
    await writeFile(statePath, corrupt, { mode: 0o600 });

    const recovered = new AlertService(root);
    await recovered.load();
    const throwing = vi.fn(() => {
      throw new Error("boom");
    });
    const healthy = vi.fn();
    recovered.subscribe(throwing);
    recovered.subscribe(healthy);

    await recovered.publish({
      source: "system",
      severity: "warning",
      title: "In-memory only",
      target: { kind: "page", id: "home" },
    });
    await recovered.close();

    expect(throwing).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(await readFile(statePath, "utf8")).toBe(corrupt);
  });
});
