import type {
  Automation,
  AutomationAction,
  AutomationActionDraft,
  AutomationActionType,
  AutomationDiff,
  AutomationTranscript,
  Execution,
  ExecutionArtifact,
  ExecutionReason,
} from "../contracts/index.js";

export class ExecutionRefused extends Error {
  constructor(readonly reason: ExecutionReason) {
    super(reason);
  }
}

interface LaneRequirement {
  name: string;
  limit: number;
}

export interface ConcurrencySpec {
  lanes: readonly LaneRequirement[];
  resources: readonly string[];
}

export type AbortKind = "user" | "shutdown" | null;

export interface ActionExecutionContext {
  signal: AbortSignal;
  abortKind: () => AbortKind;
  updateArtifact: (updater: (current: ExecutionArtifact) => ExecutionArtifact) => Promise<void>;
  notify: () => void;
}

export interface ActionExecutionOutcome {
  status: "finished" | "failed" | "cancelled" | "timed_out";
  reason: ExecutionReason | null;
  artifact?: (current: ExecutionArtifact) => ExecutionArtifact;
  /** True when backend shutdown detached a long-lived run whose own runtime reconciles restart. */
  detachedOnShutdown?: boolean;
}

type RestartReconciliation =
  | { kind: "blocked"; runId?: string | null }
  | { kind: "interrupted"; reason?: ExecutionReason }
  | { kind: "settled"; outcome: ActionExecutionOutcome }
  | {
      kind: "reattach";
      concurrency: ConcurrencySpec;
      resume: (ctx: ActionExecutionContext) => Promise<ActionExecutionOutcome>;
    };

interface ActionSummary {
  agent: string;
  repository?: { dev: string; ino: string };
  taskCount?: number;
}

export interface ActionHandler<TType extends AutomationActionType = AutomationActionType> {
  readonly type: TType;
  concurrency(action: Extract<AutomationAction, { type: TType }>): ConcurrencySpec;
  validate(
    draft: Extract<AutomationActionDraft, { type: TType }>,
  ): Promise<Extract<AutomationAction, { type: TType }>>;
  summarize(action: Extract<AutomationAction, { type: TType }>): ActionSummary;
  prepareClaim(
    action: Extract<AutomationAction, { type: TType }>,
    skipped: boolean,
  ): Extract<ExecutionArtifact, { type: TType }>;
  canDispatch?(action: Extract<AutomationAction, { type: TType }>): Promise<boolean> | boolean;
  execute(
    automation: Automation,
    execution: Execution,
    ctx: ActionExecutionContext,
  ): Promise<ActionExecutionOutcome>;
  reconcileOnRestart(execution: Execution): Promise<RestartReconciliation>;
  inspect(execution: Execution): Promise<"gone" | "blocked">;
  readEvidence?(
    execution: Execution,
    kind: "transcript" | "diff",
  ): Promise<AutomationTranscript | AutomationDiff>;
}

export type AnyActionHandler = ActionHandler<"prompt"> | ActionHandler<"workflow">;

export class ActionRegistry {
  private readonly handlers = new Map<AutomationActionType, AnyActionHandler>();

  constructor(handlers: readonly AnyActionHandler[] = []) {
    for (const handler of handlers) this.register(handler);
  }

  register(handler: AnyActionHandler): void {
    this.handlers.set(handler.type, handler);
  }

  get<TType extends AutomationActionType>(type: TType): ActionHandler<TType> | undefined {
    return this.handlers.get(type) as ActionHandler<TType> | undefined;
  }

  has(type: AutomationActionType): boolean {
    return this.handlers.has(type);
  }
}
