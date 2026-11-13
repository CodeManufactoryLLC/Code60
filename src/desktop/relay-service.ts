import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Action,
  ActionResult,
  DesktopRun,
  DetailScope,
  OrchestrationChat,
  OrchestrationChatAction,
  Plan,
  PlanAction,
  PlanRead,
  RelayMessageRead,
  RelayMessageSource,
  RelayReviewRequest,
  RelayReviewResponse,
  Review,
  SequencedEvent,
} from "../bridge/index.js";
import {
  assembleOperatingContract,
  DEFAULT_PROMPT_TEMPLATES,
  isActivityTool,
  isMcpControlTool,
  parseActivityContextArgs,
  planMarkdown,
} from "../bridge/index.js";
import {
  ACTIVE_STATUSES,
  type Config,
  type CoreDeps,
  type Orchestrator,
  prepareOrchestrationChat,
  type RunEvent,
  stateHome,
} from "../core/index.js";
import { ActivityDisplay } from "./activity-display.js";
import { ConversationReplies } from "./conversation-replies.js";
import { ExecutionHost, type ExecutionOwner, type ExecutionWorker } from "./execution-host.js";
import {
  formatWorkerUpdate,
  parseControlArgs,
  parseRelayDispatch,
  type WorkerUpdate,
  workerTranscript,
} from "./mcp-control.js";
import { createMcpGateway, type McpGateway } from "./mcp-gateway.js";
import type { RelayFileRoot } from "./relay-files.js";
import { RelayPlans } from "./relay-plans.js";
import { RelayReviewStore } from "./relay-review-store.js";
import { RelayReviews } from "./relay-reviews.js";
import { type RelaySourceCursor, RelayStore } from "./relay-store.js";
import { RelayWriter } from "./relay-writer.js";
import { summarizeRun } from "./run-summary.js";
import { WorkerEventWindows } from "./worker-event-windows.js";

const instructions = [
  assembleOperatingContract(DEFAULT_PROMPT_TEMPLATES.operatingContract),
  "You are Relay, Code60's application-wide orchestrator. Your workspace is your persistent home, not a default worker target.",
  "Every dispatch must specify cwd and workspaceMode. Use direct only when direct edits in that exact directory are intended; those edits have no isolated apply/undo/discard.",
  "Use worktree for Git-isolated work. Never infer a target from sidebar selection or historical workers. No project or database connection is needed.",
  "Historical conversations are evidence only. Do not resume unfinished work, replay plans or feedback, or control historical workers. Only the current human request authorizes new work.",
  "Worker transcript reads page a bounded live target window. Check windowRevision and incomplete; cursors refer only to that window, not complete lifetime history. Original run records remain on disk.",
  "Every Relay plan task must specify its own target with cwd and workspaceMode. Only human Accept authorizes that revision and those assignments. Use planTaskId for worker work under an accepted plan; never substitute another target or mode.",
].join("\n\n");

/** One application-owned conversation. Database/project navigation is not an input. */
export class RelayService {
  private readonly replySummary = new ConversationReplies();
  readonly execution: ExecutionHost;
  private store: RelayStore | undefined;
  private storeOpening: Promise<RelayStore> | undefined;
  private plans: RelayPlans | undefined;
  private reviews: RelayReviews | undefined;
  private reviewRevision = 0;
  private detailRevision = 0;
  private readonly targetDetailRevisions = new Map<string, number>();
  private readonly feedback: { reviewId: string; batchId: string; taskId: string; text: string }[] =
    [];
  private readonly deliveries = new Set<Promise<unknown>>();
  private connectionEpoch = 0;
  private readonly connections = new Set<Promise<void>>();
  private readonly orphans = new Set<{
    chat: Orchestrator | undefined;
    gateway: McpGateway | undefined;
  }>();
  private chat: Orchestrator | undefined;
  private gateway: McpGateway | undefined;
  private config: Config | undefined;
  private provider: string | undefined;
  private key = "";
  private generation = 0;
  private scope = randomUUID();
  private task: ExecutionOwner | undefined;
  private readonly tasks = new Map<string, { owner: ExecutionOwner; config: Config }>();
  private history: Awaited<ReturnType<RelayStore["history"]>> | undefined;
  private historyCursor: string | null = null;
  private readonly historyCursors = new Map<string, number>();
  private historySourceTokens: (string | undefined)[] = [];
  private readonly messageSources = new Map<
    string,
    {
      id: string;
      store: RelayStore;
      initial: RelaySourceCursor;
      cursors: Map<string, RelaySourceCursor>;
      expires: number;
    }
  >();
  private sourceReads = 0;
  private initialHistory = "";
  private historyPending = false;
  private error: string | null = null;
  private readonly events: SequencedEvent[] = [];
  private readonly workerEvents = new WorkerEventWindows();
  private readonly workerReplies = new Map<string, ConversationReplies>();
  private revision = 0;
  private disposers: (() => void)[] = [];
  private writer: RelayWriter | undefined;
  private readonly activity: ActivityDisplay;
  private assistant: { id: string; at: string; start: boolean } | undefined;
  private readonly inbox: WorkerUpdate[] = [];
  private readonly replies = new Map<string, string>();
  private readonly reported = new Map<string, number>();
  private paused = true;
  private delivery: ReturnType<typeof setTimeout> | undefined;
  private turns: Promise<unknown> = Promise.resolve();
  private closing = false;
  private storageFailed = false;

