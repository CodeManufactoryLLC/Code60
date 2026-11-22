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
  TRANSMISSION_VERSION,
  workflowDiffSchema,
  workflowDraftReplySchema,
  workflowDraftSchema,
  workflowEventsSchema,
  workflowSnapshotSchema,
} from "../contracts/index.js";
export const parseWorkflowRequest = (value: unknown) => parseValue(workflowRequestSchema, value);
