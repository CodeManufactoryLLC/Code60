export type {
  Automation,
  AutomationAction,
  AutomationActionDraft,
  AutomationRequest,
} from "../contracts/index.js";
export { AutomationError } from "./errors.js";
export {
  ExecutionRefused,
  repositoryIdentity,
  verifyRepository,
} from "./executor.js";
export type {
  ActionExecutionContext,
  ActionExecutionOutcome,
  ActionHandler,
} from "./handlers.js";
export { subscribeService } from "./protocol.js";
export { schedulerControl } from "./registration.js";
export {
  automationClient,
  automationRoot,
  startSchedulerRuntime,
} from "./service.js";