  constructor(
    private readonly deps: CoreDeps,
    private readonly env: Readonly<Record<string, string | undefined>>,
    private readonly notify: () => void,
    private readonly dialogs: { confirm(title: string, detail: string): Promise<boolean> } = {
      confirm: async () => false,
    },
  ) {
    const changed = () => this.changed();
    this.activity = new ActivityDisplay({ changed });
    this.execution = new ExecutionHost(deps, env, {
      authorize: (owner) => this.authorize(owner),
      authorizeTarget: (owner, request, target) => {
        this.plans?.validate(owner, request, target);
        this.reviews?.assertWritableTarget(target);
      },
      event: (worker, event) => this.workerEvent(worker, event),
      checkout: (worker) =>
        this.associateReview(worker, Math.max(1, worker.orchestrator.runs()[0]?.turns ?? 1)),
      changed: (targetId) => this.changed(targetId),
      warning: () => {
        this.error = "A worker record could not be saved. Inspect the worker before retrying work.";
        changed();
      },
    });
  }
  detailVersion(targetId?: string): number {
    return targetId === undefined
      ? this.detailRevision
      : (this.targetDetailRevisions.get(targetId) ?? 0);
  }
  private changed(targetId?: string): void {
    this.detailRevision++;
    if (targetId) this.targetDetailRevisions.set(targetId, this.detailVersion(targetId) + 1);
    try {
      this.notify();
    } catch {
      // Presentation cannot turn an accepted prompt or worker into a failed dispatch.
    }
  }
  reviewRequest(request: RelayReviewRequest): Promise<RelayReviewResponse> {
    if (!this.reviews) return Promise.reject(new Error("Relay reviews are unavailable"));
    return this.reviews.request(request);
  }
  cancelReviewReads(): Promise<void> {
    return this.reviews?.rendererGone() ?? Promise.resolve();
  }
  private reviewChanged(targetId?: string): void {
    this.reviewRevision++;
    this.changed(targetId);
  }
  private reviewGeneration(request: { conversationId: string; generation: number }): void {
    if (
      this.closing ||
      request.conversationId !== this.store?.id ||
      request.generation !== this.generation
    )
      throw new Error("This Relay review generation is no longer available");
  }
  private liveReview(review: Review): boolean {
    const source = review.relay;
    if (!source || !this.chat || this.storageFailed) return false;
    try {
      this.authorize({
        id: source.conversationId,
        generation: source.generation,
        taskId: source.taskId,
      });
      return true;
    } catch {
      return false;
    }
  }
  private queueFeedback(review: Review, batchId: string, text: string): void {
    if (!this.liveReview(review) || !review.relay)
      throw new Error("The originating Relay task is no longer live");
    const existing = this.feedback.find(
      (item) => item.reviewId === review.id && item.batchId === batchId,
    );
    if (existing) {
      if (existing.text !== text) throw new Error("Feedback changed while queued");
      return;
    }
    if (this.feedback.length >= 256) throw new Error("Relay feedback capacity reached");
    this.feedback.push({ reviewId: review.id, batchId, taskId: review.relay.taskId, text });
    this.scheduleDelivery();
    this.changed();
  }
  private authorize(owner: ExecutionOwner) {
    if (
      this.closing ||
      owner.id !== this.store?.id ||
      owner.generation !== this.generation ||
      !this.tasks.has(owner.taskId)
    )
      throw new Error("This Relay task has no live execution authority");
  }
  fileRoot(scope: DetailScope): RelayFileRoot {
    const store = this.store;
    const valid = () => {
      if (
        this.closing ||
        !store ||
        this.store !== store ||
        scope.kind === "project" ||
        scope.conversationId !== store.id ||
        scope.generation !== this.generation ||
        (scope.kind === "conversation" && scope.projectId !== undefined)
      )
        throw new Error("This Relay file generation is no longer available");
    };
    valid();
    if (!store) throw new Error("Relay workspace is unavailable");
    if (scope.kind === "conversation")
      return {
        cwd: store.fileRoot,
        check: async () => {
          valid();
          await store.validateWorkspace();
          valid();
        },
      };
    if (scope.kind !== "target") throw new Error("Relay file target is unavailable");
    const target = this.currentWorkers().find(
      (worker) => worker.target.id === scope.targetId,
    )?.target;
    if (!target) throw new Error("This Relay generation does not own that file target");
    return {
      cwd: target.cwd,
      check: async () => {
        valid();
        if (!this.currentWorkers().some((worker) => worker.target.id === target.id))
          throw new Error("This Relay generation no longer owns that file target");
        await this.execution.validateTarget(target);
        valid();
      },
    };
  }
  readPlan(request: PlanRead): Promise<Plan> {
    if (!this.owns(request.chatId) || !this.plans)
      return Promise.reject(new Error("This Relay plan conversation is unavailable"));
    return Promise.resolve(this.plans.get(request.planId));
  }
  planAction(request: PlanAction): Promise<void> {
    return this.serial(async () => {
      if (!this.owns(request.chatId) || !this.plans || !this.store)
        throw new Error("This Relay plan conversation is unavailable");
      const run = this.chat?.runs()[0];
      if (request.type !== "dismiss" && (!run || !ACTIVE_STATUSES.has(run.status) || run.stopping))
        throw new Error("This Relay plan's conversation has ended");
      await this.plans.action({ ...request, chatId: this.store.id });
      if (request.type !== "dismiss") this.paused = false;
      this.scheduleDelivery();
      this.changed();
    });
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.turns.then(operation);
    this.turns = result.catch(() => {});
    return result;
  }

