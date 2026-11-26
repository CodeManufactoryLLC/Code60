import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UsageTurnObservation } from "../contracts/index.js";
import { openUsageStoreReadOnly, UsageStore } from "./usage-store.js";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "code60-usage-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function sampleObs(overrides: Partial<UsageTurnObservation> = {}): UsageTurnObservation {
  return {
    at: "2026-11-26T10:00:00.000Z",
    provider: "claude",
    model: "claude-sonnet-4",
    sessionId: "sess-a",
    turn: 1,
    stopReason: "end_turn",
    durationMs: 2_000,
    attribution: { surface: "project-chat", conversationId: "chat-1", runId: "run-1" },
    context: {
      usedBefore: 10_000,
      usedAfter: 15_000,
      peakUsed: 15_000,
      windowSize: 200_000,
      snapshots: [{ used: 15_000, size: 200_000 }],
      updatesCount: 1,
      compacted: false,
    },
    observed: {
      promptChars: 200,
      promptBytes: 200,
      promptCodeRatio: 0.1,
      messageChars: 400,
      messageBytes: 400,
      messageCodeRatio: 0.2,
      thoughtChars: 0,
      thoughtBytes: 0,
      toolCallCount: 2,
      toolWaves: 2,
      toolPayloadChars: 100,
      toolPayloadBytes: 100,
      rawAcpBytes: 1_000,
    },
    ...overrides,
  };
}

describe("UsageStore", () => {
  it("records, aggregates by provider/surface/hotspots, exports, reads offline, and clears", () => {
    const dir = tempDir();
    const now = Date.parse("2026-11-26T12:00:00.000Z");
    const store = new UsageStore(dir, { now: () => now });
    try {
      store.record(
        sampleObs({
          provider: "claude",
          model: "claude-sonnet-4",
          reported: {
            inputTokens: 20_000,
            outputTokens: 1_000,
            cachedReadTokens: 15_000,
            totalTokens: 21_000,
          },
          reportedScope: "turn",
          cost: { delta: 0.04, cumulative: 0.04, currency: "USD" },
        }),
      );
      store.record(
        sampleObs({
          at: "2026-11-26T11:00:00.000Z",
          provider: "codex",
          model: "gpt-5-codex",
          sessionId: "sess-wf",
          attribution: { surface: "workflow", workflowId: "wf-1", workflowStep: 0 },
          cost: { delta: 0.02, cumulative: 0.02, currency: "USD" },
        }),
      );
      store.record(
        sampleObs({
          at: "2026-11-26T11:30:00.000Z",
          provider: "opencode",
          model: null,
          sessionId: "sess-helper",
          attribution: { surface: "helper", helperKind: "chat-title" },
          context: {
            usedBefore: null,
            usedAfter: null,
            peakUsed: null,
            windowSize: null,
            snapshots: [],
            updatesCount: 0,
            compacted: false,
          },
        }),
      );

      const report = store.report({ range: "24h" });
      expect(report.totals.turns).toBe(3);
      expect(report.totals.exactTurns).toBe(1);
      expect(report.totals.derivedTurns).toBe(1);
      expect(report.totals.lowerBoundTurns).toBe(1);
      expect(report.totals.costs).toEqual([{ currency: "USD", amount: 0.06 }]);
      expect(report.providers).toHaveLength(3);
      expect(report.surfaces.map((s) => s.surface)).toContain("workflow");
      expect(report.surfaces.map((s) => s.helperKind)).toContain("chat-title");
      expect(report.hotspots.length).toBe(3);

      // Paged turn inspector
      const page = store.turns({ range: "24h", limit: 2, offset: 0 });
      expect(page.total).toBe(3);
      expect(page.turns).toHaveLength(2);
      expect(page.hasMore).toBe(true);

      // Exports
      const md = store.exportReport({ range: "24h", format: "markdown", includeTurns: true });
      expect(md.content).toContain("# Code60 Token Usage Report");
      expect(md.content).toContain("claude");
      expect(md.content).toContain("Turn Audit Log");

      const csv = store.exportReport({ range: "24h", format: "csv", includeTurns: true });
      expect(csv.content).toContain("est_total_tokens");
      expect(csv.content.trim().split("\n")).toHaveLength(4);

      const jsonExport = store.exportReport({ range: "24h", format: "json", includeTurns: true });
      const parsed = JSON.parse(jsonExport.content);
      expect(parsed.report.totals.turns).toBe(3);
      expect(parsed.turns).toHaveLength(3);

      // Read-only offline access
      const ro = openUsageStoreReadOnly(dir, () => now);
      try {
        expect(ro.report({ range: "24h" }).totals.turns).toBe(3);
      } finally {
        ro.close();
      }

      // Clear
      const cleared = store.clear();
      expect(cleared.deleted).toBe(3);
      expect(store.report({ range: "all" }).totals.turns).toBe(0);
    } finally {
      store.close();
    }
  });

  it("handles missing database gracefully in read-only mode without creating files", () => {
    const dir = join(tempDir(), "nonexistent");
    const ro = openUsageStoreReadOnly(dir);
    try {
      const report = ro.report({ range: "7d" });
      expect(report.totals.turns).toBe(0);
      expect(report.status.unavailable).toBe(false);
    } finally {
      ro.close();
    }
  });

  it("enforces retention pruning by age and row cap", () => {
    const dir = tempDir();
    const now = Date.parse("2026-11-26T12:00:00.000Z");
    const store = new UsageStore(dir, { now: () => now, retentionDays: 30, maxRows: 2 });
    try {
      store.record(sampleObs({ at: "2026-09-01T10:00:00.000Z", sessionId: "old" }));
      store.record(sampleObs({ at: "2026-11-25T10:00:00.000Z", sessionId: "s1" }));
      store.record(sampleObs({ at: "2026-11-26T10:00:00.000Z", sessionId: "s2" }));
      store.record(sampleObs({ at: "2026-11-26T11:00:00.000Z", sessionId: "s3" }));
      store.prune();
      const page = store.turns({ range: "all", limit: 10 });
      expect(page.total).toBe(2);
      expect(page.turns.map((t) => t.sessionId)).toEqual(["s3", "s2"]);
    } finally {
      store.close();
    }
  });
});
