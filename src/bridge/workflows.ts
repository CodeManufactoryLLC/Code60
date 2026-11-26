import { parseValue, workflowRequestSchema } from "../contracts/index.js";

export type {
  WorkflowDraft,
  WorkflowDraftReply,
  WorkflowEvent,
  WorkflowList,
  WorkflowProviderOption,
  WorkflowRead,
  WorkflowRecord,
  WorkflowRepository,
  WorkflowRequest,
  WorkflowReview,
  WorkflowSnapshot,
} from "../contracts/index.js";
export {
  workflowDiffSchema,
  workflowDraftReplySchema,
  workflowDraftSchema,
  workflowEventsSchema,
  workflowSnapshotSchema,
  workflowVerdictSchema,
} from "../contracts/index.js";
export const parseWorkflowRequest = (value: unknown) => parseValue(workflowRequestSchema, value);