  owns(id: string | null): boolean {
    return !!id && (id === this.store?.id || id === this.chat?.runs()[0]?.id);
  }
  async readMessage(request: RelayMessageRead): Promise<RelayMessageSource> {
    const source = this.messageSources.get(request.source);
    if (
      this.closing ||
      !source ||
      source.store !== this.store ||
      request.conversationId !== this.store?.id ||
      source.expires < Date.now()
    )
      throw new Error("Relay message source expired. Refresh history before copying.");
    const position = request.cursor ? source.cursors.get(request.cursor) : source.initial;
    if (!position) throw new Error("Relay source cursor expired. Retry Copy.");
    if (this.sourceReads >= 2) throw new Error("Relay source reads are busy. Retry Copy.");
    source.expires = Date.now() + 5 * 60_000;
    this.messageSources.delete(request.source);
    this.messageSources.set(request.source, source);
    this.sourceReads++;
    try {
      const page = await source.store.source(source.id, position);
      if (this.closing || source.store !== this.store)
        throw new Error("Relay message source is no longer available");
      const cursor = page.next ? randomUUID() : null;
      if (cursor && page.next) source.cursors.set(cursor, page.next);
      while (source.cursors.size > 2) {
        const oldest = source.cursors.keys().next().value;
        if (oldest) source.cursors.delete(oldest);
      }
      return { text: page.text, cursor };
    } finally {
      this.sourceReads--;
    }
  }
  handlesWorkerAction(request: Action): boolean {
    return this.currentWorkers().some((worker) =>
      request.type === "permission"
        ? worker.orchestrator
            .runs()
            .some((run) => run.pending.some((item) => item.id === request.id))
        : worker.id === request.id,
    );
  }
  workerAction(request: Action): Promise<ActionResult> {
    const worker = this.currentWorkers().find((worker) =>
      request.type === "permission"
        ? worker.orchestrator
            .runs()
            .some((run) => run.pending.some((item) => item.id === request.id))
        : worker.id === request.id,
    );
    if (!worker) return Promise.reject(new Error("Unknown Relay worker"));
    if (request.type === "events")
      return Promise.resolve(
        this.workerEvents
          .read(worker.target.id)
          .filter((entry) => entry.event.runId === worker.id)
          .map((entry) => entry.event),
      );
    if (request.type === "diff" || request.type === "discard" || request.type === "continue")
      return Promise.reject(
        new Error("Relay workers do not support project-local recovery or review actions."),
      );
    return this.execution.control(worker.owner, worker.id, async (worker) => {
      if (request.type === "reply") {
        this.reviews?.assertWritableTarget(worker.target);
        this.requireWorkerProvider(worker);
        worker.orchestrator.reply(worker.id, request.text);
        await this.associateReview(worker, worker.orchestrator.runs()[0]?.turns ?? 1);
      } else if (request.type === "set-mode")
        await worker.orchestrator.setMode(worker.id, request.change);
      else if (request.type === "permission") {
        if (!worker.orchestrator.answerPermission(request.id, request.answer))
          throw new Error("This approval request is no longer pending");
      } else if (request.type === "stop") await worker.orchestrator.shutdown();
      else if (request.type === "finish") worker.orchestrator.finish(worker.id);
      else if (!worker.orchestrator.cancelTurn(worker.id))
        throw new Error("No turn is in progress");
      this.changed();
      return undefined;
    });
  }
  async stopFolder(cwd: string): Promise<void> {
    const stopping = this.execution.stopFolder(
      cwd,
      [...this.tasks.values()].map((task) => task.owner),
    );
    const results = await Promise.allSettled([stopping, this.reviews?.stopFolder(cwd)]);
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Some folder work could not be stopped. Inspect the workers.");
    this.changed();
  }
  workerSnapshot(
    summary = false,
    targetId?: string,
  ): {
    runs: DesktopRun[];
    events: SequencedEvent[];
    liveIds: string[];
  } {
    const workers = this.currentWorkers().filter(
      (worker) => targetId === undefined || worker.target.id === targetId,
    );
    const runs = workers.map((worker): DesktopRun => {
      const view = worker.orchestrator.runs()[0];
      const review = this.reviews?.store.assignment(worker.id);
      return {
        record: {
          ...worker.record,
          ...(view
            ? {
                status: view.status,
                turns: view.turns,
                ...(view.reason ? { reason: view.reason } : {}),
              }
            : {}),
        },
        agentAlive: false,
        ...(view ? { view } : {}),
        replies: this.workerReplies.get(worker.id)?.snapshot() ?? { count: 0, lastTurn: 0 },
        historyIncomplete: this.workerEvents.incomplete(worker.target.id),
        relay: {
          conversationId: worker.owner.id,
          generation: worker.owner.generation,
          taskId: worker.owner.taskId,
          targetId: worker.target.id,
          cwd: worker.target.cwd,
          workspaceMode: worker.workspaceMode,
          ...(review ? { reviewId: review.reviewId } : {}),
        },
      };
    });
    return {
      runs: summary ? runs.map(summarizeRun) : runs,
      events: summary ? [] : this.workerEvents.read(targetId),
      liveIds: runs
        .filter((run) => ACTIVE_STATUSES.has(run.record.status))
        .map((run) => run.record.id),
    };
  }
  get active(): boolean {
    return (
      this.chat?.runs().some((run) => ["queued", "running", "waiting"].includes(run.status)) ===
        true ||
      this.execution
        .list()
        .some((worker) => worker.orchestrator.runs().some((run) => ACTIVE_STATUSES.has(run.status)))
    );
  }

  async sync(provider: string | undefined, config: Config | undefined): Promise<void> {
    const key = JSON.stringify([provider, provider && config?.agents[provider]?.command]);
    if (this.closing) return;
    this.config = config
      ? structuredClone({ ...config, prompts: DEFAULT_PROMPT_TEMPLATES })
      : undefined;
    this.provider = provider;
    if (key === this.key) return;
    this.key = key;
    if (!provider || !config) {
      await this.stopChat();
      return;
    }
    await this.connect();
  }

