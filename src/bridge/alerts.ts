import {
  ALERT_LIMITS,
  ALERT_SCHEMA_VERSION,
  type AlertRecord,
  type AlertRequest,
  type AlertSeverity,
  type AlertSnapshot,
  type AlertStateFile,
  type AlertTarget,
  alertRequestSchema,
  alertStateFileSchema,
  alertTargetSchema,
  parseValue,
} from "../contracts/index.js";

export {
  ALERT_LIMITS,
  ALERT_SCHEMA_VERSION,
  type AlertRecord,
  type AlertRequest,
  type AlertSeverity,
  type AlertSnapshot,
  type AlertStateFile,
  type AlertTarget,
  alertStateFileSchema,
  alertTargetSchema,
};

export const parseAlertRequest = (value: unknown): AlertRequest =>
  parseValue(alertRequestSchema, value);
