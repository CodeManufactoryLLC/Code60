import { z } from "zod";

// Re-exports run before index.ts; disable Zod code generation here too.
z.config({ jitless: true });

export const USAGE_ESTIMATOR_VERSION = 1;
export const USAGE_RETENTION_DAYS = 90;
export const USAGE_RETENTION_MAX_ROWS = 500_000;
export const USAGE_MAX_TURN_PAGE_LIMIT = 200;
export const USAGE_MAX_EXPORT_TURNS = 5_000;

export const USAGE_SURFACES = [
  "relay",
  "custom-assistant",
  "project-chat",
  "worker",
  "scheduled-job",
  "workflow",
  "helper",
] as const;
const usageSurfaceSchema = z.enum(USAGE_SURFACES);
export type UsageSurface = z.infer<typeof usageSurfaceSchema>;

const USAGE_HELPER_KINDS = [
  "chat-title",
  "agent-memory",
  "episodic-memory",
  "search-summary",
  "workflow-draft",
] as const;
const usageHelperKindSchema = z.enum(USAGE_HELPER_KINDS);
export type UsageHelperKind = z.infer<typeof usageHelperKindSchema>;

const USAGE_METHODS = [
  "acp_reported",
  "usage_update_sum",
  "context_wave_model",
  "text_lower_bound",
] as const;
const usageMethodSchema = z.enum(USAGE_METHODS);
export type UsageMethod = z.infer<typeof usageMethodSchema>;

const USAGE_CONFIDENCES = ["exact", "derived", "lower_bound"] as const;
const usageConfidenceSchema = z.enum(USAGE_CONFIDENCES);
export type UsageConfidence = z.infer<typeof usageConfidenceSchema>;

export const USAGE_TIME_RANGES = ["24h", "7d", "30d", "all"] as const;
const usageTimeRangeSchema = z.enum(USAGE_TIME_RANGES);
export type UsageTimeRange = z.infer<typeof usageTimeRangeSchema>;

const USAGE_EXPORT_FORMATS = ["json", "csv", "markdown"] as const;
const usageExportFormatSchema = z.enum(USAGE_EXPORT_FORMATS);
export type UsageExportFormat = z.infer<typeof usageExportFormatSchema>;

const nonnegInt = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const nonnegFinite = z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER);
const ratio = z.number().finite().min(0).max(1);
const opaqueId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
const shortLabel = z.string().min(1).max(64);
const modelLabel = z.string().min(1).max(256);
const currencyCode = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-zA-Z0-9_.-]+$/);

/** Non-sensitive execution attribution carried internally on AgentSpec. */
const usageAttributionSchema = z.strictObject({
  surface: usageSurfaceSchema,
  helperKind: usageHelperKindSchema.optional(),
  runId: opaqueId.optional(),
  conversationId: opaqueId.optional(),
  workflowId: opaqueId.optional(),
  workflowStep: nonnegInt.optional(),
  scheduleId: opaqueId.optional(),
  executionId: opaqueId.optional(),
  projectId: z
    .string()
    .regex(/^[a-f0-9]{16}$/)
    .optional(),
});
export type UsageAttribution = z.infer<typeof usageAttributionSchema>;

/** Defensive parser for optional unstable ACP PromptResponse.usage payloads. */
export const acpReportedUsageSchema = z.object({
  totalTokens: nonnegInt,
  inputTokens: nonnegInt,
  outputTokens: nonnegInt,
  thoughtTokens: nonnegInt.nullish(),
  cachedReadTokens: nonnegInt.nullish(),
  cachedWriteTokens: nonnegInt.nullish(),
});
export type AcpReportedUsage = z.infer<typeof acpReportedUsageSchema>;

/** Defensive parser for stable ACP UsageUpdate.cost payloads. */
export const acpCostSchema = z.object({
  amount: nonnegFinite,
  currency: currencyCode,
});
export type AcpCost = z.infer<typeof acpCostSchema>;

const usageContextSnapshotSchema = z.strictObject({
  used: nonnegInt,
  size: nonnegInt,
});
export type UsageContextSnapshot = z.infer<typeof usageContextSnapshotSchema>;

const usageTurnCostSchema = z.strictObject({
  delta: nonnegFinite,
  cumulative: nonnegFinite,
  currency: currencyCode,
});

const usageTurnContextSchema = z.strictObject({
  usedBefore: nonnegInt.nullable(),
  usedAfter: nonnegInt.nullable(),
  peakUsed: nonnegInt.nullable(),
  windowSize: nonnegInt.nullable(),
  snapshots: z.array(usageContextSnapshotSchema).max(64),
  updatesCount: nonnegInt,
  compacted: z.boolean(),
});

const usageTurnObservedSchema = z.strictObject({
  promptChars: nonnegInt,
  promptBytes: nonnegInt,
  promptCodeRatio: ratio,
  messageChars: nonnegInt,
  messageBytes: nonnegInt,
  messageCodeRatio: ratio,
  thoughtChars: nonnegInt,
  thoughtBytes: nonnegInt,
  toolCallCount: nonnegInt,
  toolWaves: nonnegInt,
  toolPayloadChars: nonnegInt,
  toolPayloadBytes: nonnegInt,
  rawAcpBytes: nonnegInt,
});