  private async stopChat(force = false): Promise<void> {
    const epoch = ++this.connectionEpoch;
    this.paused = true;
    this.task = undefined;
    this.tasks.clear();
    this.scope = randomUUID();
    this.activity.invalidate();
    if (this.delivery) clearTimeout(this.delivery);
    this.delivery = undefined;
    const gateway = this.gateway;
    const chat = this.chat;
    const disposers = this.disposers;
    const orphans = [...this.orphans];
    const results = await Promise.allSettled([
      this.plans?.revoke(),
      gateway?.close(),
      chat?.shutdown(force),
      this.execution.stopAll(force),
      this.reviews?.stop(),
      ...this.deliveries,
      ...orphans.flatMap((owner) => [owner.gateway?.close(), owner.chat?.shutdown(force)]),
    ]);
    if (results[1]?.status === "fulfilled" && this.gateway === gateway) this.gateway = undefined;
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Relay cleanup failed. History and workspace were preserved.");
    await this.writer?.flush();
    for (const dispose of disposers) dispose();
    if (this.disposers === disposers) this.disposers = [];
    if (this.chat === chat) this.chat = undefined;
    for (const orphan of orphans) this.orphans.delete(orphan);
    if (epoch !== this.connectionEpoch) return;
    this.inbox.length = 0;
    this.feedback.length = 0;
    this.replies.clear();
    this.reported.clear();
  }

  private connect(): Promise<void> {
    const connection = this.prepareConnection();
    this.connections.add(connection);
    void connection.then(
      () => this.connections.delete(connection),
      () => this.connections.delete(connection),
    );
    return connection;
  }

  private async prepareConnection(): Promise<void> {
    const stopping = this.stopChat();
    const epoch = this.connectionEpoch;
    const current = () => !this.closing && epoch === this.connectionEpoch;
    await stopping;
    if (!current()) return;
    this.error = null;
    this.events.length = 0;
    this.replySummary.reset();
    this.workerEvents.clear();
    this.workerReplies.clear();
    this.inbox.length = 0;
    this.assistant = undefined;
    const provider = this.provider;
    const config = this.config;
    if (!provider || !config || this.closing) return;
    let chat: Orchestrator | undefined;
    let gateway: McpGateway | undefined;
    const retire = async () => {
      const owner = { chat, gateway };
      this.orphans.add(owner);
      const stopped = await Promise.allSettled([chat?.shutdown(true), gateway?.close()]);
      if (stopped.some((result) => result.status === "rejected"))
        throw new Error("A superseded Relay connection could not be stopped.");
      this.orphans.delete(owner);
    };
    try {
      this.storeOpening ??= RelayStore.open(join(stateHome(this.env), "code60", "relay")).then(
        (store) => {
          this.store = store;
          return store;
        },
        (cause: unknown) => {
          this.storeOpening = undefined;
          throw cause;
        },
      );
      const store = await this.storeOpening;
      if (!current()) return;
      await store.validateWorkspace();
      if (!current()) return;
      const plans = await RelayPlans.open(
        join(store.root, "documents"),
        store.id,
        this.execution,
        (owner) => this.authorize(owner),
      );
      if (!current()) return;
      this.plans = plans;
      if (!this.reviews) {
        const reviewStore = await RelayReviewStore.open(
          join(store.root, "reviews"),
          store.id,
          this.deps,
        );
        if (!current()) return;
        this.reviews ??= new RelayReviews(reviewStore, this.deps, this.env, this.execution, {
          valid: (request) => this.reviewGeneration(request),
          live: (review) => this.liveReview(review),
          changed: () => this.reviewChanged(),
          feedback: (review, id, text) => this.queueFeedback(review, id, text),
          withdraw: (reviewId, batchId) => {
            const index = this.feedback.findIndex(
              (item) => item.reviewId === reviewId && item.batchId === batchId,
            );
            if (index >= 0) this.feedback.splice(index, 1);
          },
          confirm: (title, detail) => this.dialogs.confirm(title, detail),
        });
      }
      if (!current()) return;
      this.historyCursors.clear();
      const history = await store.history();
      if (!current()) return;
      this.setHistory(history);
      this.initialHistory = history.serialized;
      this.historyPending = true;
      if (history.damaged)
        throw new Error(
          "Relay history is damaged or has changed outside Code60. Check storage before reconnecting.",
        );
      this.storageFailed = false;
      this.writer = new RelayWriter(store, this.deps.log, () => this.changed());
      gateway = await createMcpGateway((name, args) => {
        if (!current()) return Promise.reject(new Error("Relay gateway is closed"));
        return this.tool(name, args);
      });
      if (!current()) return await retire();
      this.gateway = gateway;
      chat = await prepareOrchestrationChat(
        {
          ...this.deps,
          agents: {
            start: async (spec, signal) => {
              if (!current()) throw new Error("Relay connection was superseded");
              await store.validateWorkspace();
              if (!current()) throw new Error("Relay connection was superseded");
              return this.deps.agents.start(spec, signal);
            },
          },
        },
        store.workspace,
        provider,
        {
          ...config,
          prompts: DEFAULT_PROMPT_TEMPLATES,
        },
        {
          mcpServers: [
            {
              name: "code60",
              command: process.execPath,
              args: [fileURLToPath(new URL("./mcp-server.js", import.meta.url))],
              env: [
                { name: "ELECTRON_RUN_AS_NODE", value: "1" },
                { name: "CODE60_MCP_ROLE", value: "relay" },
                { name: "CODE60_MCP_GATEWAY_URL", value: gateway.url },
                { name: "CODE60_MCP_GATEWAY_TOKEN", value: gateway.token },
              ],
            },
          ],
          promptContext: () => instructions,
        },
      );
      if (!current()) return await retire();
      this.chat = chat;
      const id = chat.runs()[0]?.id;
      if (!id) throw new Error("Relay connection has no session");
      await store.beginGeneration(id);
      if (!current()) return await retire();
      this.generation = store.generation;
      this.disposers = [
        chat.onEvent((event) => this.event(event)),
        chat.onChange(() => {
          this.changed();
          this.scheduleDelivery();
        }),
        chat.onWarning(() => this.persistenceFailure()),
      ];
      chat.start(); // Intentionally no prompt, restoration or worker reattachment.
    } catch (cause) {
      if (!current()) {
        await retire().catch(() => {
          this.paused = true;
          this.error = "A superseded Relay connection could not be stopped. Retry cleanup.";
          this.changed();
        });
        return;
      }
      this.error = cause instanceof Error ? cause.message : "Relay could not connect.";
      await this.stopChat().catch(() => {
        this.error = "Relay connection and cleanup failed. History was preserved.";
      });
    }
    this.changed();
  }

