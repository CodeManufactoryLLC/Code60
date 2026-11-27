import { describe, expect, it } from "vitest";
import type { UsageTurnObservation } from "../contracts/index.js";
import { estimateTextTokens, estimateTurnUsage } from "./usage-estimator.js";

function baseObservation(overrides: Partial<UsageTurnObservation> = {}): UsageTurnObservation {
  return {
    at: "2026-11-26T12:00:00.000Z",
    provider: "claude",
    model: "claude-sonnet-4",
    sessionId: "sess-1",
    turn: 1,
    stopReason: "end_turn",
    durationMs: 1_200,
    attribution: { surface: "project-chat", runId: "run-1" },
    context: {
      usedBefore: null,
      usedAfter: null,
      peakUsed: null,
      windowSize: null,
      snapshots: [],
      updatesCount: 0,
      compacted: false,
    },
    observed: {
      promptChars: 400,
      promptBytes: 400,
      promptCodeRatio: 0,
      messageChars: 800,
      messageBytes: 800,
      messageCodeRatio: 0,
      thoughtChars: 0,
      thoughtBytes: 0,
      toolCallCount: 0,
      toolWaves: 0,
      toolPayloadChars: 0,
      toolPayloadBytes: 0,
      rawAcpBytes: 1_200,
    },
    ...overrides,
  };
}

describe("usage-estimator", () => {
  it("estimates prose vs code text tokens deterministically", () => {
    expect(estimateTextTokens(0, 0)).toBe(0);
    expect(estimateTextTokens(400, 0)).toBe(100);
    // Code uses ~3.4 bytes/token -> higher token density than prose
    expect(estimateTextTokens(340, 1)).toBe(100);
    expect(estimateTextTokens(400, 1)).toBeGreaterThan(estimateTextTokens(400, 0));
  });

  it("uses Tier 1 exact values when PromptResponse.usage is reported", () => {
    const estimate = estimateTurnUsage(
      baseObservation({
        reported: {
          inputTokens: 135_000,
          outputTokens: 1_000,
          cachedReadTokens: 129_000,
          thoughtTokens: 250,
          totalTokens: 136_000,
        },
        context: {
          usedBefore: 30_000,
          usedAfter: 36_600,
          peakUsed: 36_600,
          windowSize: 200_000,
          snapshots: [{ used: 36_600, size: 200_000 }],
          updatesCount: 1,
          compacted: false,
        },
      }),
    );

    expect(estimate.method).toBe("acp_reported");
    expect(estimate.confidence).toBe("exact");
    expect(estimate.inputTokens).toBe(135_000);
    expect(estimate.newInputTokens).toBe(6_000);
    expect(estimate.cachedOrRereadInputTokens).toBe(129_000);
    expect(estimate.outputTokens).toBe(1_000);
    expect(estimate.thoughtTokens).toBe(250);
    expect(estimate.totalTokens).toBe(136_000);
    expect(estimate.netContextDelta).toBe(6_600);
  });

  it("uses Tier 2a usage_update_sum when multiple mid-turn snapshots are present", () => {
    const estimate = estimateTurnUsage(
      baseObservation({
        context: {
          usedBefore: 30_000,
          usedAfter: 36_600,
          peakUsed: 36_600,
          windowSize: 200_000,
          snapshots: [
            { used: 30_012, size: 200_000 },
            { used: 34_212, size: 200_000 },
            { used: 34_800, size: 200_000 },
            { used: 36_600, size: 200_000 },
          ],
          updatesCount: 4,
          compacted: false,
        },
      }),
    );

    expect(estimate.method).toBe("usage_update_sum");
    expect(estimate.confidence).toBe("derived");
    expect(estimate.inputTokens).toBe(30_012 + 34_212 + 34_800 + 36_600);
    expect(estimate.outputTokens).toBe(200);
    expect(estimate.newInputTokens).toBe(6_400);
    expect(estimate.cachedOrRereadInputTokens).toBe(estimate.inputTokens - 6_400);
    expect(estimate.netContextDelta).toBe(6_600);
  });

  it("uses Tier 2b context_wave_model when only start/end usage_update exists", () => {
    const estimate = estimateTurnUsage(
      baseObservation({
        context: {
          usedBefore: 30_000,
          usedAfter: 36_600,
          peakUsed: 36_600,
          windowSize: 200_000,
          snapshots: [{ used: 36_600, size: 200_000 }],
          updatesCount: 1,
          compacted: false,
        },
        observed: {
          ...baseObservation().observed,
          toolCallCount: 4,
          toolWaves: 3,
        },
      }),
    );

    expect(estimate.method).toBe("context_wave_model");
    expect(estimate.confidence).toBe("derived");
    // (3 + 1) * avg(30_000, 36_600) = 4 * 33_300 = 133_200
    expect(estimate.inputTokens).toBe(133_200);
    expect(estimate.netContextDelta).toBe(6_600);
    expect(estimate.cachedOrRereadInputTokens).toBeGreaterThan(120_000);
  });

  it("falls back to Tier 3 text_lower_bound when no usage_update or compacted turn occurs", () => {
    const estimate = estimateTurnUsage(
      baseObservation({
        context: {
          usedBefore: 50_000,
          usedAfter: 8_000,
          peakUsed: 50_000,
          windowSize: 200_000,
          snapshots: [{ used: 8_000, size: 200_000 }],
          updatesCount: 1,
          compacted: true,
        },
        observed: {
          promptChars: 400,
          promptBytes: 400,
          promptCodeRatio: 0,
          messageChars: 800,
          messageBytes: 800,
          messageCodeRatio: 0,
          thoughtChars: 200,
          thoughtBytes: 200,
          toolCallCount: 1,
          toolWaves: 1,
          toolPayloadChars: 352,
          toolPayloadBytes: 352,
          rawAcpBytes: 2_000,
        },
      }),
    );

    expect(estimate.method).toBe("text_lower_bound");
    expect(estimate.confidence).toBe("lower_bound");
    expect(estimate.netContextDelta).toBeNull();
    expect(estimate.cachedOrRereadInputTokens).toBe(0);
    expect(estimate.inputTokens).toBeGreaterThan(100);
    expect(estimate.outputTokens).toBeGreaterThan(200);
    expect(estimate.thoughtTokens).toBeGreaterThan(0);
  });
});
