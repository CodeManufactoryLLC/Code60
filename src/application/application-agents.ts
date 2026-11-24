import { join } from "node:path";
import {
  type CustomAgent,
  type CustomAgentRequest,
  type CustomAgentResponse,
  type DetailScope,
  parseCustomAgentRequest,
} from "../bridge/index.js";
import type { SessionResourceFactory } from "../core/index.js";
import { stateHome } from "../core/index.js";
import { CustomAgentStore } from "./custom-agent-store.js";
import type { McpConnectorRole } from "./mcp-configuration.js";
import type { ModelDefaults } from "./model-defaults.js";
import { RelayService } from "./relay-service.js";

type Args = ConstructorParameters<typeof RelayService>;
type Request<K extends keyof RelayService> = RelayService[K] extends (r: infer R) => unknown
  ? R
  : never;

/** Routes by captured owner, never by the UI's selection. Only snapshot() is presentation. */
export class ApplicationAgents {
  private readonly relay: RelayService;
  private readonly agents = new Map<string, RelayService>();
  private selected: RelayService;
  private store: CustomAgentStore | undefined;
  private opening: Promise<void> | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly suspended = new Set<RelayService>();
  private provider: Parameters<RelayService["sync"]>[0];
  private config: Parameters<RelayService["sync"]>[1];
  private knowledge: Parameters<RelayService["attachKnowledge"]>[0] | undefined;
  private closing = false;
  private providerTransition = false;
  private pendingSends = 0;
  private epoch = 0;
  error: string | undefined;
  constructor(
    private readonly deps: Args[0],
    private readonly env: Args[1],
    private readonly notify: Args[2],
    private readonly dialogs: NonNullable<Args[3]>,
    private readonly memory: Args[4],
    private readonly modelDefaults?: ModelDefaults,
    private readonly orchestrationAutoApproval: () => boolean = () => true,
    private readonly onPlanTimingError: () => void = () => {},
    private readonly connectorResources?: (
      role: McpConnectorRole,
      root: string | undefined,
      warning: (message: string) => void,
    ) => SessionResourceFactory,
  ) {
    this.relay = new RelayService(
      deps,
      env,
      notify,
      dialogs,
      memory,
      undefined,
      modelDefaults,
      orchestrationAutoApproval,
      onPlanTimingError,
      connectorResources,
    );
    this.selected = this.relay;
  }
  owner(id: string | null): RelayService | undefined {
    return this.all().find((agent) => agent.owns(id));
  }
  private all() {
    return [this.relay, ...this.agents.values()];
  }
  private require(id: string | null) {
    const owner = this.owner(id);
    if (!owner || this.suspended.has(owner) || this.closing)
      throw new Error("This application conversation is unavailable");
    return owner;
  }
  private load() {
    this.opening ??= CustomAgentStore.open(join(stateHome(this.env), "code60", "custom-agents"))
      .then((store) => {
        this.store = store;
        this.error = undefined;
      })
      .catch((error) => {
        this.opening = undefined;
        throw error;
      });
    return this.opening;
  }
  summaries() {
    return this.store?.list() ?? [];
  }
  snapshots(summary = false) {
    return this.all().map((agent) => agent.snapshot(summary));
  }
  snapshot(summary = false) {
    return this.selected.snapshot(summary);
  }
  owns(id: string | null) {
    return !!this.owner(id);
  }
  get active() {
    return this.pendingSends > 0 || this.all().some((agent) => agent.active);
  }
  beginProviderChange(): () => void {
    if (this.providerTransition || this.active)
      throw new Error("Finish or stop active agent work before changing providers");
    this.providerTransition = true;
    return () => {
      this.providerTransition = false;
    };
  }
  attachKnowledge(knowledge: NonNullable<typeof this.knowledge>) {
    this.knowledge = knowledge;
    for (const agent of this.all()) agent.attachKnowledge(knowledge);
  }
  async sync(provider: typeof this.provider, config: typeof this.config) {
    if (this.closing) return;
    const epoch = this.epoch;
    this.provider = provider;
    this.config = config;
    try {
      await this.load();
    } catch {
      this.error = "Custom assistant storage is unavailable. Existing data was preserved.";
    }
    if (this.closing || epoch !== this.epoch) return;
    await this.each((agent) => agent.sync(provider, config));
  }
  private async each(work: (agent: RelayService) => Promise<unknown>) {
    const results = await Promise.allSettled(this.all().map(work));
    if (results.some((r) => r.status === "rejected"))
      throw new Error(
        "Some application agents could not complete cleanup. Their data was preserved.",
      );
  }
  manage(value: unknown): Promise<CustomAgentResponse> {
    if (this.providerTransition)
      return Promise.reject(new Error("Wait for the provider change to finish"));
    const request = parseCustomAgentRequest(value);
    const epoch = this.epoch;
    const result = this.tail.then(() => this.manageOne(request, epoch));
    this.tail = result.catch(() => {});
    return result;
  }
  private async manageOne(
    request: CustomAgentRequest,
    epoch: number,
  ): Promise<CustomAgentResponse> {
    if (this.closing) throw new Error("Custom assistants are unavailable");
    await this.load();
    if (this.closing || !this.store) throw new Error("Custom assistants are unavailable");
    const store = this.store;
    let agent: CustomAgent | undefined;
    let conversationId: string | undefined;
    switch (request.type) {
      case "read":
        agent = await store.get(request.id);
        break;
      case "create":
        agent = await store.save(request);
        break;
      case "edit":
      case "archive":
      case "restore": {
        await store.get(request.id, request.revision);
        const runtime = this.agents.get(request.id);
        if (runtime) this.suspended.add(runtime);
        try {
          if (request.type === "archive") {
            if (
              !(await this.dialogs.confirm(
                "archive-assistant",
                "Stop this assistant and its workers and hide it from navigation? History and files will be preserved.",
              ))
            )
              break;
          } else if (runtime?.active)
            throw new Error("Stop this assistant and its workers before editing.");
          if (runtime) await runtime.shutdown();
          if (this.closing) throw new Error("Application is stopping");
          if (runtime === this.selected) this.selected = this.relay;
          this.agents.delete(request.id);
          if (request.type === "edit")
            agent = await store.save(request, request.id, request.revision);
          else await store.archive(request.id, request.revision, request.type === "archive");
        } finally {
          if (runtime) this.suspended.delete(runtime);
        }
        break;
      }
      case "open": {
        const definition = await store.get(request.id);
        if (epoch !== this.epoch) throw new Error("Agent opening was cancelled");
        if (definition.archived) throw new Error("Restore this agent before opening it.");
        let runtime = this.agents.get(request.id);
        if (!runtime) {
          runtime = new RelayService(
            this.deps,
            this.env,
            this.notify,
            this.dialogs,
            this.memory,
            {
              ...definition,
              root: join(store.root, definition.id),
            },
            this.modelDefaults,
            this.orchestrationAutoApproval,
            this.onPlanTimingError,
            this.connectorResources,
          );
          if (this.knowledge) runtime.attachKnowledge(this.knowledge);
          this.agents.set(request.id, runtime);
        }
        await runtime.sync(this.provider, this.config);
        if (this.closing || epoch !== this.epoch) {
          await runtime.stopAll();
          throw new Error("Application is stopping");
        }
        const snapshot = runtime.snapshot(true);
        conversationId = snapshot.run?.id ?? snapshot.conversationId;
        if (!conversationId) {
          await runtime.shutdown();
          this.agents.delete(request.id);
          this.notify();
          throw new Error(
            snapshot.error ?? "This agent could not connect. Its data was preserved.",
          );
        }
        this.selected = runtime;
        break;
      }
    }
    this.notify();
    return {
      ...(agent ? { agent } : {}),
      ...(conversationId ? { conversationId } : {}),
    };
  }
  action(request: Request<"action">) {
    if (this.providerTransition && !["select", "history", "stop", "cancel"].includes(request.type))
      throw new Error("Wait for the provider change to finish");
    const owner =
      request.type === "new"
        ? this.selected
        : request.id === null
          ? this.selected
          : this.require(request.id);
    if (this.suspended.has(owner) || this.closing) throw new Error("Agent is unavailable");
    if (request.type === "select") this.selected = owner;
    if (request.type !== "send") return owner.action(request);
    this.pendingSends++;
    this.notify();
    return owner.action(request).finally(() => {
      this.pendingSends--;
      this.notify();
    });
  }
  fileRoot(scope: DetailScope) {
    if (scope.kind === "project")
      throw new Error("This Relay file generation is no longer available");
    return this.require(scope.conversationId).fileRoot(scope);
  }
  readMessage(r: Request<"readMessage">) {
    return this.require(r.conversationId).readMessage(r);
  }
  reviewRequest(r: Request<"reviewRequest">) {
    return this.require(r.conversationId).reviewRequest(r);
  }
  readPlan(r: Request<"readPlan">) {
    return this.require(r.chatId).readPlan(r);
  }
  planAction(r: Request<"planAction">) {
    return this.require(r.chatId).planAction(r);
  }
  handlesWorkerAction(r: Request<"handlesWorkerAction">) {
    return this.all().some((a) => a.handlesWorkerAction(r));
  }
  workerAction(r: Request<"workerAction">) {
    const owner = this.all().find((a) => a.handlesWorkerAction(r));
    if (!owner || this.suspended.has(owner) || this.closing)
      throw new Error("Worker is unavailable");
    return owner.workerAction(r);
  }
  workerSnapshot(summary = false) {
    const snapshots = this.all().map((agent) => agent.workerSnapshot(summary));
    return {
      runs: snapshots.flatMap((s) => s.runs),
      events: snapshots.flatMap((s) => s.events),
      liveIds: snapshots.flatMap((s) => s.liveIds),
    };
  }
  cancelReviewReads() {
    return this.each((a) => a.cancelReviewReads());
  }
  stopFolder(cwd: string) {
    return this.each((a) => a.stopFolder(cwd));
  }
  stopAll() {
    this.epoch++;
    return this.each((a) => a.stopAll());
  }
  async shutdown(force = false) {
    this.closing = true;
    await this.each((a) => a.shutdown(force));
    await this.tail;
    await this.opening?.catch(() => {});
    await this.each((a) => a.shutdown(force));
    await this.store?.close();
  }
}