  snapshot(summary = false): OrchestrationChat {
    return {
      kind: "relay",
      ...(this.store ? { conversationId: this.store.id } : {}),
      generation: this.generation,
      reviewRevision: this.reviewRevision,
      replies: this.replySummary.snapshot(),
      title: "Relay",
      run: this.chat?.runs()[0] ?? null,
      directory: this.store?.workspace ?? null,
      error: this.error,
      historySaving: this.writer?.failed ? "unavailable" : "available",
      events: summary ? [] : [...this.events],
      workers: this.currentWorkers().map((worker) => worker.id),
      workerLabels: Object.fromEntries(
        this.currentWorkers().map((worker) => [
          worker.id,
          `${worker.label ?? worker.provider} [${worker.target.cwd}]`,
        ]),
      ),
      updates: { paused: this.paused, pending: this.inbox.length + this.feedback.length },
      plans: this.plans?.list() ?? [],
      activity: this.activity.snapshot(
        this.chat?.runs()[0] ?? null,
        this.error,
        this.currentWorkers().filter((worker) =>
          worker.orchestrator
            .runs()
            .some((run) => ["queued", "running", "waiting"].includes(run.status)),
        ).length,
      ),
      ...(this.history && !summary
        ? {
            history: {
              messages: this.history.messages.map(({ id, role, at, text, partial }, index) => {
                const source = this.historySourceTokens[index];
                return {
                  id,
                  role,
                  at,
                  text,
                  ...(partial === undefined ? {} : { partial }),
                  ...(source ? { source } : {}),
                };
              }),
              serialized: this.history.serialized,
              characters: this.history.characters,
              older: this.history.older,
              incomplete: this.history.incomplete,
              cursor: this.historyCursor,
            },
          }
        : {}),
    };
  }

  private setHistory(history: Awaited<ReturnType<RelayStore["history"]>>): void {
    this.history = history;
    this.historySourceTokens = history.messages.map((message) => {
      if (!message.partial || message.sourceEnd === undefined || !this.store) return undefined;
      const token = randomUUID();
      this.messageSources.set(token, {
        id: message.id,
        store: this.store,
        initial: { direction: "backward", position: message.sourceEnd, bound: history.sourceBound },
        cursors: new Map(),
        expires: Date.now() + 5 * 60_000,
      });
      return token;
    });
    while (this.messageSources.size > 512) {
      const oldest = this.messageSources.keys().next().value;
      if (oldest) this.messageSources.delete(oldest);
    }
    this.historyCursor = history.cursor > 0 ? randomUUID() : null;
    if (this.historyCursor) this.historyCursors.set(this.historyCursor, history.cursor);
    if (this.historyCursors.size > 64) {
      const oldest = this.historyCursors.keys().next().value;
      if (oldest) this.historyCursors.delete(oldest);
    }
  }

  action(request: OrchestrationChatAction): Promise<void> {
    const result = this.turns.then(async () => {
      if (this.closing) throw new Error("Relay is stopping");
      if (request.type === "restart") return this.connect();
      if (request.type === "select") return;
      if (request.type === "history") {
        if (!this.store) throw new Error("Relay history is unavailable");
        const before = request.before ? this.historyCursors.get(request.before) : undefined;
        if (request.before && before === undefined)
          throw new Error("Relay history cursor expired. Open latest history.");
        this.setHistory(await this.store.history(before));
        this.changed();
        return;
      }
      const chat = this.chat;
      const run = chat?.runs()[0];
      if (!chat || !run) throw new Error("Relay is not connected. Retry the connection.");
      if (request.type === "set-mode") return chat.setMode(run.id, request.change);
      if (request.type === "stop" || request.type === "cancel") {
        this.paused = true;
        if (request.type === "cancel") chat.cancelTurn(run.id);
        else await this.stopChat();
      } else if (request.type === "resume-updates") {
        if (this.storageFailed) throw new Error("Retry the Relay connection before resuming.");
        if (!this.task) throw new Error("Send a human request before resuming worker updates");
        this.paused = false;
        this.scheduleDelivery();
      } else if (request.type === "send") {
        if (this.storageFailed)
          throw new Error("Relay history could not be saved. Retry the connection before sending.");
        if (request.command) throw new Error("Relay does not use database command overrides.");
        if (run.status !== "idle" || run.stopping || run.modeChanging)
          throw new Error("Wait for Relay to be idle before sending.");
        if (!this.config || !this.store) throw new Error("Relay configuration is unavailable");
        if (this.tasks.size >= 1024)
          throw new Error("Relay task capacity reached. Stop workers before reconnecting.");
        const previous = this.task;
        const previousScope = this.scope;
        this.task = {
          id: this.store.id,
          generation: this.generation,
          taskId: randomUUID(),
        };
        this.tasks.set(this.task.taskId, {
          owner: this.task,
          config: structuredClone(this.config),
        });
        this.scope = randomUUID();
        const delivered =
          this.historyPending && this.initialHistory
            ? `${this.initialHistory}\n\n--- New human request ---\n${request.text}`
            : request.text;
        try {
          chat.reply(run.id, request.text, undefined, delivered);
          this.historyPending = false;
          this.initialHistory = "";
          this.paused = false;
        } catch (cause) {
          this.tasks.delete(this.task.taskId);
          this.task = previous;
          this.scope = previousScope;
          throw cause;
        }
      } else {
        throw new Error("This action is not available for the singleton Relay conversation.");
      }
      this.changed();
    });
    this.turns = result.catch(() => {});
    return result;
  }

