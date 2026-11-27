import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseValue,
  USAGE_MAX_TURN_PAGE_LIMIT,
  USAGE_SURFACES,
  USAGE_TIME_RANGES,
  type UsageAggregateMetrics,
  type UsageReport,
  type UsageReportQuery,
  type UsageSurface,
  type UsageTimeRange,
  type UsageTurnRecord,
  usageReportQuerySchema,
} from "../contracts/index.js";
import {
  buildUsageExport,
  openUsageStoreReadOnly,
  stateHome,
  USAGE_METHODOLOGY,
} from "../core/index.js";
import { managementRequest } from "../gateway/index.js";

type UsageCliFormat = "table" | "json" | "markdown" | "csv";

export interface UsageCliOptions {
  help: boolean;
  query: UsageReportQuery;
  format: UsageCliFormat;
  turns: boolean;
  limit: number;
  out?: string;
  force: boolean;
}

const USAGE_HELP = [
  "Usage: code60 usage [options]",
  "",
  "Inspect local provider token-usage estimates without starting Code60 Gateway.",
  "",
  "Options:",
  "  --since <24h|7d|30d|all|ISO>   Time window or ISO start timestamp (default: 7d)",
  "  --until <ISO>                  ISO end timestamp",
  "  --provider <id>                Filter by provider ID (e.g. claude, codex)",
  `  --surface <name>               Filter by surface (${USAGE_SURFACES.join("|")})`,
  "  --model <id>                   Filter by model ID",
  "  --format <fmt>                 Output format: table|json|markdown|csv (default: table)",
  "  --turns                        Include per-turn audit rows",
  `  --limit <n>                    Max turn rows when --turns is set (1..${USAGE_MAX_TURN_PAGE_LIMIT}, default: 50)`,
  "  --out <file>                   Write output to file (refuses overwrite without --force)",
  "  --force                        Allow --out to overwrite an existing file",
  "  --help                         Show this help message",
  "",
].join("\n");