/** Raw quantitative turn telemetry emitted at the ACP boundary. Never includes prompt/reply text. */
export const usageTurnObservationSchema = z.strictObject({
  at: z.iso.datetime(),
  provider: shortLabel,
  model: modelLabel.nullable(),
  sessionId: modelLabel,
  turn: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  stopReason: shortLabel,
  durationMs: nonnegInt,
  attribution: usageAttributionSchema,
  reported: acpReportedUsageSchema.optional(),
  reportedScope: z.enum(["turn", "session_delta"]).optional(),
  cost: usageTurnCostSchema.optional(),
  context: usageTurnContextSchema,
  observed: usageTurnObservedSchema,
});
export type UsageTurnObservation = z.infer<typeof usageTurnObservationSchema>;

export type UsageSink = (observation: UsageTurnObservation) => void;

/** Best-effort usage observer; must never disrupt execution outcomes. */
export function emitUsage(sink: UsageSink | undefined, observation: UsageTurnObservation): void {
  try {
    sink?.(observation);
  } catch {
    /* Usage monitoring is best effort. */
  }
}

const usageEstimateSchema = z.strictObject({
  inputTokens: nonnegInt,
  newInputTokens: nonnegInt,
  cachedOrRereadInputTokens: nonnegInt,
  outputTokens: nonnegInt,
  thoughtTokens: nonnegInt.nullable(),
  totalTokens: nonnegInt,
  netContextDelta: nonnegInt.nullable(),
  method: usageMethodSchema,
  confidence: usageConfidenceSchema,
  estimatorVersion: z.number().int().positive(),
});
export type UsageEstimate = z.infer<typeof usageEstimateSchema>;

const usageTurnRecordSchema = usageTurnObservationSchema.extend({
  version: z.literal(1),
  id: z.uuid(),
  estimate: usageEstimateSchema,
});
export type UsageTurnRecord = z.infer<typeof usageTurnRecordSchema>;

const isoDateOrDatetime = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid ISO timestamp");

export const usageReportQuerySchema = z.strictObject({
  range: usageTimeRangeSchema.optional(),
  since: isoDateOrDatetime.optional(),
  until: isoDateOrDatetime.optional(),
  provider: shortLabel.optional(),
  surface: usageSurfaceSchema.optional(),
  model: modelLabel.optional(),
});
export type UsageReportQuery = z.infer<typeof usageReportQuerySchema>;

export const usageTurnsQuerySchema = usageReportQuerySchema.extend({
  confidence: usageConfidenceSchema.optional(),
  method: usageMethodSchema.optional(),
  sessionId: modelLabel.optional(),
  runId: opaqueId.optional(),
  workflowId: opaqueId.optional(),
  conversationId: opaqueId.optional(),
  limit: z.number().int().min(1).max(USAGE_MAX_TURN_PAGE_LIMIT).optional(),
  offset: z.number().int().min(0).max(USAGE_RETENTION_MAX_ROWS).optional(),
});
export type UsageTurnsQuery = z.infer<typeof usageTurnsQuerySchema>;

export const usageExportRequestSchema = usageReportQuerySchema.extend({
  format: usageExportFormatSchema,
  includeTurns: z.boolean().optional(),
  turnLimit: z.number().int().min(1).max(USAGE_MAX_EXPORT_TURNS).optional(),
});
export type UsageExportRequest = z.infer<typeof usageExportRequestSchema>;

export const usageClearRequestSchema = z.strictObject({
  confirm: z.literal(true),
});

export interface UsageCostTotal {
  currency: string;
  amount: number;
}

export interface UsageAggregateMetrics {
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
  costs: UsageCostTotal[];
  exactTurns: number;
  derivedTurns: number;
  lowerBoundTurns: number;
}

export interface UsageModelSummary extends UsageAggregateMetrics {
  model: string;
}

export interface UsageProviderSummary extends UsageAggregateMetrics {
  provider: string;
  models: UsageModelSummary[];
}

export interface UsageSurfaceSummary extends UsageAggregateMetrics {
  surface: UsageSurface;
  helperKind: UsageHelperKind | null;
}

export interface UsageHotspot {
  key: string;
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
  peakContextPercent: number | null;
  maxToolWaves: number;
  totalToolCalls: number;
  compactions: number;
  exactTurns: number;
  derivedTurns: number;
  lowerBoundTurns: number;
}

export interface UsageTimelineBucket {
  bucket: string;
  turns: number;
  totalTokens: number;
  newInputTokens: number;
  cachedOrRereadInputTokens: number;
  outputTokens: number;
}

export interface UsageStoreStatus {
  totalStoredTurns: number;
  dropped: number;
  persistenceFailures: number;
  unavailable: boolean;
}

export interface UsageReport {
  generatedAt: string;
  estimatorVersion: number;
  retentionDays: number;
  retentionMaxRows: number;
  window: {
    range: UsageTimeRange;
    since: string | null;
    until: string | null;
  };
  filters: {
    provider: string | null;
    surface: UsageSurface | null;
    model: string | null;
  };
  status: UsageStoreStatus;
  totals: UsageAggregateMetrics;
  providers: UsageProviderSummary[];
  surfaces: UsageSurfaceSummary[];
  hotspots: UsageHotspot[];
  timeline: UsageTimelineBucket[];
}

export interface UsageTurnPage {
  turns: UsageTurnRecord[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface UsageExportResult {
  format: UsageExportFormat;
  filename: string;
  mimeType: string;
  content: string;
}
