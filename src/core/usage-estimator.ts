import {
  USAGE_ESTIMATOR_VERSION,
  type UsageEstimate,
  type UsageTurnObservation,
} from "../contracts/index.js";

/**
 * Estimates tokens from UTF-8 byte length using a deterministic content-aware divisor:
 * ~4.0 bytes/token for English prose (`codeRatio = 0`) down to ~3.4 bytes/token for
 * dense code/JSON (`codeRatio = 1`).
 */
export function estimateTextTokens(bytes: number, codeRatio = 0): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(codeRatio) ? codeRatio : 0));
  const bytesPerToken = 4.0 - 0.6 * clamped;
  return Math.max(1, Math.ceil(bytes / bytesPerToken));
}

/**
 * Computes both cumulative burn-rate tokens and net context growth for one ACP turn,
 * tagging the exact measurement tier and confidence level for auditability.
 */
export function estimateTurnUsage(observation: UsageTurnObservation): UsageEstimate {
  const { reported, context, observed } = observation;

  const netContextDelta =
    !context.compacted && context.usedAfter !== null
      ? Math.max(0, context.usedAfter - (context.usedBefore ?? 0))
      : null;

  // Tier 1: Provider-reported turn usage (ACP PromptResponse.usage)
  if (reported) {
    const inputTokens = reported.inputTokens;
    const cachedRead = Math.min(inputTokens, reported.cachedReadTokens ?? 0);
    const newInputTokens = Math.max(0, inputTokens - cachedRead);
    const outputTokens = reported.outputTokens;
    const thoughtTokens = reported.thoughtTokens ?? null;
    const totalTokens = Math.max(reported.totalTokens, inputTokens + outputTokens);
    return {
      inputTokens,
      newInputTokens,
      cachedOrRereadInputTokens: cachedRead,
      outputTokens,
      thoughtTokens,
      totalTokens,
      netContextDelta,
      method: "acp_reported",
      confidence: "exact",
      estimatorVersion: USAGE_ESTIMATOR_VERSION,
    };
  }

  const promptTokens = estimateTextTokens(observed.promptBytes, observed.promptCodeRatio);
  const messageTokens = estimateTextTokens(observed.messageBytes, observed.messageCodeRatio);
  const thoughtTokens =
    observed.thoughtBytes > 0 ? estimateTextTokens(observed.thoughtBytes, 0.2) : null;
  const outputTokens = messageTokens + (thoughtTokens ?? 0);

  // Tier 2a: Multiple distinct mid-turn usage_update snapshots (one per internal LLM step)
  if (context.snapshots.length >= 2) {
    const cumulativeInput = context.snapshots.reduce((sum, snap) => sum + snap.used, 0);
    const rawNew =
      netContextDelta !== null
        ? Math.max(promptTokens, Math.max(0, netContextDelta - outputTokens))
        : promptTokens;
    const newInputTokens = Math.min(cumulativeInput, rawNew);
    const cachedOrRereadInputTokens = Math.max(0, cumulativeInput - newInputTokens);
    return {
      inputTokens: cumulativeInput,
      newInputTokens,
      cachedOrRereadInputTokens,
      outputTokens,
      thoughtTokens,
      totalTokens: cumulativeInput + outputTokens,
      netContextDelta,
      method: "usage_update_sum",
      confidence: "derived",
      estimatorVersion: USAGE_ESTIMATOR_VERSION,
    };
  }

  // Tier 2b: Start/end usage_update + tool-wave trapezoid model (non-compacted turns)
  if (context.usedAfter !== null && context.usedAfter > 0 && !context.compacted) {
    const rounds = observed.toolWaves + 1;
    const startUsed = context.usedBefore ?? context.usedAfter;
    const averageContext = (startUsed + context.usedAfter) / 2;
    const cumulativeInput = Math.max(netContextDelta ?? 0, Math.round(rounds * averageContext));
    const rawNew = Math.max(promptTokens, Math.max(0, (netContextDelta ?? 0) - outputTokens));
    const newInputTokens = Math.min(cumulativeInput, rawNew);
    const cachedOrRereadInputTokens = Math.max(0, cumulativeInput - newInputTokens);
    return {
      inputTokens: cumulativeInput,
      newInputTokens,
      cachedOrRereadInputTokens,
      outputTokens,
      thoughtTokens,
      totalTokens: cumulativeInput + outputTokens,
      netContextDelta,
      method: "context_wave_model",
      confidence: "derived",
      estimatorVersion: USAGE_ESTIMATOR_VERSION,
    };
  }

  // Tier 3: Observed ACP wire text only (strict lower bound)
  const toolTokens = estimateTextTokens(observed.toolPayloadBytes, 0.8);
  const inputTokens = promptTokens + toolTokens;
  return {
    inputTokens,
    newInputTokens: inputTokens,
    cachedOrRereadInputTokens: 0,
    outputTokens,
    thoughtTokens,
    totalTokens: inputTokens + outputTokens,
    netContextDelta,
    method: "text_lower_bound",
    confidence: "lower_bound",
    estimatorVersion: USAGE_ESTIMATOR_VERSION,
  };
}