export function parseUsageCliArgs(args: readonly string[]): UsageCliOptions {
  const options: UsageCliOptions = {
    help: false,
    query: {},
    format: "table",
    turns: false,
    limit: 50,
    force: false,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      return options;
    }
    if (arg === "--turns") {
      options.turns = true;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    const takeValue = (flag: string): string => {
      const value = args[++index];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for ${flag}. Run code60 usage --help.`);
      }
      return value;
    };
    if (arg === "--since") {
      const value = takeValue("--since");
      if ((USAGE_TIME_RANGES as readonly string[]).includes(value)) {
        options.query.range = value as UsageTimeRange;
        delete options.query.since;
      } else {
        if (Number.isNaN(Date.parse(value))) {
          throw new Error(
            `Invalid --since value '${value}'. Use 24h, 7d, 30d, all, or an ISO timestamp.`,
          );
        }
        options.query.since = value;
        options.query.range = "all";
      }
      continue;
    }
    if (arg === "--until") {
      const value = takeValue("--until");
      if (Number.isNaN(Date.parse(value))) {
        throw new Error(`Invalid --until timestamp '${value}'.`);
      }
      options.query.until = value;
      continue;
    }
    if (arg === "--provider") {
      options.query.provider = takeValue("--provider");
      continue;
    }
    if (arg === "--surface") {
      const value = takeValue("--surface");
      if (!(USAGE_SURFACES as readonly string[]).includes(value)) {
        throw new Error(
          `Invalid --surface '${value}'. Expected one of: ${USAGE_SURFACES.join(", ")}.`,
        );
      }
      options.query.surface = value as UsageSurface;
      continue;
    }
    if (arg === "--model") {
      options.query.model = takeValue("--model");
      continue;
    }
    if (arg === "--format") {
      const value = takeValue("--format");
      if (!["table", "json", "markdown", "csv"].includes(value)) {
        throw new Error(`Invalid --format '${value}'. Expected table, json, markdown, or csv.`);
      }
      options.format = value as UsageCliFormat;
      continue;
    }
    if (arg === "--limit") {
      const value = takeValue("--limit");
      if (!/^[1-9]\d*$/.test(value)) {
        throw new Error(
          `Invalid --limit '${value}'. Expected an integer from 1 to ${USAGE_MAX_TURN_PAGE_LIMIT}.`,
        );
      }
      const parsed = Number(value);
      if (parsed < 1 || parsed > USAGE_MAX_TURN_PAGE_LIMIT) {
        throw new Error(`--limit must be between 1 and ${USAGE_MAX_TURN_PAGE_LIMIT}.`);
      }
      options.limit = parsed;
      continue;
    }
    if (arg === "--out") {
      const value = takeValue("--out");
      if (!value.trim()) throw new Error("Invalid --out path.");
      options.out = value;
      continue;
    }
    throw new Error(`Unknown option '${arg}'. Run code60 usage --help.`);
  }

  if (options.force && !options.out) {
    throw new Error("--force requires --out <file>.");
  }
  options.query = parseValue(usageReportQuerySchema, options.query);
  return options;
}

function fmtInt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function fmtMix(metrics: UsageAggregateMetrics): string {
  if (metrics.turns === 0) return "none";
  const pct = (count: number) => Math.round((count / metrics.turns) * 100);
  const parts: string[] = [];
  if (metrics.exactTurns > 0) parts.push(`${pct(metrics.exactTurns)}% exact`);
  if (metrics.derivedTurns > 0) parts.push(`${pct(metrics.derivedTurns)}% derived`);
  if (metrics.lowerBoundTurns > 0) parts.push(`${pct(metrics.lowerBoundTurns)}% lower`);
  return parts.join(", ");
}

function fmtCosts(metrics: UsageAggregateMetrics): string {
  if (metrics.costs.length === 0) return "-";
  return metrics.costs
    .map((c) =>
      c.currency === "USD" ? `$${c.amount.toFixed(4)}` : `${c.amount.toFixed(4)} ${c.currency}`,
    )
    .join(", ");
}

function renderAsciiTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  rightAlign: readonly boolean[],
): string[] {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const pad = (value: string, width: number, right: boolean) =>
    right ? value.padStart(width) : value.padEnd(width);
  const line = (cells: readonly string[]) =>
    cells.map((cell, i) => pad(cell, widths[i] ?? 0, rightAlign[i] ?? false)).join("  ");
  return [line(headers), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)];
}

function formatUsageTable(report: UsageReport, turns?: readonly UsageTurnRecord[]): string {
  const lines: string[] = [];
  lines.push("Code60 Token Usage Report");
  lines.push(
    `Window: ${report.window.range}${report.window.since ? ` (since ${report.window.since})` : ""}${report.window.until ? ` (until ${report.window.until})` : ""}  |  Estimator: v${report.estimatorVersion}`,
  );
  lines.push(
    `Totals: ${fmtInt(report.totals.turns)} turns  |  ${fmtInt(report.totals.totalTokens)} est. tokens (${fmtInt(report.totals.newInputTokens)} new + ${fmtInt(report.totals.cachedOrRereadInputTokens)} cached/re-read + ${fmtInt(report.totals.outputTokens)} out)  |  Cost: ${fmtCosts(report.totals)}`,
  );
  lines.push(
    `Activity: ${fmtInt(report.totals.netContextDelta)} net context delta  |  ${fmtInt(report.totals.toolCalls)} tool calls (${fmtInt(report.totals.toolWaves)} waves)  |  ${fmtInt(report.totals.compactions)} compactions  |  Mix: ${fmtMix(report.totals)}`,
  );
  lines.push("");

  lines.push("Provider Burn Rate");
  if (report.providers.length === 0) {
    lines.push("  (no usage records matched the selected window and filters)");
  } else {
    const rows: string[][] = [];
    for (const p of report.providers) {
      rows.push([
        p.provider,
        fmtInt(p.turns),
        fmtInt(p.totalTokens),
        fmtInt(p.newInputTokens),
        fmtInt(p.cachedOrRereadInputTokens),
        fmtInt(p.outputTokens),
        fmtInt(p.netContextDelta),
        fmtCosts(p),
        fmtMix(p),
      ]);
      for (const m of p.models) {
        rows.push([
          `  ${m.model}`,
          fmtInt(m.turns),
          fmtInt(m.totalTokens),
          fmtInt(m.newInputTokens),
          fmtInt(m.cachedOrRereadInputTokens),
          fmtInt(m.outputTokens),
          fmtInt(m.netContextDelta),
          fmtCosts(m),
          fmtMix(m),
        ]);
      }
    }
    lines.push(
      ...renderAsciiTable(
        [
          "Provider / Model",
          "Turns",
          "Est. Total",
          "New In",
          "Cached/Re",
          "Out",
          "Net Δ",
          "Cost",
          "Mix",
        ],
        rows,
        [false, true, true, true, true, true, true, true, false],
      ),
    );
  }
  lines.push("");

  lines.push("Surface Breakdown");
  if (report.surfaces.length === 0) {
    lines.push("  (none)");
  } else {
    const rows = report.surfaces.map((s) => [
      s.helperKind ? `${s.surface}:${s.helperKind}` : s.surface,
      fmtInt(s.turns),
      fmtInt(s.totalTokens),
      fmtInt(s.newInputTokens),
      fmtInt(s.cachedOrRereadInputTokens),
      fmtInt(s.outputTokens),
      fmtInt(s.toolWaves),
      fmtInt(s.compactions),
    ]);
    lines.push(
      ...renderAsciiTable(
        ["Surface", "Turns", "Est. Total", "New In", "Cached/Re", "Out", "Waves", "Compactions"],
        rows,
        [false, true, true, true, true, true, true, true],
      ),
    );
  }
  lines.push("");

  lines.push("Heavy Sessions & Workflows (Hotspots)");
  if (report.hotspots.length === 0) {
    lines.push("  (none)");
  } else {
    const rows = report.hotspots
      .slice(0, 15)
      .map((h) => [
        h.workflowId ?? h.conversationId ?? h.runId ?? h.sessionId,
        h.helperKind ? `${h.surface}:${h.helperKind}` : h.surface,
        h.model ? `${h.provider}/${h.model}` : h.provider,
        fmtInt(h.turns),
        fmtInt(h.totalTokens),
        fmtInt(h.netContextDelta),
        h.peakContextPercent !== null ? `${h.peakContextPercent.toFixed(1)}%` : "-",
        fmtInt(h.maxToolWaves),
        fmtInt(h.compactions),
      ]);
    lines.push(
      ...renderAsciiTable(
        [
          "Target",
          "Surface",
          "Provider/Model",
          "Turns",
          "Est. Total",
          "Net Δ",
          "Peak Fill",
          "Max Waves",
          "Compactions",
        ],
        rows,
        [false, false, false, true, true, true, true, true, true],
      ),
    );
  }

  if (turns && turns.length > 0) {
    lines.push("");
    lines.push(`Turn Audit Log (${turns.length} turns)`);
    const rows = turns.map((t) => [
      t.at.slice(0, 19).replace("T", " "),
      t.provider,
      t.attribution.helperKind
        ? `${t.attribution.surface}:${t.attribution.helperKind}`
        : t.attribution.surface,
      String(t.turn),
      t.estimate.method,
      t.estimate.confidence,
      fmtInt(t.estimate.totalTokens),
      t.estimate.netContextDelta !== null ? fmtInt(t.estimate.netContextDelta) : "-",
      String(t.observed.toolWaves),
      t.context.compacted ? "yes" : "no",
    ]);
    lines.push(
      ...renderAsciiTable(
        [
          "Time (UTC)",
          "Provider",
          "Surface",
          "Turn",
          "Method",
          "Confidence",
          "Est. Total",
          "Net Δ",
          "Waves",
          "Compact",
        ],
        rows,
        [false, false, false, true, false, false, true, true, true, false],
      ),
    );
  }

  lines.push("");
  lines.push(`Note: ${USAGE_METHODOLOGY.summary}`);
  return `${lines.join("\n")}\n`;
}

async function readUsageData(
  env: NodeJS.ProcessEnv,
  query: UsageReportQuery,
  includeTurns: boolean,
  turnLimit: number,
  requestOnline: typeof managementRequest = managementRequest,
): Promise<{ report: UsageReport; turns?: UsageTurnRecord[] }> {
  try {
    const response = (await requestOnline(env, "usage", {
      query,
      includeTurns,
      turnLimit,
    })) as { report?: UsageReport; turns?: UsageTurnRecord[] };
    if (response?.report) {
      return {
        report: response.report,
        ...(response.turns ? { turns: response.turns } : {}),
      };
    }
  } catch {
    /* Fall back to offline read-only inspection when Code60 Gateway is not running. */
  }
  const store = openUsageStoreReadOnly(join(stateHome(env), "code60", "usage"));
  try {
    const report = store.report(query);
    const turns = includeTurns
      ? store.turns({ ...query, limit: turnLimit, offset: 0 }).turns
      : undefined;
    return { report, ...(turns ? { turns } : {}) };
  } finally {
    store.close();
  }
}

export async function runUsageCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  io: {
    stdout?: (text: string) => void;
    requestOnline?: typeof managementRequest;
  } = {},
): Promise<void> {
  const writeOut = io.stdout ?? ((text: string) => process.stdout.write(text));
  const options = parseUsageCliArgs(args);
  if (options.help) {
    writeOut(USAGE_HELP);
    return;
  }
  const includeTurns = options.turns || options.format === "csv";
  const { report, turns } = await readUsageData(
    env,
    options.query,
    includeTurns,
    options.limit,
    io.requestOnline,
  );
  const output =
    options.format === "table"
      ? formatUsageTable(report, options.turns ? turns : undefined)
      : buildUsageExport(options.format, report, includeTurns ? turns : undefined).content;

  if (options.out) {
    await writeFile(options.out, output, {
      encoding: "utf8",
      mode: 0o600,
      flag: options.force ? "w" : "wx",
    });
    writeOut(`Wrote ${options.format} usage report to ${options.out}\n`);
    return;
  }
  writeOut(output);
}
