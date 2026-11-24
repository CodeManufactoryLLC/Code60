import { parseValue, workflowRequestSchema } from "../contracts/index.js";

export type {
  WorkflowDraft,
  WorkflowDraftReply,
  WorkflowEvent,
  WorkflowList,
  WorkflowRead,
  WorkflowRecord,
  WorkflowRepository,
  WorkflowRequest,
  WorkflowReview,
  WorkflowSnapshot,
} from "../contracts/index.js";
export {
  defaultWorkflowEngine,
  LEGACY_TRANSMISSION_VERSION,
  supportsWorkflowPause,
  workflowDiffSchema,
  workflowDraftReplySchema,
  workflowDraftSchema,
  workflowEngineVersion,
  workflowEventsSchema,
  workflowSnapshotSchema,
  workflowVerdictSchema,
} from "../contracts/index.js";
export const parseWorkflowRequest = (value: unknown) => parseValue(workflowRequestSchema, value);
