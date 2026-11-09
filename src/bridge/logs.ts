import { logClearSchema, logDetailSchema, logQuerySchema, parseValue } from "../contracts/index.js";

export type {
  LogInput,
  LogPage,
  LogQuery,
  LogRecord,
  LogStatus,
} from "../contracts/index.js";
export { emitLog, LOG_EVENTS, logInputSchema, logRecordSchema } from "../contracts/index.js";
export const parseLogQuery = (value: unknown) => parseValue(logQuerySchema, value);
export const parseLogDetail = (value: unknown) => parseValue(logDetailSchema, value);
export const parseLogClear = (value: unknown) => parseValue(logClearSchema, value);