  private persistenceFailure(): void {
    this.storageFailed = true;
    this.paused = true;
    this.error =
      "Relay run records could not be saved. Retry the connection to start a fresh session.";
    this.changed();
  }
  private event(event: RunEvent): void {
    this.activity.event(event);
    this.replySummary.event(event);
    if (event.type === "prompt") this.assistant = undefined;
    if (event.type === "prompt" || event.type === "message") {
      if (event.type === "message" && !this.assistant)
        this.assistant = { id: randomUUID(), at: event.at, start: true };
      const source =
        event.type === "prompt" ? { id: randomUUID(), at: event.at, start: true } : this.assistant;
      if (!source) throw new Error("Missing Relay message identity");
      const start = source.start;
      source.start = false;
      const record = {
        id: source.id,
        at: source.at,
        role:
          event.type === "message"
            ? ("assistant" as const)
            : event.origin
              ? ("activity" as const)
              : ("human" as const),
        text: event.text,
      };
      this.writer?.enqueue(record, start);
    }
    if (event.type === "turnEnd") void this.writer?.flush();

    if (event.type !== "acp") {
      const entry = { revision: ++this.revision, event };
      this.events.push(entry);
      // Original core events and framed source stay on disk. Live buffers are bounded.
      let size = 0;
      let from = this.events.length;
      while (from > 0 && this.events.length - from < 512) {
        const item = this.events[from - 1];
        if (!item) break;
        size += JSON.stringify(item).length;
        if (size > 256_000) break;
        from--;
      }
      if (from) this.events.splice(0, from);
    }
    if (event.type === "status" && event.status === "idle") this.scheduleDelivery();
    this.changed();
  }

