import type {
  UsageAggregateMetrics,
  UsageExportFormat,
  UsageExportResult,
  UsageReport,
  UsageTurnRecord,
} from "../contracts/index.js";

export const USAGE_METHODOLOGY = {
  summary:
    "Code60 captures quantitative turn metrics at the ACP boundary without storing prompts, replies, or file paths.",
  tiers: [
    {
      method: "acp_reported",
      confidence: "exact",
      description:
        "Provider-reported input, cached-read, output, and thought tokens returned in ACP PromptResponse.usage.",
    },
    {
      method: "usage_update_sum",
      confidence: "derived",
      description:
        "Sum of distinct mid-turn ACP usage_update context snapshots across internal LLM steps, with output estimated from observed ACP text.",
    },
    {
      method: "context_wave_model",
      confidence: "derived",
      description:
        "Trapezoidal estimate across observed tool waves: (toolWaves + 1) * avg(usedBefore, usedAfter), split into net context growth and re-read input.",
    },
    {
      method: "text_lower_bound",
      confidence: "lower_bound",
      description:
        "UTF-8 byte heuristic on visible ACP prompts, messages, thoughts, and tool payloads (~4.0 B/tok prose, ~3.4 B/tok code). Excludes hidden harness system prompts and unstreamed local tool outputs.",
    },
  ],
} as const;

function formatInt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatMix(metrics: UsageAggregateMetrics): string {
  if (metrics.turns === 0) return "No turns";
  const pct = (count: number) => Math.round((count / metrics.turns) * 100);
  const parts: string[] = [];
  if (metrics.exactTurns > 0) parts.push(`${pct(metrics.exactTurns)}% exact`);
  if (metrics.derivedTurns > 0) parts.push(`${pct(metrics.derivedTurns)}% derived`);
  if (metrics.lowerBoundTurns > 0) parts.push(`${pct(metrics.lowerBoundTurns)}% lower-bound`);
  return parts.join(" · ");
}

function formatCosts(metrics: UsageAggregateMetrics): string {
  if (metrics.costs.length === 0) return "—";
  return metrics.costs
    .map((entry) =>
      entry.currency === "USD"
        ? `$${entry.amount.toFixed(4)}`
        : `${entry.amount.toFixed(4)} ${entry.currency}`,
    )
    .join(", ");
}

