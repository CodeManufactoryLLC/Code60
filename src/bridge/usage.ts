import {
  parseValue,
  usageClearRequestSchema,
  usageExportRequestSchema,
  usageReportQuerySchema,
  usageTurnsQuerySchema,
} from "../contracts/index.js";

export type {
  UsageAggregateMetrics,
  UsageConfidence,
  UsageExportFormat,
  UsageExportRequest,
  UsageExportResult,
  UsageHotspot,
  UsageReport,
  UsageReportQuery,
  UsageSurface,
  UsageTimeRange,
  UsageTurnPage,
  UsageTurnRecord,
  UsageTurnsQuery,
} from "../contracts/index.js";
export { USAGE_SURFACES, USAGE_TIME_RANGES } from "../contracts/index.js";

export const parseUsageReportQuery = (value: unknown) =>
  parseValue(usageReportQuerySchema, value ?? {});
export const parseUsageTurnsQuery = (value: unknown) =>
  parseValue(usageTurnsQuerySchema, value ?? {});
export const parseUsageExportRequest = (value: unknown) =>
  parseValue(usageExportRequestSchema, value);
export const parseUsageClearRequest = (value: unknown) =>
  parseValue(usageClearRequestSchema, value);