  private workerInfo(worker: ExecutionWorker) {
    return {
      ...worker.orchestrator.runs()[0],
      runId: worker.id,
      targetId: worker.target.id,
      cwd: worker.target.cwd,
      workspaceMode: worker.workspaceMode,
      provider: worker.provider,
      taskId: worker.owner.taskId,
      ...this.plans?.assignment(worker.id),
      ...(this.reviews?.store.assignment(worker.id)
        ? { reviewId: this.reviews.store.assignment(worker.id)?.reviewId }
        : {}),
      directEditing: worker.workspaceMode === "direct",
    };
  }
  private currentWorkers(): ExecutionWorker[] {
    return this.store
      ? this.execution.list({ id: this.store.id, generation: this.generation })
      : [];
  }
  private async tool(name: string, args: unknown): Promise<unknown> {
    if (this.closing || !this.gateway) throw new Error("Relay gateway is closed");
    if (isActivityTool(name)) {
      if (name === "code60_get_activity_context") {
        parseActivityContextArgs(args);
        return this.activity.context();
      }
      return this.activity.report(args);
    }
    if (!isMcpControlTool(name)) throw new Error("Database tools are not available in Relay.");
    if (name === "code60_get_context") {
      parseControlArgs(name, args);
      return {
        conversationId: this.store?.id,
        scope: this.task ? this.scope : null,
        taskId: this.task?.taskId ?? null,
        workspace: this.store?.workspace,
        providers: Object.keys(
          (this.task && this.tasks.get(this.task.taskId)?.config.agents) ||
            this.config?.agents ||
            {},
        ),
        defaultProvider: this.provider,
        maxParallel: this.config?.maxParallel,
        liveWorkers: this.task ? this.execution.liveCount(this.task) : 0,
        project: null,
        explicitTargetRequired: true,
        plans: this.plans?.list() ?? [],
      };
    }
    if (name === "code60_list_agents") {
      parseControlArgs(name, args);
      return { workers: this.currentWorkers().map((worker) => this.workerInfo(worker)) };
    }
    if (name === "code60_read_plan") {
      const request = parseControlArgs(name, args);
      const plan = this.plans?.get(request.planId);
      if (!plan) throw new Error("Relay plans are unavailable");
      return { ...plan, markdown: planMarkdown(plan) };
    }
    const owner = this.task;
    if (!owner) throw new Error("Send a human request before dispatching or controlling workers.");
    if (name === "code60_create_plan" || name === "code60_update_plan") {
      const scope = this.scope;
      return this.serial(async () => {
        if (scope !== this.scope || this.task !== owner)
          throw new Error("Relay scope changed before this plan operation");
        if (!this.plans) throw new Error("Relay plans are unavailable");
        const plan =
          name === "code60_create_plan"
            ? await this.plans.create(parseControlArgs(name, args), owner)
            : await this.plans.update(parseControlArgs(name, args), owner);
        this.changed();
        return { ...plan, markdown: planMarkdown(plan) };
      });
    }
    if (name === "code60_dispatch_agent") {
      const request = parseRelayDispatch(args);
      if (request.scope !== this.scope)
        throw new Error("Relay scope is stale. Read context again.");
      const provider = request.provider ?? this.provider;
      const config = this.tasks.get(owner.taskId)?.config;
      if (
        !provider ||
        !config ||
        !Object.hasOwn(config.agents, provider) ||
        !this.config ||
        !Object.hasOwn(this.config.agents, provider) ||
        JSON.stringify(config.agents[provider]?.command) !==
          JSON.stringify(this.config.agents[provider]?.command)
      )
        throw new Error("Unavailable verified provider");
      const worker = await this.execution.dispatch(owner, { ...request, provider }, config);
      try {
        await this.plans?.associate(worker, request.planTaskId);
      } catch {
        this.error =
          "Worker started but plan association could not be saved. Inspect the worker; do not dispatch it again.";
        this.changed();
      }
      await this.associateReview(worker, Math.max(1, worker.orchestrator.runs()[0]?.turns ?? 1));
      return this.workerInfo(worker);
    }
    if (name === "code60_read_agent") {
      const request = parseControlArgs(name, args);
      const worker = this.execution.owned(owner, request.runId);
      const entries = workerTranscript(
        this.workerEvents
          .read(worker.target.id)
          .filter((entry) => entry.event.runId === worker.id)
          .map((entry) => entry.event),
      );
      const limit = request.limit ?? 50;
      const cursor = request.tail ? Math.max(0, entries.length - limit) : (request.cursor ?? 0);
      return {
        worker: this.workerInfo(worker),
        windowRevision: this.detailVersion(worker.target.id),
        incomplete: this.workerEvents.incomplete(worker.target.id),
        entries: entries.slice(cursor, cursor + limit),
        cursor,
        nextCursor: cursor + limit < entries.length ? cursor + limit : null,
      };
    }
    if (
      name === "code60_send_agent" ||
      name === "code60_finish_agent" ||
      name === "code60_cancel_agent" ||
      name === "code60_stop_agent"
    ) {
      const request = parseControlArgs(name, args);
      if (request.scope !== this.scope)
        throw new Error("Relay scope is stale. Read context again.");
      return this.execution.control(owner, request.runId, async (worker) => {
        if (name === "code60_send_agent" && "prompt" in request) {
          this.reviews?.assertWritableTarget(worker.target);
          this.requireWorkerProvider(worker);
          const assignment = this.plans?.work(owner, request.planTaskId, worker.id);
          if (assignment)
            this.plans?.validate(
              owner,
              { workspaceMode: worker.workspaceMode, planTaskId: assignment.task.id },
              worker.target,
            );
          const previous = worker.owner;
          worker.owner = { ...owner };
          try {
            worker.orchestrator.reply(worker.id, request.prompt);
          } catch (cause) {
            worker.owner = previous;
            throw cause;
          }
          await this.associateReview(worker, worker.orchestrator.runs()[0]?.turns ?? 1);
          try {
            await this.plans?.associate(worker, assignment?.task.id);
          } catch {
            this.error =
              "Worker received the follow-up but plan association could not be saved. Do not repeat the prompt.";
            this.changed();
          }
        } else if (name === "code60_finish_agent") worker.orchestrator.finish(worker.id);
        else if (name === "code60_cancel_agent") worker.orchestrator.cancelTurn(worker.id);
        else await worker.orchestrator.shutdown();
        return this.workerInfo(worker);
      });
    }
    throw new Error("This tool is not available in Relay.");
  }
  private async associateReview(worker: ExecutionWorker, turn: number): Promise<void> {
    try {
      this.authorize(worker.owner);
      if (await this.reviews?.store.associate(worker, turn)) this.reviewChanged(worker.target.id);
    } catch {
      this.paused = true;
      this.error =
        "Worker accepted the task but its review association could not be saved. Inspect the worker; do not repeat the task.";
      this.changed();
    }
  }
  private requireWorkerProvider(worker: ExecutionWorker): void {
    const config = this.config;
    const task = this.tasks.get(worker.owner.taskId)?.config;
    const verified =
      config && Object.hasOwn(config.agents, worker.provider)
        ? config.agents[worker.provider]
        : undefined;
    const frozen =
      task && Object.hasOwn(task.agents, worker.provider)
        ? task.agents[worker.provider]
        : undefined;
    if (!verified || JSON.stringify(verified.command) !== JSON.stringify(frozen?.command))
      throw new Error("Unavailable verified provider");
  }
  private workerEvent(worker: ExecutionWorker, event: RunEvent): void {
    if (worker.owner.generation !== this.generation) return;
    let replies = this.workerReplies.get(worker.id);
    if (!replies) {
      replies = new ConversationReplies();
      this.workerReplies.set(worker.id, replies);
    }
    replies.event(event);
    if (event.type !== "acp") {
      this.workerEvents.append(worker.target.id, { revision: ++this.revision, event });
    }
    if (worker.owner.generation !== this.generation || !this.tasks.has(worker.owner.taskId)) return;
    if (event.type === "prompt") this.replies.set(worker.id, "");
    if (event.type === "message")
      this.replies.set(
        worker.id,
        `${this.replies.get(worker.id) ?? ""}${event.text}`.slice(-2_000),
      );
    if (event.type !== "status") return;
    const view = worker.orchestrator.runs()[0];
    if (
      !view ||
      (view.status !== "idle" && ACTIVE_STATUSES.has(view.status)) ||
      (view.status === "idle" && !event.reason?.startsWith("turn "))
    )
      return;
    if ((this.reported.get(worker.id) ?? -1) >= view.turns) return;
    if (this.inbox.length >= 256) {
      this.paused = true;
      this.error =
        "Relay worker update capacity reached. Further results remain in worker records.";
      this.changed();
      return;
    }
    this.reported.set(worker.id, view.turns);
    this.inbox.push({
      taskId: worker.owner.taskId,
      runId: worker.id,
      provider: `${worker.provider} [${worker.target.cwd}; ${worker.workspaceMode}]`,
      status: view.status,
      turn: view.turns,
      excerpt: this.replies.get(worker.id) ?? "",
    });
    this.reviewChanged();
    this.scheduleDelivery();
  }
  private scheduleDelivery(): void {
    if (
      this.delivery ||
      this.closing ||
      this.paused ||
      (!this.inbox.length && !this.feedback.length && this.plans?.active()?.state !== "queued")
    )
      return;
    this.delivery = setTimeout(() => {
      this.delivery = undefined;
      const deliveryEpoch = this.connectionEpoch;
      const operation = this.turns.then(async () => {
        const run = this.chat?.runs()[0];
        if (
          this.paused ||
          deliveryEpoch !== this.connectionEpoch ||
          this.closing ||
          this.storageFailed ||
          run?.status !== "idle" ||
          run.stopping ||
          run.modeChanging ||
          !this.chat
        )
          return;
        const pending = this.plans?.pending();
        if (pending) {
          const plans = this.plans;
          const chat = this.chat;
          const previous = this.task;
          const previousScope = this.scope;
          try {
            const plan = await plans?.running(pending.plan);
            this.authorize(pending.owner);
            if (!plan || this.chat !== chat || chat.runs()[0]?.status !== "idle")
              throw new Error("Relay changed before plan delivery");
            this.task = pending.owner;
            this.scope = randomUUID();
            chat.reply(
              run.id,
              `Human accepted plan ${plan.id}, proposal revision ${plan.proposalRevision}. Execute only these target/mode assignments with their planTaskId values. Read the plan tool for row IDs.\n\n${planMarkdown(plan)}`,
              "automatic",
            );
          } catch (cause) {
            if (deliveryEpoch === this.connectionEpoch && this.chat === chat) {
              this.task = previous;
              this.scope = previousScope;
            }
            await plans?.failed(pending.plan.id);
            throw cause;
          }
          this.changed();
          return;
        }
        const feedback = this.feedback[0];
        if (feedback) {
          const chat = this.chat;
          const reviews = this.reviews;
          const previous = this.task;
          const previousScope = this.scope;
          const epoch = this.connectionEpoch;
          let accepted = false;
          try {
            if (!reviews) throw new Error("Relay reviews are unavailable");
            await reviews.beginFeedback(feedback.reviewId, feedback.batchId);
            const task = this.tasks.get(feedback.taskId);
            if (!task || this.chat !== chat || chat.runs()[0]?.status !== "idle")
              throw new Error("Originating feedback task is no longer live");
            this.authorize(task.owner);
            this.task = task.owner;
            this.scope = randomUUID();
            chat.reply(
              run.id,
              `Human feedback for originating task ${feedback.taskId}.\n\n${feedback.text}`,
              "automatic",
            );
            accepted = true;
            this.feedback.splice(this.feedback.indexOf(feedback), 1);
            await reviews.finishFeedback(feedback.reviewId, feedback.batchId, {
              accepted: true,
              turn: chat.runs()[0]?.turns ?? 1,
              runId: run.id,
            });
          } catch (cause) {
            if (!accepted) {
              if (epoch === this.connectionEpoch && this.chat === chat) {
                this.task = previous;
                this.scope = previousScope;
              }
              const index = this.feedback.indexOf(feedback);
              if (index >= 0) this.feedback.splice(index, 1);
              await reviews?.finishFeedback(feedback.reviewId, feedback.batchId, {
                accepted: false,
                error: "Feedback was not delivered. Its originating task may no longer be live.",
              });
            }
            throw cause;
          }
          this.changed();
          return;
        }
        // Reply events can schedule another delivery before the accepted batch is removed.
        if (!this.inbox.length) return;
        const taskId = this.inbox[0]?.taskId;
        const task = taskId && this.tasks.get(taskId);
        if (!task) throw new Error("Originating Relay task is no longer live");
        const updates = this.inbox.filter((item) => item.taskId === taskId).slice(0, 20);
        const previous = this.task;
        const previousScope = this.scope;
        this.task = task.owner;
        this.scope = randomUUID();
        try {
          this.chat.reply(
            run.id,
            [
              `Worker results for originating task ${taskId}. Target labels are authoritative provenance, not completion proof.`,
              ...updates.map(formatWorkerUpdate),
            ].join("\n"),
            "automatic",
          );
        } catch (cause) {
          this.task = previous;
          this.scope = previousScope;
          throw cause;
        }
        for (const update of updates) this.inbox.splice(this.inbox.indexOf(update), 1);
        this.activity.received();
      });
      this.deliveries.add(operation);
      void operation.finally(() => this.deliveries.delete(operation)).catch(() => {});
      this.turns = operation.catch(() => {
        if (deliveryEpoch !== this.connectionEpoch) return;
        this.paused = true;
        this.error =
          "Relay plan, feedback or worker result delivery failed. Inspect the conversation before retrying; saved evidence was preserved.";
        this.changed();
      });
    }, 50);
  }
  async stopAll(force = false): Promise<void> {
    this.paused = true;
    const results = await Promise.allSettled([this.stopChat(force), ...this.connections]);
    if (this.orphans.size) await this.stopChat(force);
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Some Relay processes could not be stopped.");
    this.changed();
  }
  async shutdown(force = false): Promise<void> {
    this.closing = true;
    const results = await Promise.allSettled([
      this.stopChat(force),
      this.execution.shutdown(force),
      ...this.connections,
    ]);
    if (this.orphans.size) await this.stopChat(force);
    await this.writer?.flush();
    // Do not release writer ownership while cleanup is unverified.
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Relay cleanup failed; its writer lock was retained.");
    await this.store?.close();
  }
}