function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function escapeMarkdown(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function formatUsageMarkdown(report: UsageReport, turns?: readonly UsageTurnRecord[]): string {
  const lines: string[] = [];
  lines.push("# Code60 Token Usage Report");
  lines.push("");
  lines.push(`- **Generated at:** ${report.generatedAt}`);
  lines.push(
    `- **Window:** ${report.window.range}${report.window.since ? ` (since ${report.window.since})` : ""}${report.window.until ? ` (until ${report.window.until})` : ""}`,
  );
  lines.push(`- **Estimator version:** v${report.estimatorVersion}`);
  lines.push(
    `- **Filters:** provider=${report.filters.provider ?? "all"}, surface=${report.filters.surface ?? "all"}, model=${report.filters.model ?? "all"}`,
  );
  lines.push("");
  lines.push("## Overview");
  lines.push("");
  lines.push(`- **Turns:** ${formatInt(report.totals.turns)}`);
  lines.push(`- **Estimated cumulative tokens:** ${formatInt(report.totals.totalTokens)}`);
  lines.push(
    `- **Breakdown:** ${formatInt(report.totals.newInputTokens)} new input · ${formatInt(report.totals.cachedOrRereadInputTokens)} cached/re-read input · ${formatInt(report.totals.outputTokens)} output`,
  );
  lines.push(`- **Net context added:** ${formatInt(report.totals.netContextDelta)}`);
  lines.push(
    `- **Tool activity:** ${formatInt(report.totals.toolCalls)} calls across ${formatInt(report.totals.toolWaves)} waves · ${formatInt(report.totals.compactions)} compactions`,
  );
  lines.push(`- **Reported cost:** ${formatCosts(report.totals)}`);
  lines.push(`- **Measurement mix:** ${formatMix(report.totals)}`);
  lines.push("");

  lines.push("## Provider Burn Rate");
  lines.push("");
  if (report.providers.length === 0) {
    lines.push("No usage records matched the selected window and filters.");
  } else {
    lines.push(
      "| Provider | Turns | Est. Total | New Input | Cached / Re-read | Output | Net Context Δ | Reported Cost | Measurement Mix |",
    );
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
    for (const provider of report.providers) {
      lines.push(
        `| ${escapeMarkdown(provider.provider)} | ${formatInt(provider.turns)} | ${formatInt(provider.totalTokens)} | ${formatInt(provider.newInputTokens)} | ${formatInt(provider.cachedOrRereadInputTokens)} | ${formatInt(provider.outputTokens)} | ${formatInt(provider.netContextDelta)} | ${escapeMarkdown(formatCosts(provider))} | ${escapeMarkdown(formatMix(provider))} |`,
      );
      for (const model of provider.models) {
        lines.push(
          `| ↳ ${escapeMarkdown(model.model)} | ${formatInt(model.turns)} | ${formatInt(model.totalTokens)} | ${formatInt(model.newInputTokens)} | ${formatInt(model.cachedOrRereadInputTokens)} | ${formatInt(model.outputTokens)} | ${formatInt(model.netContextDelta)} | ${escapeMarkdown(formatCosts(model))} | ${escapeMarkdown(formatMix(model))} |`,
        );
      }
    }
  }
  lines.push("");

  lines.push("## Usage by Surface");
  lines.push("");
  if (report.surfaces.length === 0) {
    lines.push("No surface breakdown available.");
  } else {
    lines.push(
      "| Surface | Turns | Est. Total | New Input | Cached / Re-read | Output | Tool Waves | Compactions |",
    );
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const surface of report.surfaces) {
      const label = surface.helperKind
        ? `${surface.surface}:${surface.helperKind}`
        : surface.surface;
      lines.push(
        `| ${escapeMarkdown(label)} | ${formatInt(surface.turns)} | ${formatInt(surface.totalTokens)} | ${formatInt(surface.newInputTokens)} | ${formatInt(surface.cachedOrRereadInputTokens)} | ${formatInt(surface.outputTokens)} | ${formatInt(surface.toolWaves)} | ${formatInt(surface.compactions)} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Heavy Sessions & Workflows (Hotspots)");
  lines.push("");
  if (report.hotspots.length === 0) {
    lines.push("No session hotspots recorded.");
  } else {
    lines.push(
      "| Target | Surface | Provider / Model | Turns | Est. Total | Net Context Δ | Peak Fill | Max Waves/Turn | Compactions |",
    );
    lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const spot of report.hotspots.slice(0, 20)) {
      const target = spot.workflowId ?? spot.conversationId ?? spot.runId ?? spot.sessionId;
      const surfaceLabel = spot.helperKind ? `${spot.surface}:${spot.helperKind}` : spot.surface;
      const providerModel = spot.model ? `${spot.provider} / ${spot.model}` : spot.provider;
      const fill =
        spot.peakContextPercent !== null ? `${spot.peakContextPercent.toFixed(1)}%` : "—";
      lines.push(
        `| \`${escapeMarkdown(target)}\` | ${escapeMarkdown(surfaceLabel)} | ${escapeMarkdown(providerModel)} | ${formatInt(spot.turns)} | ${formatInt(spot.totalTokens)} | ${formatInt(spot.netContextDelta)} | ${fill} | ${formatInt(spot.maxToolWaves)} | ${formatInt(spot.compactions)} |`,
      );
    }
  }
  lines.push("");

  if (turns && turns.length > 0) {
    lines.push(`## Turn Audit Log (${turns.length} turns)`);
    lines.push("");
    lines.push(
      "| Time | Provider | Model | Surface | Turn | Method | Confidence | Est. Total | Net Δ | Waves | Compacted |",
    );
    lines.push("| --- | --- | --- | --- | ---: | --- | --- | ---: | ---: | ---: | --- |");
    for (const item of turns) {
      const surfaceLabel = item.attribution.helperKind
        ? `${item.attribution.surface}:${item.attribution.helperKind}`
        : item.attribution.surface;
      lines.push(
        `| ${item.at} | ${escapeMarkdown(item.provider)} | ${escapeMarkdown(item.model ?? "unknown")} | ${escapeMarkdown(surfaceLabel)} | ${item.turn} | ${item.estimate.method} | ${item.estimate.confidence} | ${formatInt(item.estimate.totalTokens)} | ${item.estimate.netContextDelta !== null ? formatInt(item.estimate.netContextDelta) : "—"} | ${item.observed.toolWaves} | ${item.context.compacted ? "yes" : "no"} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Methodology");
  lines.push("");
  lines.push(USAGE_METHODOLOGY.summary);
  lines.push("");
  for (const tier of USAGE_METHODOLOGY.tiers) {
    lines.push(`- **${tier.method}** (${tier.confidence}): ${tier.description}`);
  }
  lines.push("");
  return lines.join("\n");
}

function formatUsageCsv(report: UsageReport, turns?: readonly UsageTurnRecord[]): string {
  if (turns) {
    const header = [
      "id",
      "at",
      "provider",
      "model",
      "surface",
      "helper_kind",
      "session_id",
      "run_id",
      "conversation_id",
      "workflow_id",
      "schedule_id",
      "turn",
      "stop_reason",
      "duration_ms",
      "method",
      "confidence",
      "estimator_version",
      "est_total_tokens",
      "est_input_tokens",
      "est_new_input_tokens",
      "est_cached_or_reread_tokens",
      "est_output_tokens",
      "est_thought_tokens",
      "net_context_delta",
      "used_before",
      "used_after",
      "peak_used",
      "window_size",
      "usage_updates_count",
      "compacted",
      "tool_calls",
      "tool_waves",
      "prompt_chars",
      "message_chars",
      "thought_chars",
      "cost_delta",
      "cost_currency",
    ].join(",");
    const rows = turns.map((t) =>
      [
        t.id,
        t.at,
        t.provider,
        t.model,
        t.attribution.surface,
        t.attribution.helperKind,
        t.sessionId,
        t.attribution.runId,
        t.attribution.conversationId,
        t.attribution.workflowId,
        t.attribution.scheduleId,
        t.turn,
        t.stopReason,
        t.durationMs,
        t.estimate.method,
        t.estimate.confidence,
        t.estimate.estimatorVersion,
        t.estimate.totalTokens,
        t.estimate.inputTokens,
        t.estimate.newInputTokens,
        t.estimate.cachedOrRereadInputTokens,
        t.estimate.outputTokens,
        t.estimate.thoughtTokens,
        t.estimate.netContextDelta,
        t.context.usedBefore,
        t.context.usedAfter,
        t.context.peakUsed,
        t.context.windowSize,
        t.context.updatesCount,
        t.context.compacted,
        t.observed.toolCallCount,
        t.observed.toolWaves,
        t.observed.promptChars,
        t.observed.messageChars,
        t.observed.thoughtChars,
        t.cost?.delta,
        t.cost?.currency,
      ]
        .map(csvCell)
        .join(","),
    );
    return `${[header, ...rows].join("\n")}\n`;
  }

  const header = [
    "provider",
    "model",
    "turns",
    "est_total_tokens",
    "est_new_input_tokens",
    "est_cached_or_reread_tokens",
    "est_output_tokens",
    "net_context_delta",
    "tool_calls",
    "tool_waves",
    "compactions",
    "exact_turns",
    "derived_turns",
    "lower_bound_turns",
  ].join(",");
  const rows: string[] = [];
  for (const provider of report.providers) {
    for (const model of provider.models) {
      rows.push(
        [
          provider.provider,
          model.model,
          model.turns,
          model.totalTokens,
          model.newInputTokens,
          model.cachedOrRereadInputTokens,
          model.outputTokens,
          model.netContextDelta,
          model.toolCalls,
          model.toolWaves,
          model.compactions,
          model.exactTurns,
          model.derivedTurns,
          model.lowerBoundTurns,
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return `${[header, ...rows].join("\n")}\n`;
}

export function buildUsageExport(
  format: UsageExportFormat,
  report: UsageReport,
  turns?: readonly UsageTurnRecord[],
): UsageExportResult {
  const stamp = report.generatedAt.slice(0, 19).replaceAll(":", "-");
  if (format === "json") {
    const payload = {
      report,
      methodology: USAGE_METHODOLOGY,
      ...(turns ? { turns } : {}),
    };
    return {
      format,
      filename: `code60-usage-${stamp}.json`,
      mimeType: "application/json",
      content: `${JSON.stringify(payload, null, 2)}\n`,
    };
  }
  if (format === "csv") {
    return {
      format,
      filename: `code60-usage-${stamp}.csv`,
      mimeType: "text/csv;charset=utf-8",
      content: formatUsageCsv(report, turns),
    };
  }
  return {
    format,
    filename: `code60-usage-${stamp}.md`,
    mimeType: "text/markdown;charset=utf-8",
    content: formatUsageMarkdown(report, turns),
  };
}
