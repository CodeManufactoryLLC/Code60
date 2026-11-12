import type { Plan, PlanAction, PlanCreate, PlanTarget, PlanUpdate } from "../bridge/index.js";
import type {
  ExecutionHost,
  ExecutionOwner,
  ExecutionTarget,
  ExecutionWorker,
  TargetDispatch,
} from "./execution-host.js";
import { PlanStore } from "./plans.js";

/** Saved proposals are evidence; only these live originating tasks may execute them. */
export class RelayPlans {
  private readonly origins = new Map<string, ExecutionOwner>();
  private readonly assignments = new Map<string, { planId: string; planTaskId: string }>();
  private revoked = false;
  private constructor(
    private readonly store: PlanStore,
    private readonly execution: ExecutionHost,
    private readonly authorize: (owner: ExecutionOwner) => void,
  ) {}
  static async open(
    root: string,
    id: string,
    execution: ExecutionHost,
    authorize: (owner: ExecutionOwner) => void,
  ) {
    return new RelayPlans(await PlanStore.open(root, id, true), execution, authorize);
  }
  list() {
    return this.store.list();
  }
  get(id: string) {
    return this.store.get(id);
  }
  active() {
    const active = this.store.active();
    return active ? this.store.get(active.id) : undefined;
  }
  private require(owner: ExecutionOwner) {
    if (this.revoked) throw new Error("Relay plan authority was stopped");
    this.authorize(owner);
  }
  private origin(plan: Plan): ExecutionOwner {
    const owner = this.origins.get(plan.id);
    if (!owner)
      throw new Error(
        "This saved plan has no live task authority. Dismiss it and propose a new plan.",
      );
    this.require(owner);
    return owner;
  }
  private async targets(tasks: PlanCreate["tasks"]): Promise<PlanTarget[]> {
    return Promise.all(
      tasks.map(async (task) => {
        if (!task.target)
          throw new Error("Every Relay plan task requires an explicit target and mode");
        const target = await this.execution.target(task.target.cwd);
        return { id: target.id, cwd: target.cwd, workspaceMode: task.target.workspaceMode };
      }),
    );
  }
  async create(request: PlanCreate, owner: ExecutionOwner) {
    this.require(owner);
    const saved = this.list().find((plan) => this.get(plan.id).requestId === request.requestId);
    if (saved && this.origin(this.get(saved.id)).taskId !== owner.taskId)
      throw new Error("This proposal belongs to another human task");
    const targets = await this.targets(request.tasks);
    this.require(owner);
    const plan = await this.store.create(request, null, targets);
    this.require(owner);
    const previous = this.origins.get(plan.id);
    if (!previous && plan.state !== "draft")
      throw new Error("This saved plan has no live task authority. Propose a new plan.");
    if (previous && previous.taskId !== owner.taskId)
      throw new Error("This proposal belongs to another human task");
    this.origins.set(plan.id, { ...owner });
    return plan;
  }
  async update(request: PlanUpdate, owner: ExecutionOwner) {
    this.require(owner);
    const plan = this.store.get(request.planId);
    if (this.origin(plan).taskId !== owner.taskId)
      throw new Error("This plan belongs to another human task");
    const targets =
      request.operation === "revise" ? await this.targets(request.draft.tasks) : undefined;
    this.require(owner);
    if (request.operation === "progress") {
      this.work(owner, request.taskId);
      for (const id of request.workerIds ?? []) {
        const worker = this.execution.owned(owner, id);
        const assignment = this.assignments.get(id);
        if (
          worker.owner.taskId !== owner.taskId ||
          assignment?.planId !== plan.id ||
          assignment.planTaskId !== request.taskId
        )
          throw new Error("Worker does not belong to this plan task and target");
      }
    }
    return this.store.update(request, targets);
  }
  async action(request: PlanAction) {
    const plan = this.store.get(request.planId);
    if (
      plan.revision !== request.revision &&
      !(request.type === "accept" && plan.acceptedRevision === request.revision)
    )
      throw new Error("Plan changed; review the latest revision");
    if (request.type !== "dismiss") {
      this.origin(plan);
      // Recheck every accepted directory, not just the currently selected row.
      for (const task of plan.tasks) {
        if (!task.target || (await this.execution.target(task.target.cwd)).id !== task.target.id)
          throw new Error("This plan's target changed. Propose and accept a new revision.");
      }
      this.origin(plan);
    }
    return this.store.action(request);
  }
  pending(): { plan: Plan; owner: ExecutionOwner } | undefined {
    const plan = this.active();
    return plan?.state === "queued" ? { plan, owner: this.origin(plan) } : undefined;
  }
  async running(plan: Plan) {
    this.origin(plan);
    return this.store.mutate(plan.id, (current) => {
      if (current.revision !== plan.revision || current.state !== "queued")
        throw new Error("Plan changed before delivery");
      current.state = "running";
    });
  }
  async failed(id: string) {
    if (this.revoked) return;
    return this.store.mutate(id, (plan) => {
      plan.state = "failed";
      plan.error = "Plan delivery failed. Inspect prior work before resuming.";
    });
  }
  work(owner: ExecutionOwner, requested?: string, workerId?: string) {
    const plan = this.active();
    if (!plan) {
      if (requested) throw new Error("No accepted plan is active");
      return undefined;
    }
    if (plan.state !== "running" || this.origin(plan).taskId !== owner.taskId)
      throw new Error("Accept or resume this plan's originating task before worker work");
    const previous = workerId ? this.assignments.get(workerId) : undefined;
    const id = requested ?? (previous?.planId === plan.id ? previous.planTaskId : undefined);
    const task = plan.tasks.find((task) => task.id === id && task.state !== "completed");
    if (!task?.target) throw new Error("Supply planTaskId for an unfinished accepted target");
    return { plan, task, target: task.target };
  }
  validate(
    owner: ExecutionOwner,
    request: Pick<TargetDispatch, "workspaceMode" | "planTaskId">,
    target: ExecutionTarget,
  ) {
    const assignment = this.work(owner, request.planTaskId);
    if (
      assignment &&
      (assignment.target.id !== target.id ||
        assignment.target.cwd !== target.cwd ||
        assignment.target.workspaceMode !== request.workspaceMode)
    )
      throw new Error("Worker target or mode differs from the accepted plan task");
  }
  assignment(id: string) {
    return this.assignments.get(id);
  }
  async associate(worker: ExecutionWorker, taskId?: string) {
    if (!taskId || this.assignments.get(worker.id)?.planTaskId === taskId) return;
    const plan = this.list()
      .map((item) => this.get(item.id))
      .find((item) => item.tasks.some((task) => task.id === taskId));
    if (!plan || this.origin(plan).taskId !== worker.owner.taskId)
      throw new Error("Plan worker provenance changed");
    this.assignments.set(worker.id, { planId: plan.id, planTaskId: taskId });
    await this.store.mutate(plan.id, (current) => {
      const task = current.tasks.find((task) => task.id === taskId);
      if (task && !task.workerIds.includes(worker.id)) task.workerIds.push(worker.id);
    });
  }
  revoke(): Promise<void> {
    this.revoked = true;
    this.origins.clear();
    const plan = this.active();
    if (plan)
      return this.store
        .mutate(plan.id, (current) => {
          if (["queued", "running"].includes(current.state)) {
            current.state = "paused";
            current.error = "Execution stopped. Saved plans do not restore worker authority.";
          }
        })
        .then(() => {});
    return Promise.resolve();
  }
}
