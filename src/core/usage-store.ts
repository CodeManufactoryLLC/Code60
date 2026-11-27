import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  type AcpReportedUsage,
  USAGE_ESTIMATOR_VERSION,
  USAGE_MAX_EXPORT_TURNS,
  USAGE_MAX_TURN_PAGE_LIMIT,
  USAGE_RETENTION_DAYS,
  USAGE_RETENTION_MAX_ROWS,
  type UsageAggregateMetrics,
  type UsageConfidence,
  type UsageContextSnapshot,
  type UsageCostTotal,
  type UsageExportRequest,
  type UsageExportResult,
  type UsageHelperKind,
  type UsageHotspot,
  type UsageMethod,
  type UsageModelSummary,
  type UsageProviderSummary,
  type UsageReport,
  type UsageReportQuery,
  type UsageSink,
  type UsageStoreStatus,
  type UsageSurface,
  type UsageSurfaceSummary,
  type UsageTimelineBucket,
  type UsageTimeRange,
  type UsageTurnObservation,
  type UsageTurnPage,
  type UsageTurnRecord,
  type UsageTurnsQuery,
  usageTurnObservationSchema,
} from "../contracts/index.js";
import { estimateTurnUsage } from "./usage-estimator.js";
import { buildUsageExport } from "./usage-report-format.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS usage_turns (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  at TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  session_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  stop_reason TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  surface TEXT NOT NULL,
  helper_kind TEXT,
  run_id TEXT,
  conversation_id TEXT,
  workflow_id TEXT,
  workflow_step INTEGER,
  schedule_id TEXT,
  execution_id TEXT,
  project_id TEXT,
  reported_json TEXT,
  reported_scope TEXT,
  cost_delta REAL,
  cost_cumulative REAL,
  cost_currency TEXT,
  used_before INTEGER,
  used_after INTEGER,
  peak_used INTEGER,
  window_size INTEGER,
  snapshots_json TEXT NOT NULL,
  updates_count INTEGER NOT NULL,
  compacted INTEGER NOT NULL,
  prompt_chars INTEGER NOT NULL,
  prompt_bytes INTEGER NOT NULL,
  prompt_code_ratio REAL NOT NULL,
  message_chars INTEGER NOT NULL,
  message_bytes INTEGER NOT NULL,
  message_code_ratio REAL NOT NULL,
  thought_chars INTEGER NOT NULL,
  thought_bytes INTEGER NOT NULL,
  tool_calls INTEGER NOT NULL,
  tool_waves INTEGER NOT NULL,
  tool_payload_chars INTEGER NOT NULL,
  tool_payload_bytes INTEGER NOT NULL,
  raw_acp_bytes INTEGER NOT NULL,
  est_input_tokens INTEGER NOT NULL,
  est_new_input_tokens INTEGER NOT NULL,
  est_cached_or_reread_tokens INTEGER NOT NULL,
  est_output_tokens INTEGER NOT NULL,
  est_thought_tokens INTEGER,
  est_total_tokens INTEGER NOT NULL,
  net_context_delta INTEGER,
  method TEXT NOT NULL,
  confidence TEXT NOT NULL,
  estimator_version INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_turns_at ON usage_turns (at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_usage_turns_provider_at ON usage_turns (provider, at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_usage_turns_surface_at ON usage_turns (surface, at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_usage_turns_run ON usage_turns (run_id);
CREATE INDEX IF NOT EXISTS idx_usage_turns_workflow ON usage_turns (workflow_id);
CREATE INDEX IF NOT EXISTS idx_usage_turns_conversation ON usage_turns (conversation_id);
`;

const PRUNE_EVERY_WRITES = 250;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface UsageStoreOptions {
  now?: () => number;
  retentionDays?: number;
  maxRows?: number;
  readOnly?: boolean;
}

function emptyMetrics(): UsageAggregateMetrics {
  return {
    turns: 0,
    totalTokens: 0,
    inputTokens: 0,
    newInputTokens: 0,
    cachedOrRereadInputTokens: 0,
    outputTokens: 0,
    netContextDelta: 0,
    toolCalls: 0,
    toolWaves: 0,
    compactions: 0,
    durationMs: 0,
    costs: [],
    exactTurns: 0,
    derivedTurns: 0,
    lowerBoundTurns: 0,
  };
}

function addCost(costs: UsageCostTotal[], currency: string | null, delta: number | null): void {
  if (!currency || delta === null || !Number.isFinite(delta) || delta <= 0) return;
  const existing = costs.find((item) => item.currency === currency);
  if (existing) existing.amount = Number((existing.amount + delta).toFixed(8));
  else costs.push({ currency, amount: Number(delta.toFixed(8)) });
  costs.sort((a, b) => a.currency.localeCompare(b.currency));
}

function rangeMs(range: UsageTimeRange): number | null {
  if (range === "24h") return DAY_MS;
  if (range === "7d") return 7 * DAY_MS;
  if (range === "30d") return 30 * DAY_MS;
  return null;
}

function resolveWindow(
  query: UsageReportQuery | undefined,
  nowMs: number,
): {
  range: UsageTimeRange;
  since: string | null;
  sinceMs: number | null;
  until: string | null;
  untilMs: number | null;
} {
  const range: UsageTimeRange = query?.range ?? (query?.since ? "all" : "7d");
  const untilMs = query?.until ? Date.parse(query.until) : null;
  let sinceMs = query?.since ? Date.parse(query.since) : null;
  if (sinceMs === null) {
    const span = rangeMs(range);
    if (span !== null) sinceMs = nowMs - span;
  }
  return {
    range,
    since: sinceMs !== null && Number.isFinite(sinceMs) ? new Date(sinceMs).toISOString() : null,
    sinceMs: sinceMs !== null && Number.isFinite(sinceMs) ? Math.floor(sinceMs) : null,
    until: untilMs !== null && Number.isFinite(untilMs) ? new Date(untilMs).toISOString() : null,
    untilMs: untilMs !== null && Number.isFinite(untilMs) ? Math.floor(untilMs) : null,
  };
}

interface FilterClause {
  where: string;
  params: SQLInputValue[];
}

function buildFilter(
  query: UsageTurnsQuery | undefined,
  window: { sinceMs: number | null; untilMs: number | null },
): FilterClause {
  const parts: string[] = [];
  const params: SQLInputValue[] = [];
  if (window.sinceMs !== null) {
    parts.push("at_ms >= ?");
    params.push(window.sinceMs);
  }
  if (window.untilMs !== null) {
    parts.push("at_ms <= ?");
    params.push(window.untilMs);
  }
  if (query?.provider) {
    parts.push("provider = ?");
    params.push(query.provider);
  }
  if (query?.surface) {
    parts.push("surface = ?");
    params.push(query.surface);
  }
  if (query?.model) {
    parts.push("model = ?");
    params.push(query.model);
  }
  if (query?.confidence) {
    parts.push("confidence = ?");
    params.push(query.confidence);
  }
  if (query?.method) {
    parts.push("method = ?");
    params.push(query.method);
  }
  if (query?.sessionId) {
    parts.push("session_id = ?");
    params.push(query.sessionId);
  }
  if (query?.runId) {
    parts.push("run_id = ?");
    params.push(query.runId);
  }
  if (query?.workflowId) {
    parts.push("workflow_id = ?");
    params.push(query.workflowId);
  }
  if (query?.conversationId) {
    parts.push("conversation_id = ?");
    params.push(query.conversationId);
  }
  return { where: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
}

interface TurnRow {
  id: string;
  version: number;
  at: string;
  at_ms: number;
  provider: string;
  model: string | null;
  session_id: string;
  turn: number;
  stop_reason: string;
  duration_ms: number;
  surface: UsageSurface;
  helper_kind: UsageHelperKind | null;
  run_id: string | null;
  conversation_id: string | null;
  workflow_id: string | null;
  workflow_step: number | null;
  schedule_id: string | null;
  execution_id: string | null;
  project_id: string | null;
  reported_json: string | null;
  reported_scope: "turn" | "session_delta" | null;
  cost_delta: number | null;
  cost_cumulative: number | null;
  cost_currency: string | null;
  used_before: number | null;
  used_after: number | null;
  peak_used: number | null;
  window_size: number | null;
  snapshots_json: string;
  updates_count: number;
  compacted: number;
  prompt_chars: number;
  prompt_bytes: number;
  prompt_code_ratio: number;
  message_chars: number;
  message_bytes: number;
  message_code_ratio: number;
  thought_chars: number;
  thought_bytes: number;
  tool_calls: number;
  tool_waves: number;
  tool_payload_chars: number;
  tool_payload_bytes: number;
  raw_acp_bytes: number;
  est_input_tokens: number;
  est_new_input_tokens: number;
  est_cached_or_reread_tokens: number;
  est_output_tokens: number;
  est_thought_tokens: number | null;
  est_total_tokens: number;
  net_context_delta: number | null;
  method: UsageMethod;
  confidence: UsageConfidence;
  estimator_version: number;
}

function rowToRecord(row: TurnRow): UsageTurnRecord {
  let reported: AcpReportedUsage | undefined;
  if (row.reported_json) {
    try {
      reported = JSON.parse(row.reported_json) as AcpReportedUsage;
    } catch {
      reported = undefined;
    }
  }
  let snapshots: UsageContextSnapshot[] = [];
  try {
    const parsed = JSON.parse(row.snapshots_json);
    if (Array.isArray(parsed)) snapshots = parsed as UsageContextSnapshot[];
  } catch {
    snapshots = [];
  }
  return {
    version: 1,
    id: row.id,
    at: row.at,
    provider: row.provider,
    model: row.model,
    sessionId: row.session_id,
    turn: row.turn,
    stopReason: row.stop_reason,
    durationMs: row.duration_ms,
    attribution: {
      surface: row.surface,
      ...(row.helper_kind ? { helperKind: row.helper_kind } : {}),
      ...(row.run_id ? { runId: row.run_id } : {}),
      ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
      ...(row.workflow_id ? { workflowId: row.workflow_id } : {}),
      ...(row.workflow_step !== null ? { workflowStep: row.workflow_step } : {}),
      ...(row.schedule_id ? { scheduleId: row.schedule_id } : {}),
      ...(row.execution_id ? { executionId: row.execution_id } : {}),
      ...(row.project_id ? { projectId: row.project_id } : {}),
    },
    ...(reported ? { reported } : {}),
    ...(row.reported_scope ? { reportedScope: row.reported_scope } : {}),
    ...(row.cost_currency !== null && row.cost_delta !== null && row.cost_cumulative !== null
      ? {
          cost: {
            delta: row.cost_delta,
            cumulative: row.cost_cumulative,
            currency: row.cost_currency,
          },
        }
      : {}),
    context: {
      usedBefore: row.used_before,
      usedAfter: row.used_after,
      peakUsed: row.peak_used,
      windowSize: row.window_size,
      snapshots,
      updatesCount: row.updates_count,
      compacted: row.compacted === 1,
    },
    observed: {
      promptChars: row.prompt_chars,
      promptBytes: row.prompt_bytes,
      promptCodeRatio: row.prompt_code_ratio,
      messageChars: row.message_chars,
      messageBytes: row.message_bytes,
      messageCodeRatio: row.message_code_ratio,
      thoughtChars: row.thought_chars,
      thoughtBytes: row.thought_bytes,
      toolCallCount: row.tool_calls,
      toolWaves: row.tool_waves,
      toolPayloadChars: row.tool_payload_chars,
      toolPayloadBytes: row.tool_payload_bytes,
      rawAcpBytes: row.raw_acp_bytes,
    },
    estimate: {
      inputTokens: row.est_input_tokens,
      newInputTokens: row.est_new_input_tokens,
      cachedOrRereadInputTokens: row.est_cached_or_reread_tokens,
      outputTokens: row.est_output_tokens,
      thoughtTokens: row.est_thought_tokens,
      totalTokens: row.est_total_tokens,
      netContextDelta: row.net_context_delta,
      method: row.method,
      confidence: row.confidence,
      estimatorVersion: row.estimator_version,
    },
  };
}

function accumulateMetrics(
  target: UsageAggregateMetrics,
  row: {
    turns: number;
    totalTokens: number;
    inputTokens: number;
    newInputTokens: number;
    cachedOrRereadInputTokens: number;
    outputTokens: number;
    netContextDelta: number;
    toolCalls: number;
    toolWaves: number;
    compactions: number;
    durationMs: number;
    exactTurns: number;
    derivedTurns: number;
    lowerBoundTurns: number;
  },
): void {
  target.turns += row.turns;
  target.totalTokens += row.totalTokens;
  target.inputTokens += row.inputTokens;
  target.newInputTokens += row.newInputTokens;
  target.cachedOrRereadInputTokens += row.cachedOrRereadInputTokens;
  target.outputTokens += row.outputTokens;
  target.netContextDelta += row.netContextDelta;
  target.toolCalls += row.toolCalls;
  target.toolWaves += row.toolWaves;
  target.compactions += row.compactions;
  target.durationMs += row.durationMs;
  target.exactTurns += row.exactTurns;
  target.derivedTurns += row.derivedTurns;
  target.lowerBoundTurns += row.lowerBoundTurns;
}

/** Private local SQLite ledger for provider token usage monitoring and reporting. */
export class UsageStore {
  readonly filePath: string;
  private readonly now: () => number;
  private readonly retentionDays: number;
  private readonly maxRows: number;
  private readonly readOnly: boolean;
  private db: DatabaseSync | undefined;
  private closed = false;
  private writesSincePrune = 0;
  private dropped = 0;
  private persistenceFailures = 0;
  private unavailable = false;
  private readonly listeners = new Set<() => void>();
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly directory: string,
    options: UsageStoreOptions = {},
  ) {
    this.filePath = join(directory, "usage.sqlite");
    this.now = options.now ?? Date.now;
    this.retentionDays = options.retentionDays ?? USAGE_RETENTION_DAYS;
    this.maxRows = options.maxRows ?? USAGE_RETENTION_MAX_ROWS;
    this.readOnly = options.readOnly === true;
    this.open();
  }

  private open(): void {
    try {
      if (this.readOnly) {
        if (!existsSync(this.filePath)) return;
        this.db = new DatabaseSync(this.filePath, { readOnly: true });
        return;
      }
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const db = new DatabaseSync(this.filePath);
      db.exec(
        "PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;",
      );
      db.exec(SCHEMA_SQL);
      try {
        chmodSync(this.filePath, 0o600);
      } catch {
        /* Best-effort permission hardening. */
      }
      this.db = db;
    } catch {
      this.unavailable = true;
      this.persistenceFailures++;
      this.db = undefined;
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyChanged(): void {
    if (this.noticeTimer || this.closed || this.listeners.size === 0) return;
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = undefined;
      for (const listener of this.listeners) {
        try {
          listener();
        } catch {
          /* Never disrupt writers. */
        }
      }
    }, 300);
    this.noticeTimer.unref();
  }

  readonly sink: UsageSink = (observation) => {
    this.record(observation);
  };

  record(observation: UsageTurnObservation): UsageTurnRecord | undefined {
    if (this.closed || this.readOnly) return undefined;
    const parsed = usageTurnObservationSchema.safeParse(observation);
    if (!parsed.success) {
      this.dropped++;
      return undefined;
    }
    if (!this.db) {
      this.dropped++;
      this.persistenceFailures++;
      return undefined;
    }
    const data = parsed.data;
    const estimate = estimateTurnUsage(data);
    const id = randomUUID();
    const atMs = Date.parse(data.at);
    const safeAtMs = Number.isFinite(atMs) ? Math.floor(atMs) : Math.floor(this.now());

    try {
      this.db
        .prepare(
          `INSERT INTO usage_turns (
            id, version, at, at_ms, provider, model, session_id, turn, stop_reason, duration_ms,
            surface, helper_kind, run_id, conversation_id, workflow_id, workflow_step,
            schedule_id, execution_id, project_id,
            reported_json, reported_scope, cost_delta, cost_cumulative, cost_currency,
            used_before, used_after, peak_used, window_size, snapshots_json, updates_count, compacted,
            prompt_chars, prompt_bytes, prompt_code_ratio,
            message_chars, message_bytes, message_code_ratio,
            thought_chars, thought_bytes, tool_calls, tool_waves,
            tool_payload_chars, tool_payload_bytes, raw_acp_bytes,
            est_input_tokens, est_new_input_tokens, est_cached_or_reread_tokens,
            est_output_tokens, est_thought_tokens, est_total_tokens, net_context_delta,
            method, confidence, estimator_version
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?
          )`,
        )
        .run(
          id,
          1,
          data.at,
          safeAtMs,
          data.provider,
          data.model,
          data.sessionId,
          data.turn,
          data.stopReason,
          data.durationMs,
          data.attribution.surface,
          data.attribution.helperKind ?? null,
          data.attribution.runId ?? null,
          data.attribution.conversationId ?? null,
          data.attribution.workflowId ?? null,
          data.attribution.workflowStep ?? null,
          data.attribution.scheduleId ?? null,
          data.attribution.executionId ?? null,
          data.attribution.projectId ?? null,
          data.reported ? JSON.stringify(data.reported) : null,
          data.reportedScope ?? null,
          data.cost?.delta ?? null,
          data.cost?.cumulative ?? null,
          data.cost?.currency ?? null,
          data.context.usedBefore,
          data.context.usedAfter,
          data.context.peakUsed,
          data.context.windowSize,
          JSON.stringify(data.context.snapshots),
          data.context.updatesCount,
          data.context.compacted ? 1 : 0,
          data.observed.promptChars,
          data.observed.promptBytes,
          data.observed.promptCodeRatio,
          data.observed.messageChars,
          data.observed.messageBytes,
          data.observed.messageCodeRatio,
          data.observed.thoughtChars,
          data.observed.thoughtBytes,
          data.observed.toolCallCount,
          data.observed.toolWaves,
          data.observed.toolPayloadChars,
          data.observed.toolPayloadBytes,
          data.observed.rawAcpBytes,
          estimate.inputTokens,
          estimate.newInputTokens,
          estimate.cachedOrRereadInputTokens,
          estimate.outputTokens,
          estimate.thoughtTokens,
          estimate.totalTokens,
          estimate.netContextDelta,
          estimate.method,
          estimate.confidence,
          estimate.estimatorVersion,
        );

      this.writesSincePrune++;
      if (this.writesSincePrune >= PRUNE_EVERY_WRITES) {
        this.writesSincePrune = 0;
        this.prune();
      }
      this.notifyChanged();
      return { ...data, version: 1, id, estimate };
    } catch {
      this.dropped++;
      this.persistenceFailures++;
      return undefined;
    }
  }

  prune(): void {
    if (!this.db || this.readOnly) return;
    try {
      const cutoff = Math.floor(this.now() - this.retentionDays * DAY_MS);
      this.db.prepare("DELETE FROM usage_turns WHERE at_ms < ?").run(cutoff);
      const countRow = this.db.prepare("SELECT COUNT(*) AS count FROM usage_turns").get() as
        | { count: number }
        | undefined;
      const total = countRow?.count ?? 0;
      if (total > this.maxRows) {
        const excess = total - this.maxRows;
        this.db
          .prepare(
            "DELETE FROM usage_turns WHERE id IN (SELECT id FROM usage_turns ORDER BY at_ms ASC, rowid ASC LIMIT ?)",
          )
          .run(excess);
      }
    } catch {
      this.persistenceFailures++;
    }
  }

  status(): UsageStoreStatus {
    let totalStoredTurns = 0;
    if (this.db) {
      try {
        const row = this.db.prepare("SELECT COUNT(*) AS count FROM usage_turns").get() as
          | { count: number }
          | undefined;
        totalStoredTurns = row?.count ?? 0;
      } catch {
        this.persistenceFailures++;
      }
    }
    return {
      totalStoredTurns,
      dropped: this.dropped,
      persistenceFailures: this.persistenceFailures,
      unavailable: this.unavailable,
    };
  }

  report(query?: UsageReportQuery): UsageReport {
    const nowMs = this.now();
    const generatedAt = new Date(nowMs).toISOString();
    const window = resolveWindow(query, nowMs);
    const storeStatus = this.status();

    const empty: UsageReport = {
      generatedAt,
      estimatorVersion: USAGE_ESTIMATOR_VERSION,
      retentionDays: this.retentionDays,
      retentionMaxRows: this.maxRows,
      window: { range: window.range, since: window.since, until: window.until },
      filters: {
        provider: query?.provider ?? null,
        surface: query?.surface ?? null,
        model: query?.model ?? null,
        confidence: query?.confidence ?? null,
      },
      status: storeStatus,
      totals: emptyMetrics(),
      providers: [],
      surfaces: [],
      hotspots: [],
      workflows: [],
      sessions: [],
      timeline: [],
    };
    if (!this.db) return empty;

    const { where, params } = buildFilter(query, window);

    // 1. Provider + Model aggregation
    type GroupRow = {
      provider: string;
      model: string | null;
      turns: number;
      totalTokens: number;
      inputTokens: number;
      newInputTokens: number;
      cachedOrRereadInputTokens: number;
      outputTokens: number;
      netContextDelta: number;
      toolCalls: number;
      toolWaves: number;
      compactions: number;
      durationMs: number;
      exactTurns: number;
      derivedTurns: number;
      lowerBoundTurns: number;
    };

    const modelRows = this.db
      .prepare(
        `SELECT
          provider,
          COALESCE(model, 'unknown') AS model,
          COUNT(*) AS turns,
          COALESCE(SUM(est_total_tokens), 0) AS totalTokens,
          COALESCE(SUM(est_input_tokens), 0) AS inputTokens,
          COALESCE(SUM(est_new_input_tokens), 0) AS newInputTokens,
          COALESCE(SUM(est_cached_or_reread_tokens), 0) AS cachedOrRereadInputTokens,
          COALESCE(SUM(est_output_tokens), 0) AS outputTokens,
          COALESCE(SUM(COALESCE(net_context_delta, 0)), 0) AS netContextDelta,
          COALESCE(SUM(tool_calls), 0) AS toolCalls,
          COALESCE(SUM(tool_waves), 0) AS toolWaves,
          COALESCE(SUM(compacted), 0) AS compactions,
          COALESCE(SUM(duration_ms), 0) AS durationMs,
          COALESCE(SUM(CASE WHEN confidence = 'exact' THEN 1 ELSE 0 END), 0) AS exactTurns,
          COALESCE(SUM(CASE WHEN confidence = 'derived' THEN 1 ELSE 0 END), 0) AS derivedTurns,
          COALESCE(SUM(CASE WHEN confidence = 'lower_bound' THEN 1 ELSE 0 END), 0) AS lowerBoundTurns
        FROM usage_turns
        ${where}
        GROUP BY provider, COALESCE(model, 'unknown')
        ORDER BY totalTokens DESC`,
      )
      .all(...params) as GroupRow[];

    const costRows = this.db
      .prepare(
        `SELECT
          provider,
          COALESCE(model, 'unknown') AS model,
          surface,
          helper_kind AS helperKind,
          cost_currency AS currency,
          COALESCE(SUM(cost_delta), 0) AS amount
        FROM usage_turns
        ${where ? `${where} AND cost_currency IS NOT NULL AND cost_delta IS NOT NULL` : "WHERE cost_currency IS NOT NULL AND cost_delta IS NOT NULL"}
        GROUP BY provider, COALESCE(model, 'unknown'), surface, helper_kind, cost_currency`,
      )
      .all(...params) as {
      provider: string;
      model: string;
      surface: UsageSurface;
      helperKind: UsageHelperKind | null;
      currency: string;
      amount: number;
    }[];

    const totals = emptyMetrics();
    const providerMap = new Map<string, UsageProviderSummary>();
    for (const row of modelRows) {
      const modelSummary: UsageModelSummary = {
        model: row.model ?? "unknown",
        ...emptyMetrics(),
      };
      accumulateMetrics(modelSummary, row);
      let providerSummary = providerMap.get(row.provider);
      if (!providerSummary) {
        providerSummary = { provider: row.provider, ...emptyMetrics(), models: [] };
        providerMap.set(row.provider, providerSummary);
      }
      accumulateMetrics(providerSummary, row);
      accumulateMetrics(totals, row);
      providerSummary.models.push(modelSummary);
    }

    // 2. Surface breakdown
    type SurfaceRow = {
      surface: UsageSurface;
      helperKind: UsageHelperKind | null;
      turns: number;
      totalTokens: number;
      inputTokens: number;
      newInputTokens: number;
      cachedOrRereadInputTokens: number;
      outputTokens: number;
      netContextDelta: number;
      toolCalls: number;
      toolWaves: number;
      compactions: number;
      durationMs: number;
      exactTurns: number;
      derivedTurns: number;
      lowerBoundTurns: number;
    };

    const surfaceRows = this.db
      .prepare(
        `SELECT
          surface,
          helper_kind AS helperKind,
          COUNT(*) AS turns,
          COALESCE(SUM(est_total_tokens), 0) AS totalTokens,
          COALESCE(SUM(est_input_tokens), 0) AS inputTokens,
          COALESCE(SUM(est_new_input_tokens), 0) AS newInputTokens,
          COALESCE(SUM(est_cached_or_reread_tokens), 0) AS cachedOrRereadInputTokens,
          COALESCE(SUM(est_output_tokens), 0) AS outputTokens,
          COALESCE(SUM(COALESCE(net_context_delta, 0)), 0) AS netContextDelta,
          COALESCE(SUM(tool_calls), 0) AS toolCalls,
          COALESCE(SUM(tool_waves), 0) AS toolWaves,
          COALESCE(SUM(compacted), 0) AS compactions,
          COALESCE(SUM(duration_ms), 0) AS durationMs,
          COALESCE(SUM(CASE WHEN confidence = 'exact' THEN 1 ELSE 0 END), 0) AS exactTurns,
          COALESCE(SUM(CASE WHEN confidence = 'derived' THEN 1 ELSE 0 END), 0) AS derivedTurns,
          COALESCE(SUM(CASE WHEN confidence = 'lower_bound' THEN 1 ELSE 0 END), 0) AS lowerBoundTurns
        FROM usage_turns
        ${where}
        GROUP BY surface, helper_kind
        ORDER BY totalTokens DESC`,
      )
      .all(...params) as SurfaceRow[];

    const surfaceMap = new Map<string, UsageSurfaceSummary>();
    for (const row of surfaceRows) {
      const key = `${row.surface}:${row.helperKind ?? ""}`;
      const summary: UsageSurfaceSummary = {
        surface: row.surface,
        helperKind: row.helperKind,
        ...emptyMetrics(),
      };
      accumulateMetrics(summary, row);
      surfaceMap.set(key, summary);
    }

    for (const cost of costRows) {
      addCost(totals.costs, cost.currency, cost.amount);
      const prov = providerMap.get(cost.provider);
      if (prov) {
        addCost(prov.costs, cost.currency, cost.amount);
        const mod = prov.models.find((m) => m.model === cost.model);
        if (mod) addCost(mod.costs, cost.currency, cost.amount);
      }
      const surf = surfaceMap.get(`${cost.surface}:${cost.helperKind ?? ""}`);
      if (surf) addCost(surf.costs, cost.currency, cost.amount);
    }

    const providers = [...providerMap.values()].sort((a, b) => b.totalTokens - a.totalTokens);
    for (const provider of providers) {
      provider.models.sort((a, b) => b.totalTokens - a.totalTokens);
    }
    const surfaces = [...surfaceMap.values()].sort((a, b) => b.totalTokens - a.totalTokens);

    // 3. Hotspots (top heavy chats, workflows, runs, and scheduled jobs)
    type HotspotRow = {
      targetKey: string;
      surface: UsageSurface;
      helperKind: UsageHelperKind | null;
      provider: string;
      model: string | null;
      sessionId: string;
      runId: string | null;
      conversationId: string | null;
      workflowId: string | null;
      scheduleId: string | null;
      projectId: string | null;
      firstAt: string;
      lastAt: string;
      turns: number;
      totalTokens: number;
      newInputTokens: number;
      cachedOrRereadInputTokens: number;
      outputTokens: number;
      netContextDelta: number;
      peakContextUsed: number | null;
      contextWindowSize: number | null;
      maxToolWaves: number;
      totalToolWaves: number;
      totalToolCalls: number;
      compactions: number;
      exactTurns: number;
      derivedTurns: number;
      lowerBoundTurns: number;
    };

    const mapHotspotRow = (row: HotspotRow, key: string): UsageHotspot => ({
      key,
      surface: row.surface,
      helperKind: row.helperKind,
      provider: row.provider,
      model: row.model,
      sessionId: row.sessionId,
      runId: row.runId,
      conversationId: row.conversationId,
      workflowId: row.workflowId,
      scheduleId: row.scheduleId,
      projectId: row.projectId,
      firstAt: row.firstAt,
      lastAt: row.lastAt,
      turns: row.turns,
      totalTokens: row.totalTokens,
      newInputTokens: row.newInputTokens,
      cachedOrRereadInputTokens: row.cachedOrRereadInputTokens,
      outputTokens: row.outputTokens,
      netContextDelta: row.netContextDelta,
      peakContextUsed: row.peakContextUsed,
      contextWindowSize: row.contextWindowSize,
      peakContextPercent:
        row.peakContextUsed !== null && row.contextWindowSize && row.contextWindowSize > 0
          ? Number(((row.peakContextUsed / row.contextWindowSize) * 100).toFixed(1))
          : null,
      maxToolWaves: row.maxToolWaves,
      totalToolWaves: row.totalToolWaves,
      totalToolCalls: row.totalToolCalls,
      compactions: row.compactions,
      exactTurns: row.exactTurns,
      derivedTurns: row.derivedTurns,
      lowerBoundTurns: row.lowerBoundTurns,
    });

    const hotspotColumns = `
          surface,
          helper_kind AS helperKind,
          provider,
          MAX(model) AS model,
          MAX(session_id) AS sessionId,
          MAX(run_id) AS runId,
          MAX(conversation_id) AS conversationId,
          MAX(workflow_id) AS workflowId,
          MAX(schedule_id) AS scheduleId,
          MAX(project_id) AS projectId,
          MIN(at) AS firstAt,
          MAX(at) AS lastAt,
          COUNT(*) AS turns,
          COALESCE(SUM(est_total_tokens), 0) AS totalTokens,
          COALESCE(SUM(est_new_input_tokens), 0) AS newInputTokens,
          COALESCE(SUM(est_cached_or_reread_tokens), 0) AS cachedOrRereadInputTokens,
          COALESCE(SUM(est_output_tokens), 0) AS outputTokens,
          COALESCE(SUM(COALESCE(net_context_delta, 0)), 0) AS netContextDelta,
          MAX(peak_used) AS peakContextUsed,
          MAX(window_size) AS contextWindowSize,
          COALESCE(MAX(tool_waves), 0) AS maxToolWaves,
          COALESCE(SUM(tool_waves), 0) AS totalToolWaves,
          COALESCE(SUM(tool_calls), 0) AS totalToolCalls,
          COALESCE(SUM(compacted), 0) AS compactions,
          COALESCE(SUM(CASE WHEN confidence = 'exact' THEN 1 ELSE 0 END), 0) AS exactTurns,
          COALESCE(SUM(CASE WHEN confidence = 'derived' THEN 1 ELSE 0 END), 0) AS derivedTurns,
          COALESCE(SUM(CASE WHEN confidence = 'lower_bound' THEN 1 ELSE 0 END), 0) AS lowerBoundTurns`;

    const hotspotRows = this.db
      .prepare(
        `SELECT
          COALESCE(workflow_id, conversation_id, run_id, session_id) AS targetKey,
          ${hotspotColumns}
        FROM usage_turns
        ${where}
        GROUP BY targetKey, surface, helper_kind, provider
        ORDER BY totalTokens DESC
        LIMIT 50`,
      )
      .all(...params) as HotspotRow[];

    const hotspots: UsageHotspot[] = hotspotRows.map((row) =>
      mapHotspotRow(row, `${row.surface}:${row.provider}:${row.targetKey}`),
    );

    const workflowWhere = where
      ? `${where} AND workflow_id IS NOT NULL`
      : "WHERE workflow_id IS NOT NULL";
    const workflowRows = this.db
      .prepare(
        `SELECT
          workflow_id AS targetKey,
          ${hotspotColumns}
        FROM usage_turns
        ${workflowWhere}
        GROUP BY workflow_id, provider
        ORDER BY totalTokens DESC
        LIMIT 100`,
      )
      .all(...params) as HotspotRow[];

    const workflows: UsageHotspot[] = workflowRows.map((row) =>
      mapHotspotRow(row, `workflow:${row.provider}:${row.targetKey}`),
    );

    const sessionRows = this.db
      .prepare(
        `SELECT
          session_id AS targetKey,
          ${hotspotColumns}
        FROM usage_turns
        ${where}
        GROUP BY session_id, surface, helper_kind, provider
        ORDER BY totalTokens DESC
        LIMIT 100`,
      )
      .all(...params) as HotspotRow[];

    const sessions: UsageHotspot[] = sessionRows.map((row) =>
      mapHotspotRow(row, `session:${row.surface}:${row.provider}:${row.targetKey}`),
    );

    // 4. Timeline buckets (hourly for <=48h, daily otherwise)
    const spanMs = window.sinceMs !== null ? (window.untilMs ?? nowMs) - window.sinceMs : null;
    const bucketLen = spanMs !== null && spanMs <= 48 * 60 * 60 * 1000 ? 13 : 10;
    const timelineRows = this.db
      .prepare(
        `SELECT
          substr(at, 1, ?) AS bucket,
          COUNT(*) AS turns,
          COALESCE(SUM(est_total_tokens), 0) AS totalTokens,
          COALESCE(SUM(est_new_input_tokens), 0) AS newInputTokens,
          COALESCE(SUM(est_cached_or_reread_tokens), 0) AS cachedOrRereadInputTokens,
          COALESCE(SUM(est_output_tokens), 0) AS outputTokens
        FROM usage_turns
        ${where}
        GROUP BY bucket
        ORDER BY bucket ASC`,
      )
      .all(bucketLen, ...params) as unknown as UsageTimelineBucket[];

    return {
      ...empty,
      totals,
      providers,
      surfaces,
      hotspots,
      workflows,
      sessions,
      timeline: timelineRows,
    };
  }

  turns(query?: UsageTurnsQuery): UsageTurnPage {
    const limit = Math.min(USAGE_MAX_TURN_PAGE_LIMIT, Math.max(1, query?.limit ?? 50));
    const offset = Math.max(0, query?.offset ?? 0);
    if (!this.db) {
      return { turns: [], total: 0, offset, limit, hasMore: false };
    }
    const window = resolveWindow(query, this.now());
    const { where, params } = buildFilter(query, window);

    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM usage_turns ${where}`)
      .get(...params) as { total: number } | undefined;
    const total = countRow?.total ?? 0;

    const rows = this.db
      .prepare(
        `SELECT * FROM usage_turns ${where} ORDER BY at_ms DESC, rowid DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as unknown as TurnRow[];

    const turns = rows.map(rowToRecord);
    return {
      turns,
      total,
      offset,
      limit,
      hasMore: offset + turns.length < total,
    };
  }

  exportReport(request: UsageExportRequest): UsageExportResult {
    const report = this.report(request);
    let turns: UsageTurnRecord[] | undefined;
    if (request.includeTurns !== false && (request.format === "csv" || request.includeTurns)) {
      const limit = Math.min(USAGE_MAX_EXPORT_TURNS, Math.max(1, request.turnLimit ?? 1_000));
      turns = this.readTurnsUpTo(request, limit);
    }
    return buildUsageExport(request.format, report, turns);
  }

  private readTurnsUpTo(query: UsageReportQuery, limit: number): UsageTurnRecord[] {
    if (!this.db) return [];
    const window = resolveWindow(query, this.now());
    const { where, params } = buildFilter(query, window);
    const rows = this.db
      .prepare(`SELECT * FROM usage_turns ${where} ORDER BY at_ms DESC, rowid DESC LIMIT ?`)
      .all(...params, limit) as unknown as TurnRow[];
    return rows.map(rowToRecord);
  }

  clear(): { deleted: number } {
    if (!this.db || this.readOnly) return { deleted: 0 };
    const result = this.db.prepare("DELETE FROM usage_turns").run();
    const deleted = Number(result.changes ?? 0);
    this.notifyChanged();
    return { deleted };
  }

  close(): void {
    this.closed = true;
    if (this.noticeTimer) {
      clearTimeout(this.noticeTimer);
      this.noticeTimer = undefined;
    }
    this.listeners.clear();
    try {
      this.db?.close();
    } catch {
      /* Ignore close error during shutdown. */
    }
    this.db = undefined;
  }
}

export function openUsageStoreReadOnly(directory: string, now?: () => number): UsageStore {
  return new UsageStore(directory, { readOnly: true, ...(now ? { now } : {}) });
}
