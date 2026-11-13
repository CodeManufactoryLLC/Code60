import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Action,
  ActionResult,
  Command,
  DeleteCommand,
  DesktopRun,
  DetailFrame,
  DetailPayload,
  DetailRequest,
  DetailScope,
  DiffIdentity,
  DiffRequest,
  FileContext,
  FileSnapshot,
  McpTable,
  MemoryExtractionRequest,
  MemoryExtractionResult,
  OrchestrationChat,
  OrchestrationChatAction,
  OrchestrationProvider,
  PollKey,
  PollSettingsPatch,
  PollVisibility,
  ProjectEntry,
  PromptId,
  PromptTemplates,
  RecoveryActionResult,
  RunConfiguration,
  RunSettings,
  SaveCommand,
  SaveConfiguration,
  SavePromptTemplate,
  SearchSummaryRequest,
  SearchSummaryResult,
  SequencedEvent,
  SetupAttempt,
  SetupBegin,
  SetupIdentity,
  Snapshot,
  StartRequest,
  TaskAction,
  TaskView,
  WorktreeListing,
} from "../bridge/index.js";
import {
  assembleOperatingContract,
  BUILTIN_COMMANDS,
  DEFAULT_PROMPT_TEMPLATES,
  emitLog,
  expandCommand,
  findTactic,
  type GitProject,
  type GitReadiness,
  type GitSetupCommit,
  type GitSetupFileRequest,
  type GitSetupIdentity,
  isActivityTool,
  isMcpControlTool,
  MCP_PROTOCOL_VERSION,
  type McpControlTool,
  type Plan,
  type PlanAction,
  type PlanRead,
  type ProjectAction,
  type ProjectRequestIdentity,
  parseActivityContextArgs,
  parseDeleteCommand,
  parseDetailIdentity,
  parseDetailRequest,
  parseDiffIdentity,
  parseDiffRequest,
  parseFileContext,
  parseGitProject,
  parseGitSetupCommit,
  parseGitSetupFile,
  parseGitSetupIdentity,
  parseMemoryExtraction,
  parseMemoryRequestId,
  parseOrchestrationChatAction,
  parseOrchestrationProvider,
  parsePlanAction,
  parsePlanRead,
  parsePollKeys,
  parsePollSettings,
  parsePollVisibility,
  parseProjectAction,
  parsePromptTemplateId,
  parseRelayFileContext,
  parseRelayMessageRead,
  parseRelayReview,
  parseReviewAction,
  parseReviewFileRead,
  parseReviewRead,
  parseRunSettings,
  parseSaveCommand,
  parseSaveConfiguration,
  parseSavePromptTemplate,
  parseSearchSummary,
  parseSearchSummaryRequestId,
  parseTaskAction,
  planMarkdown,
  type Review,
  type ReviewAction,
  type ReviewContent,
  type ReviewFileRead,
  type ReviewRead,
  renderPrompt,
  type SavedChat,
} from "../bridge/index.js";
import type { ModeChange } from "../core/index.js";
import {
  ACP_PROTOCOL_VERSION,
  ACTIVE_STATUSES,
  type AgentMcpServer,
  buildHandoffPrompt,
  CODE60_VERSION,
  type CoreDeps,
  commandDeps,
  discardRun,
  executeDiff,
  extractEpisodicMemory,
  generateChatTitle,
  listRuns,
  loadConfig,
  type Orchestrator,
  openWorkspace,
  prepareDiff,
  prepareOrchestrationChat,
  prepareRecovery,
  prepareRuns,
  type RecoveryResult,
  RefusedError,
  RUN_RECORD_FORMAT,
  type RunEvent,
  type RunView,
  readOrchestrationChat,
  listWorktrees as readWorktrees,
  stopRun,
  summarizeSearch,
  TaskLoop,
  type TaskProposal,
  type TaskSource,
  type Workspace,
} from "../core/index.js";
import {
  diagnosticMessage,
  privateDirectory,
  samePath,
  setEnvironmentPath,
} from "../platform/index.js";
import { probeAgent } from "./agent-connection.js";
import { AgentSetup } from "./agent-setup.js";
import { ChatStore } from "./chat-store.js";
import {
  type ChatSession,
  ConversationCoordinator,
  type Worker,
} from "./conversation-coordinator.js";
import { ConversationReplies } from "./conversation-replies.js";
import { DetailSubscriptions } from "./detail-subscriptions.js";
import { DiffReads, prepareUnlessAborted } from "./diff-reads.js";
import { desktopPath } from "./environment.js";
import { readFiles } from "./files.js";
import { GitSetup } from "./git-setup.js";
import { logProjectId } from "./log-store.js";
import {
  type ControlArgs,
  formatWorkerUpdate,
  parseControlArgs,
  workerTranscript,
} from "./mcp-control.js";
import { createMcpGateway } from "./mcp-gateway.js";
import { type McpTableRow, readMcpTool } from "./mcp-tables.js";
import { PlanStore } from "./plans.js";
import type { DesktopPreferences } from "./preferences.js";
import { ProjectHost } from "./project-host.js";
import { type OpenProjectDatabase, type ProjectDatabase, SCHEMA } from "./projects.js";
import { effectivePrompts, promptStates } from "./prompt-templates.js";
import { desktopConfig, detectProvider } from "./provider-catalog.js";
import { RelayFiles } from "./relay-files.js";
import { RelayService } from "./relay-service.js";
import { ReviewStore } from "./reviews.js";
import { summarizeRun } from "./run-summary.js";
import { type PollOwner, ScopedPoller } from "./scoped-poller.js";
import { projectSearchEvidence } from "./search-evidence.js";
import { captureTask, taskDelivery } from "./tactic-context.js";

export interface DesktopDialogs {
  confirm(title: string, detail: string): Promise<boolean>;
}

export interface DesktopStorage {
  /** App-owned Relay runtime. Omit for consumers that host only project work. */
  relay?: boolean;
  openDatabase: OpenProjectDatabase;
  preferences: DesktopPreferences;
  detectAgent?: typeof detectProvider;
  refreshPath?: (signal: AbortSignal) => Promise<void>;
}

const message = diagnosticMessage;
function mcpSessionMetrics(events: readonly RunEvent[], now: number) {
  const completed: number[] = [];
  let prompt: { at: number; turn: number } | undefined;
  const statuses: { status: string; at: number }[] = [];
  const buckets = Array<number>(10).fill(0);
  const bucketStart = now - 5 * 60_000;
  for (const event of events) {
    const at = Date.parse(event.at);
    if (!Number.isFinite(at)) continue;
    if (event.type === "prompt") prompt = { at, turn: event.turn };
    else if (event.type === "status") {
      if (!["running", "waiting"].includes(event.status) && prompt && at >= prompt.at) {
        completed.push((at - prompt.at) / 1000);
        prompt = undefined;
      }
      statuses.push({ status: event.status, at });
    }
    // Raw ACP copies and turn-end records would double-count the activity they describe.
    if (
      event.type !== "status" &&
      event.type !== "acp" &&
      event.type !== "sessionState" &&
      event.type !== "turnEnd" &&
      at >= bucketStart &&
      at < now
    ) {
      const index = Math.floor((at - bucketStart) / 30_000);
      if (index >= 0 && index < buckets.length) buckets[index] = (buckets[index] ?? 0) + 1;
    }
  }
  const recent = completed.slice(-6);
  const spans: string[] = [];
  for (let index = 0; index < statuses.length; index++) {
    const current = statuses[index];
    if (!current) continue;
    const start = Math.max(now - 120_000, current.at);
    const end = Math.min(now, statuses[index + 1]?.at ?? now);
    if (end <= start) continue;
    spans.push(`${current.status} ${Math.round((end - start) / 1000)}s`);
  }
  return {
    turnTime: recent.length
      ? `Last ${recent.length} completed turns (seconds): ${recent.map(Math.round).join(", ")}`
      : "Turn time unavailable",
    events5m:
      events.length > 0
        ? `Events in ten 30-second buckets, oldest first: ${buckets.join(", ")}`
        : "Events unavailable",
    last2m: spans.length ? spans.join(", ") : "Unavailable",
  };
}

const pollSourceLabels: Record<PollKey, string> = {
  history: "Run history",
  config: "Agent config",
  configurations: "Run configurations",
  worktrees: "Worktrees",
  files: "Files",
};

const timeSetting = (milliseconds: number | null) =>
  milliseconds === null ? "Off" : `${milliseconds / 1000}s`;

interface Batch {
  active: boolean;
  disposers: (() => void)[];
}

/** Owns one workspace and independent batches. All history mutations are serialized. */
export class DesktopController {
  private readonly projectHost = new ProjectHost(() => this.makeProjectState());
  private makeProjectState() {
    return {
      workspace: undefined as Workspace | undefined,
      batches: new Map() as Map<Orchestrator, Batch>,
      history: [] as DesktopRun[],
      events: [] as SequencedEvent[],
      pending: [] as SequencedEvent[],
      replies: new Map<string, ConversationReplies>(),
      warnings: [] as string[],
      launches: new Map() as Map<string, { settings: RunSettings; at: string; saved: boolean }>,
      worktrees: null as WorktreeListing | null,
      fileContext: null as FileContext | null,
      files: null as FileSnapshot | null,
      memoryExtraction: undefined as
        | { requestId: string; abort: AbortController; done: Promise<MemoryExtractionResult> }
        | undefined,
      searchSummary: undefined as
        | { requestId: string; abort: AbortController; done: Promise<SearchSummaryResult> }
        | undefined,
      chatKey: "" as string,
      chatStore: undefined as ChatStore | undefined,
      chatRegistryLoaded: false as boolean,
      reviews: undefined as ReviewStore | undefined,
      tasks: undefined as TaskLoop | undefined,
      taskOperation: undefined as
        | { reviewId: string; abort: AbortController; done: Promise<void> }
        | undefined,
      gitState: undefined as GitReadiness | undefined,
      gitSetup: undefined as GitSetup | undefined,
      gitOperation: false as boolean,
      gitSetupEpoch: 0 as number,
      feedbackScheduled: false as boolean,
      feedbackChanged: false as boolean,
      planDeliveryScheduled: false as boolean,
      planDeliveryChanged: false as boolean,
      reviewCaptures: new Map() as Map<string, boolean>,
      conversations: this.createConversations(),
      launchEpoch: 0,
      detailRevision: 0,
    };
  }
  private get projectState() {
    return this.projectHost.current.state;
  }
  private get conversations() {
    return this.projectState.conversations;
  }
  private readonly relay: RelayService | undefined;
  private relaySelected = true;
  private readonly agentSetup: AgentSetup;
  private readonly diffReads = new DiffReads();
  private get workspace(): Workspace | undefined {
    return this.projectState.workspace;
  }
  private set workspace(value: Workspace | undefined) {
    this.projectState.workspace = value;
  }
  private get batches(): Map<Orchestrator, Batch> {
    return this.projectState.batches;
  }
  private set batches(value: Map<Orchestrator, Batch>) {
    this.projectState.batches = value;
  }
  private get history(): DesktopRun[] {
    return this.projectState.history;
  }
  private set history(value: DesktopRun[]) {
    this.projectState.history = value;
  }
  private config: Awaited<ReturnType<typeof loadConfig>> | undefined;
  private revision = 0;
  private publishedRevision = 0;
  private get events(): SequencedEvent[] {
    return this.projectState.events;
  }
  private set events(value: SequencedEvent[]) {
    this.projectState.events = value;
  }
  private get pending(): SequencedEvent[] {
    return this.projectState.pending;
  }
  private set pending(value: SequencedEvent[]) {
    this.projectState.pending = value;
  }
  private get warnings(): string[] {
    return this.projectState.warnings;
  }
  private set warnings(value: string[]) {
    this.projectState.warnings = value;
  }
  private listeners = new Set<(snapshot: Snapshot) => void>();
  private summaryListeners = new Set<(snapshot: Snapshot) => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private closing = false;
  private forceClosing = false;
  private database: ProjectDatabase | undefined;
  private databaseError: string | null = null;
  private projects: ProjectEntry[] = [];
  private configurations: RunConfiguration[] = [];
  /** Template edits saved in the connected database. */
  private savedPrompts: Partial<PromptTemplates> = {};
  private commands: Command[] = [];
  private get launches(): Map<string, { settings: RunSettings; at: string; saved: boolean }> {
    return this.projectState.launches;
  }
  private set launches(value: Map<string, { settings: RunSettings; at: string; saved: boolean }>) {
    this.projectState.launches = value;
  }
  private get worktrees(): WorktreeListing | null {
    return this.projectState.worktrees;
  }
  private set worktrees(value: WorktreeListing | null) {
    this.projectState.worktrees = value;
  }
  private get fileContext(): FileContext | null {
    return this.projectState.fileContext;
  }
  private set fileContext(value: FileContext | null) {
    this.projectState.fileContext = value;
  }
  private get files(): FileSnapshot | null {
    return this.projectState.files;
  }
  private set files(value: FileSnapshot | null) {
    this.projectState.files = value;
  }
  private pollOverrides: PollSettingsPatch = {};
  private visibility: PollVisibility = { visible: false, worktrees: false, files: false };
  private readonly poller: ScopedPoller;
  private readonly relayFiles = new RelayFiles(() => this.changed(null));
  private readonly details = new DetailSubscriptions((id) => this.relayFiles.remove(id));
  private orchestration: OrchestrationProvider = {
    provider: null,
    allowAll: true,
    connection: "idle",
    error: null,
  };
  private get memoryExtraction():
    | { requestId: string; abort: AbortController; done: Promise<MemoryExtractionResult> }
    | undefined {
    return this.projectState.memoryExtraction;
  }
  private set memoryExtraction(value:
    | { requestId: string; abort: AbortController; done: Promise<MemoryExtractionResult> }
    | undefined) {
    this.projectState.memoryExtraction = value;
  }
  private get searchSummary():
    | { requestId: string; abort: AbortController; done: Promise<SearchSummaryResult> }
    | undefined {
    return this.projectState.searchSummary;
  }
  private set searchSummary(value:
    | { requestId: string; abort: AbortController; done: Promise<SearchSummaryResult> }
    | undefined) {
    this.projectState.searchSummary = value;
  }
  private connectionTest: { abort: AbortController; done: Promise<void> } | undefined;
  private get chatKey(): string {
    return this.projectState.chatKey;
  }
  private set chatKey(value: string) {
    this.projectState.chatKey = value;
  }
  private get chatStore(): ChatStore | undefined {
    return this.projectState.chatStore;
  }
  private set chatStore(value: ChatStore | undefined) {
    this.projectState.chatStore = value;
  }
  private get chatRegistryLoaded(): boolean {
    return this.projectState.chatRegistryLoaded;
  }
  private set chatRegistryLoaded(value: boolean) {
    this.projectState.chatRegistryLoaded = value;
  }

  private async saveChat(session: ChatSession): Promise<void> {
    const run = session.run;
    const provider = session.saved?.provider ?? run?.agent;
    const command = provider ? this.config?.agents[provider]?.command : undefined;
    if (!this.chatStore || !run || !session.chatDirectory || !provider) return;
    const saved: SavedChat = {
      format: 1,
      directoryId: basename(session.chatDirectory),
      runId: run.id,
      provider,
      commandHash:
        session.saved?.commandHash ??
        createHash("sha256").update(JSON.stringify(command)).digest("hex"),
      ...(session.title === undefined ? {} : { title: session.title }),
      archived: session.archived,
      selectedAt: session.selectedAt,
      ...(session.tactic === undefined ? {} : { tactic: session.tactic }),
      tasks: session.tasks,
      ...(session.taskId ? { taskId: session.taskId } : {}),
    };
    await this.chatStore.save(saved);
    session.saved = saved;
  }

  private persistChatSoon(session: ChatSession): void {
    void this.exclusive(async () => {
      if (session.revoked || !this.conversations.sessions.includes(session)) return;
      await this.saveChat(session);
    }).catch(() => {
      session.chatError =
        "Chat context could not be saved. Inspect the conversation before continuing; do not resend completed work.";
      this.changed();
    });
  }

  private async chatHistory(saved: SavedChat, includeEvents = true) {
    const store = this.chatStore;
    if (!store) throw new Error("Chat storage is unavailable");
    const directory = await store.directory(saved.directoryId);
    const result = await readOrchestrationChat(
      {
        ...this.deps,
        fs: {
          ...this.deps.fs,
          readFile: (path) => store.readHistory(saved.directoryId, saved.runId, path),
        },
      },
      directory,
      saved.runId,
      includeEvents,
    );
    if (result.record.agent !== saved.provider) throw new Error("Saved chat provider mismatch");
    return result;
  }

  private async loadChatHistory(session: ChatSession) {
    if (!session.restored || session.historyLoaded || !session.saved || !session.chatDirectory)
      return;
    const { events } = await this.chatHistory(session.saved);
    session.plans = await PlanStore.open(session.chatDirectory, session.saved.runId);
    session.chatEvents = events.map((event) => ({ revision: ++this.revision, event }));
    session.replies.reset(events);
    session.chatPending = [...session.chatEvents];
    session.historyLoaded = true;
  }

  private async sendTask(
    session: ChatSession,
    text: string,
    origin?: "automatic",
    taskId: string | null | undefined = session.taskId,
  ): Promise<void> {
    const task = session.tasks.find((task) => task.id === taskId);
    if (task && task.project !== (this.workspace?.dir ?? null))
      throw new Error("Open the originating task's project before delivering its updates");
    const previous = session.taskId;
    const deliveries = task?.deliveries ? [...task.deliveries] : [];
    session.taskId = taskId ?? undefined;
    if (task) task.deliveries = [...deliveries, (session.run?.turns ?? 0) + 1];
    session.deliveryPending = true;
    try {
      await this.saveChat(session);
      this.conversations.send(session, text, origin, undefined, taskId ?? null);
    } catch (cause) {
      session.taskId = previous;
      if (task) task.deliveries = deliveries;
      this.persistChatSoon(session);
      throw cause;
    } finally {
      session.deliveryPending = false;
    }
  }
  private createConversations(): ConversationCoordinator {
    return new ConversationCoordinator({
      sendAutomatic: (session, text, taskId) =>
        this.exclusive(async () => {
          if (session.updatesPaused || this.closing) throw new Error("Worker updates are paused");
          await this.sendTask(session, text, "automatic", taskId ?? null);
        }),
      hasPendingFeedback: (session) =>
        (!!session.plans?.active() && session.plans.active()?.state !== "running") ||
        (this.reviews
          ?.list()
          .some(
            (review) =>
              review.chatId === session.chat?.runs()[0]?.id &&
              review.submissions.some(
                (batch) => batch.state === "pending" || batch.state === "delivering",
              ),
          ) ??
          false),
      directory: () => this.workspace?.dir,
      view: (id) => this.liveView(id),
      closing: () => this.closing,
      changed: () => this.changed(),
      formatUpdates: (updates) =>
        renderPrompt(
          "workerUpdates",
          effectivePrompts(this.config?.prompts ?? DEFAULT_PROMPT_TEMPLATES, this.savedPrompts)
            .workerUpdates,
          { updates: updates.map(formatWorkerUpdate).join("\n") },
        ),
      deliver: (session, text, origin, deliveredText) => {
        const run = session.chat?.runs()[0];
        if (!session.chat || !run) throw new Error("No orchestration session is available");
        session.chat.reply(run.id, text, origin, deliveredText);
      },
    });
  }

  private get reviews(): ReviewStore | undefined {
    return this.projectState.reviews;
  }
  private set reviews(value: ReviewStore | undefined) {
    this.projectState.reviews = value;
  }
  private get tasks(): TaskLoop | undefined {
    return this.projectState.tasks;
  }
  private set tasks(value: TaskLoop | undefined) {
    this.projectState.tasks = value;
  }
  private get taskOperation():
    | { reviewId: string; abort: AbortController; done: Promise<void> }
    | undefined {
    return this.projectState.taskOperation;
  }
  private set taskOperation(value:
    | { reviewId: string; abort: AbortController; done: Promise<void> }
    | undefined) {
    this.projectState.taskOperation = value;
  }

  private taskLoop(store: ReviewStore): TaskLoop | undefined {
    const git = this.deps.git.tasks;
    if (!git || !this.workspace?.repo) return undefined;
    const database = this.database?.path;
    this.tasks ??= new TaskLoop(
      store.project,
      store.root,
      git,
      undefined,
      database ? [database, `${database}-wal`, `${database}-shm`, `${database}-journal`] : [],
    );
    return this.tasks;
  }

  private get gitState(): GitReadiness | undefined {
    return this.projectState.gitState;
  }
  private set gitState(value: GitReadiness | undefined) {
    this.projectState.gitState = value;
  }
  private get gitSetup(): GitSetup | undefined {
    return this.projectState.gitSetup;
  }
  private set gitSetup(value: GitSetup | undefined) {
    this.projectState.gitSetup = value;
  }
  private get gitOperation(): boolean {
    return this.projectState.gitOperation;
  }
  private set gitOperation(value: boolean) {
    this.projectState.gitOperation = value;
  }
  private get gitSetupEpoch(): number {
    return this.projectState.gitSetupEpoch;
  }
  private set gitSetupEpoch(value: number) {
    this.projectState.gitSetupEpoch = value;
  }

  private async probeGit(directory: string): Promise<GitReadiness> {
    if (this.deps.git.setup) return this.deps.git.setup.readiness(directory);
    const repo = await this.deps.git.repoInfo(directory).catch(() => null);
    if (!repo) return { status: "not_repository", message: "This folder is not a Git repository." };
    try {
      await this.deps.git.resolveCommit(repo.topLevel, "HEAD");
      return { status: "ready", root: repo.topLevel, message: "Ready for isolated workers" };
    } catch {
      return {
        status: "no_commits",
        root: repo.topLevel,
        message: "This repository needs an initial commit.",
      };
    }
  }
  private gitProject(project: string): Workspace {
    this.projectHost.assertCurrent(this.projectHost.current);
    const workspace = this.requireWorkspace();
    if (this.closing || workspace.dir !== project)
      throw new Error("This Git setup project is no longer open");
    return workspace;
  }
  async checkGit(value: GitProject): Promise<GitReadiness> {
    const request = parseGitProject(value);
    return this.projectRequest(request, () => this.checkProjectGit(request.project));
  }
  private async checkProjectGit(project: string): Promise<GitReadiness> {
    const workspace = this.gitProject(project);
    const result = await this.probeGit(project);
    this.projectHost.assertCurrent(this.projectHost.current);
    if (workspace !== this.workspace) throw new Error("Project changed");
    this.gitState = result;
    this.changed();
    return result;
  }
  private async requireGitRun(id?: string): Promise<void> {
    if (this.taskOperation) throw new Error("Wait for the task operation to finish");
    if (this.gitOperation || this.gitSetup?.busy)
      throw new Error("Finish Git setup before starting workers");
    const workspace = this.requireWorkspace();
    if (id && (await workspace.store.read(id)).base === null)
      throw new Error(
        "No baseline was captured for this run. Start a new isolated worker after setting up Git.",
      );
    const state = await this.checkProjectGit(workspace.dir);
    if (state.status !== "ready")
      throw new Error(`Set up Git to enable workers and change review. ${state.message}`);
    if (!workspace.repo) {
      this.workspace = await openWorkspace(this.deps, workspace.dir, this.env, true);
      this.history = await listRuns(commandDeps(this.deps, this.workspace));
    }
  }
  private async setupAllowed(project: string): Promise<GitSetup> {
    const workspace = this.gitProject(project);
    if (this.taskOperation) throw new Error("Wait for the task operation to finish");
    if (this.gitOperation || this.gitSetup?.busy)
      throw new Error("Git setup is already in progress");
    if (this.active)
      throw new Error("Stop project workers before setting up Git. Chat can stay open.");
    for (const session of this.conversations.sessions) {
      const run = session.chat?.runs()[0];
      if (run && ACTIVE_STATUSES.has(run.status) && (await samePath(run.worktree, project)))
        throw new Error("This folder is in use by Chat. Open your project folder to set up Git.");
    }
    const history = await listRuns(commandDeps(this.deps, workspace));
    if (history.some((run) => run.agentAlive || ACTIVE_STATUSES.has(run.record.status)))
      throw new Error("Stop project workers and leftover agents before setting up Git.");
    if (!this.deps.git.setup) throw new Error("Guided Git setup is unavailable");
    if (!this.gitSetup) {
      const database = this.database?.path;
      this.gitSetup = new GitSetup(
        this.deps.git.setup,
        database ? [database, `${database}-wal`, `${database}-shm`, `${database}-journal`] : [],
      );
    }
    return this.gitSetup;
  }
  private async gitWork<T>(project: string, work: (setup: GitSetup) => Promise<T>): Promise<T> {
    const epoch = this.gitSetupEpoch;
    const admitted = await this.exclusive(async () => {
      if (epoch !== this.gitSetupEpoch) throw new Error("Git setup cancelled");
      const setup = await this.setupAllowed(project);
      if (epoch !== this.gitSetupEpoch) throw new Error("Git setup cancelled");
      this.gitOperation = true;
      return { setup, workspace: this.workspace };
    });
    try {
      if (this.closing || epoch !== this.gitSetupEpoch || this.workspace !== admitted.workspace)
        throw new Error("Git setup context changed");
      return await work(admitted.setup);
    } finally {
      let state: GitReadiness | undefined;
      let workspace: Workspace | undefined;
      let history: DesktopRun[] | undefined;
      try {
        // Rechecking Git/storage can be slow too. Only publication belongs in the control queue.
        if (!this.closing && this.workspace === admitted.workspace) {
          state = await this.probeGit(project);
          if (state.status === "ready" || state.status === "no_commits") {
            workspace = await openWorkspace(this.deps, project, this.env, true);
            history = await listRuns(commandDeps(this.deps, workspace));
          }
        }
      } finally {
        await this.exclusive(async () => {
          if (!this.closing && this.workspace === admitted.workspace && state) {
            this.gitState = state;
            if (workspace && history) {
              this.workspace = workspace;
              this.history = history;
              this.poller.invalidate(["history", "worktrees", "files"]);
            }
          }
          this.gitOperation = false;
          this.changed();
        });
      }
    }
  }
  beginGitSetup(value: GitProject) {
    const request = parseGitProject(value);
    return this.projectRequest(request, () =>
      this.gitWork(request.project, (setup) => setup.begin(request.project)),
    );
  }
  previewGitSetupFile(value: GitSetupFileRequest): ReturnType<GitSetup["previewFile"]> {
    const request = parseGitSetupFile(value);
    return this.projectRequest(request, async () => {
      this.gitProject(request.project);
      if (!this.gitSetup) throw new Error("Open Git setup first");
      return this.gitSetup.previewFile(request);
    });
  }
  initializeGit(value: GitSetupIdentity) {
    const request = parseGitSetupIdentity(value);
    return this.projectRequest(request, () =>
      this.gitWork(request.project, (setup) => setup.initialize(request)),
    );
  }
  commitGitSetup(value: GitSetupCommit) {
    const request = parseGitSetupCommit(value);
    return this.projectRequest(request, () =>
      this.gitWork(request.project, (setup) => setup.commit(request)),
    );
  }
  cancelGitSetup(value?: GitProject): Promise<void> {
    const request = value ? parseGitProject(value) : undefined;
    if (request) return this.projectRequest(request, () => this.cancelGitSetup());
    this.gitSetupEpoch++;
    return this.gitSetup?.cancel() ?? Promise.resolve();
  }
  private get feedbackScheduled(): boolean {
    return this.projectState.feedbackScheduled;
  }
  private set feedbackScheduled(value: boolean) {
    this.projectState.feedbackScheduled = value;
  }
  private get feedbackChanged(): boolean {
    return this.projectState.feedbackChanged;
  }
  private set feedbackChanged(value: boolean) {
    this.projectState.feedbackChanged = value;
  }
  private get planDeliveryScheduled(): boolean {
    return this.projectState.planDeliveryScheduled;
  }
  private set planDeliveryScheduled(value: boolean) {
    this.projectState.planDeliveryScheduled = value;
  }
  private get planDeliveryChanged(): boolean {
    return this.projectState.planDeliveryChanged;
  }
  private set planDeliveryChanged(value: boolean) {
    this.projectState.planDeliveryChanged = value;
  }

  private async plans(session: ChatSession): Promise<PlanStore> {
    this.projectHost.assertCurrent(this.projectHost.current);
    this.conversations.assertCurrent(session);
    const id = session.run?.id;
    if (!id || !session.chatDirectory) throw new Error("No orchestration session is available");
    session.plans ??= await PlanStore.open(session.chatDirectory, id);
    return session.plans;
  }

  readRelayMessage(value: unknown) {
    const request = parseRelayMessageRead(value);
    if (!this.relay) return Promise.reject(new Error("Relay history is unavailable"));
    return this.relay.readMessage(request);
  }
  relayReview(value: unknown) {
    const request = parseRelayReview(value);
    if (!this.relay) return Promise.reject(new Error("Relay reviews are unavailable"));
    return this.relay.reviewRequest(request);
  }

  readPlan(value: PlanRead): Promise<Plan> {
    const request = parsePlanRead(value);
    if (this.relay?.owns(request.chatId)) return this.relay.readPlan(request);
    const owner = this.chatOwner(request.chatId);
    if (owner && owner !== this.projectHost.current)
      return this.projectHost.run(owner, () => this.readPlan(request));
    return this.exclusive(async () => {
      const session = this.conversations.sessions.find((item) => item.run?.id === request.chatId);
      if (!session) throw new Error("This plan conversation is no longer available");
      return (await this.plans(session)).get(request.planId);
    });
  }

  planAction(value: PlanAction): Promise<void> {
    const request = parsePlanAction(value);
    if (this.relay?.owns(request.chatId)) return this.relay.planAction(request);
    const owner = this.chatOwner(request.chatId);
    if (owner && owner !== this.projectHost.current)
      return this.projectHost.run(owner, () => this.planAction(request));
    return this.exclusive(async () => {
      const session = this.conversations.sessions.find((item) => item.run?.id === request.chatId);
      if (!session) throw new Error("This plan conversation is no longer available");
      const store = await this.plans(session);
      const plan = store.get(request.planId);
      if (request.type === "accept" && plan.acceptedRevision === request.revision) return;
      if (request.type !== "dismiss") {
        if (plan.project !== (this.workspace?.dir ?? null))
          throw new Error("Open this plan's project before continuing");
        const run = session.chat?.runs()[0];
        if (!run || !ACTIVE_STATUSES.has(run.status) || run.stopping)
          throw new Error("This plan's conversation has ended");
      }
      await store.action(request);
      if (request.type !== "dismiss") {
        session.planScope = session.workerScope;
        this.conversations.resume(session);
        this.schedulePlans();
      } else {
        this.conversations.scheduleUpdates();
        this.scheduleFeedback();
      }
      this.changed();
    });
  }

  private assertPlanWork(session: ChatSession): void {
    const plan = session.plans?.active();
    if (!plan) return;
    if (plan.state !== "running")
      throw new Error("Accept or resume the plan before starting worker work");
    if (
      session.updatesPaused ||
      session.planScope !== session.workerScope ||
      plan.project !== (this.workspace?.dir ?? null)
    )
      throw new Error("Plan execution is paused or its project changed");
  }

  private planTask(session: ChatSession, requested?: string, workerId?: string) {
    this.assertPlanWork(session);
    const plan = session.plans?.active();
    if (!plan) {
      if (requested) throw new Error("No accepted plan is active");
      return undefined;
    }
    const worker = workerId ? this.conversations.workers.get(workerId) : undefined;
    const id = requested ?? (worker?.planId === plan.id ? worker.planTaskId : undefined);
    const task = plan.tasks.find((task) => task.id === id && task.state !== "completed");
    if (!task) throw new Error("Supply planTaskId for an unfinished task in the accepted plan");
    return { planId: plan.id, planTaskId: task.id };
  }

  private async associatePlanWorker(
    session: ChatSession,
    runId: string,
    assignment: { planId: string; planTaskId: string } | undefined,
  ) {
    if (!assignment) return;
    const worker = this.conversations.workers.get(runId);
    if (worker) Object.assign(worker, assignment);
    try {
      await session.plans?.mutate(assignment.planId, (plan) => {
        const task = plan.tasks.find((task) => task.id === assignment.planTaskId);
        if (task && !task.workerIds.includes(runId)) task.workerIds.push(runId);
      });
    } catch (cause) {
      this.warnings.push(
        `Worker started but plan association could not be saved: ${message(cause)}. Inspect the worker before retrying.`,
      );
    }
    this.changed();
  }

  private async pausePlan(session: ChatSession, reason: string): Promise<void> {
    const plan = session.plans?.active();
    if (!plan || !["queued", "running"].includes(plan.state)) return;
    await session.plans?.mutate(plan.id, (current) => {
      current.state = "paused";
      current.error = reason;
    });
  }

  private schedulePlans(): void {
    if (this.closing) return;
    if (this.planDeliveryScheduled) {
      this.planDeliveryChanged = true;
      return;
    }
    this.planDeliveryScheduled = true;
    void this.exclusive(async () => {
      for (const session of this.conversations.sessions) {
        const store = session.plans;
        const plan = store?.active();
        if (!store || !plan || plan.state !== "queued" || session.revoked || session.updatesPaused)
          continue;
        if (
          session.planScope !== session.workerScope ||
          plan.project !== (this.workspace?.dir ?? null)
        ) {
          await this.pausePlan(session, "Project changed. Inspect previous work before resuming.");
          continue;
        }
        const run = session.chat?.runs()[0];
        if (
          run &&
          (["queued", "running", "waiting"].includes(run.status) ||
            run.stopping ||
            run.modeChanging)
        )
          continue;
        let deliveryAttempted = false;
        try {
          if (run?.status !== "idle") throw new Error("The plan conversation is unavailable");
          // Persist before dispatch. A crash cannot replay this message on reopening.
          await store.mutate(plan.id, (current) => {
            current.state = "running";
            delete current.error;
          });
          deliveryAttempted = true;
          await this.sendTask(
            session,
            `Code60: the user accepted plan ${plan.id}. Read it with code60_read_plan, inspect any previous work, and execute the remaining tasks. Report each task's progress with evidence and responsible workerIds. Do not repeat completed work.`,
            "automatic",
            session.tasks.find((task) => task.planIds.includes(plan.id))?.id ?? null,
          );
        } catch (cause) {
          this.conversations.pause(session);
          session.planScope = undefined;
          await store.mutate(plan.id, (current) => {
            current.state = "failed";
            current.error =
              `${deliveryAttempted ? "Delivery may have completed. Inspect the conversation before resuming. " : ""}${message(cause)}`.slice(
                0,
                2_000,
              );
          });
        }
      }
      this.changed();
    })
      .catch((cause: unknown) => {
        this.warnings.push(`Could not deliver plan: ${message(cause)}`);
        this.changed();
      })
      .finally(() => {
        this.planDeliveryScheduled = false;
        if (this.planDeliveryChanged) {
          this.planDeliveryChanged = false;
          this.schedulePlans();
        }
      });
  }

  private get reviewCaptures(): Map<string, boolean> {
    return this.projectState.reviewCaptures;
  }
  private set reviewCaptures(value: Map<string, boolean>) {
    this.projectState.reviewCaptures = value;
  }

  private reviewStore(project: string): ReviewStore {
    this.projectHost.assertCurrent(this.projectHost.current);
    if (this.closing || !this.reviews || this.workspace?.dir !== project)
      throw new Error("This review project is no longer open");
    return this.reviews;
  }

  private async projectRequest<T>(
    request: ProjectRequestIdentity & { project: string },
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.relay && (!request.projectId || request.databaseEpoch === undefined))
      throw new Error("This request needs the current project identity");
    const owner = request.projectId
      ? this.projectHost.byId(request.projectId)
      : (this.projectHost.find(request.project) ?? this.projectHost.current);
    this.projectHost.assertCurrent(owner);
    if (
      (request.databaseEpoch !== undefined && request.databaseEpoch !== owner.epoch) ||
      owner.state.workspace?.dir !== request.project
    )
      throw new Error("This project or database instance is no longer open");
    return this.projectHost.run(owner, async () => {
      this.projectHost.assertCurrent(owner);
      const result = await operation();
      this.projectHost.assertCurrent(owner);
      return result;
    });
  }

  async taskAction(value: TaskAction): Promise<TaskView> {
    const request = parseTaskAction(value);
    return this.projectRequest(request, () => this.projectTaskAction(request));
  }

  private async projectTaskAction(request: TaskAction): Promise<TaskView> {
    const store = this.reviewStore(request.project);
    const loop = this.taskLoop(store);
    const git = this.deps.git.tasks;
    if (!loop || !git) {
      if (request.type === "status")
        return { available: false, canPrepare: false, source: "Selected Git revision" };
      throw new Error("Task application is unavailable");
    }
    let review = store.get(request.reviewId);
    const view = async (proposal?: TaskProposal | null): Promise<TaskView> => {
      const state = await loop.state(review.id);
      const pending = await loop.pendingOperation(review.id);
      const operation = pending ?? proposal ?? (await loop.latest(review.id));
      const undo = await loop.lastApplied(review.id);
      const current = store.get(request.reviewId);
      const sources = current.revisions.at(-1)?.sources;
      return {
        available: true,
        canPrepare:
          !current.error &&
          !!sources?.length &&
          current.workers.every((worker) =>
            sources.some((source) => source.runId === worker.runId),
          ),
        source: state.baseline ? "Current saved files" : "Selected Git revision",
        ...(undo ? { undoId: undo.id } : {}),
        ...(operation
          ? {
              operation: {
                id: operation.id,
                revisionId: operation.revisionId,
                status: pending ? "recovery" : operation.status,
                changes: operation.changes.map(({ id, path }) => ({ id, path })),
                conflicts: operation.conflicts,
                ...(operation.error ? { error: operation.error } : {}),
              },
            }
          : {}),
      };
    };
    if (request.type === "cancel") {
      const active = this.taskOperation;
      if (active?.reviewId === review.id) {
        active.abort.abort(new Error("Task operation cancelled"));
        await active.done;
      }
      return view();
    }
    if (request.type === "status") return view();
    if (request.type === "file") {
      const proposal = await loop.proposal(review.id, request.operationId);
      const file = proposal.changes.find((file) => file.id === request.fileId);
      if (!file) throw new Error("Unknown proposal file");
      const before = Buffer.from(file.before?.data ?? "", "base64");
      const after = Buffer.from(file.after?.data ?? "", "base64");
      const limited = [before, after].some(
        (data) =>
          data.length > 1_048_576 ||
          data.includes(0) ||
          !Buffer.from(data.toString("utf8")).equals(data),
      );
      return {
        ...(await view(proposal)),
        file: {
          path: file.path,
          original: limited ? "" : before.toString("utf8"),
          modified: limited ? "" : after.toString("utf8"),
          ...(limited
            ? { limitation: "Binary or large file; complete contents will be applied" }
            : {}),
        },
      };
    }
    let finish = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const abort = new AbortController();
    await this.exclusive(async () => {
      if (store !== this.reviewStore(request.project)) throw new Error("Task project changed");
      if (this.taskOperation || this.gitOperation || this.gitSetup?.busy)
        throw new Error("Wait for the current task operation");
      const workspace = this.requireWorkspace();
      if (!workspace.repo || !(await samePath(workspace.dir, workspace.repo.topLevel)))
        throw new Error("Open the repository root to apply task changes");
      review = store.get(request.reviewId);
      const history = await listRuns(commandDeps(this.deps, this.requireWorkspace()));
      for (const worker of review.workers) {
        const run = history.find((run) => run.record.id === worker.runId);
        const status = this.liveView(worker.runId)?.status ?? run?.record.status;
        if (!run && !status && ["undo", "recover"].includes(request.type)) continue;
        if (
          !run ||
          !status ||
          ["queued", "running", "waiting"].includes(status) ||
          this.liveView(worker.runId)?.stopping ||
          (run.agentAlive && status !== "idle")
        )
          throw new Error("Wait for task workers to finish their turns and stop leftover agents");
      }
      if (this.closing) throw new Error("The app is stopping");
      this.taskOperation = { reviewId: review.id, abort, done };
      this.changed();
    });
    try {
      await this.diffReads.cancel(undefined, `capture:${review.id}`);
      abort.signal.throwIfAborted();
      review = store.get(request.reviewId);
      if (request.type === "prepare") {
        if (review.revisions.at(-1)?.id !== request.revisionId)
          throw new Error("Review the latest changes before applying");
        const sources = review.revisions.at(-1)?.sources;
        if (
          !sources?.length ||
          review.error ||
          !review.workers.every((worker) =>
            sources?.some((source) => source.runId === worker.runId),
          )
        )
          throw new Error("Refresh the incomplete review before applying");
        return view(await loop.prepare(review.id, request.revisionId, sources, abort.signal));
      }
      const proposal = await loop.proposal(review.id, request.operationId);
      if (request.type === "revise") {
        if (
          proposal.status !== "prepared" ||
          !proposal.conflicts.length ||
          review.revisions.at(-1)?.id !== proposal.revisionId
        )
          throw new Error("Refresh the conflict preview before asking for a revision");
        const session = this.conversations.sessions.find(
          (session) => session.chat?.runs()[0]?.id === review.chatId && !session.revoked,
        );
        if (!session) throw new Error("Reconnect this review to a current conversation first");
        for (const source of proposal.sources)
          this.conversations.ownedWorker(source.runId, session);
        const conflicts = proposal.conflicts.map(
          ({ path, reason }) => `${JSON.stringify(path)}: ${reason}`,
        );
        const feedback = `Revise this task so it can be applied to the current project. Preserve the user's current project edits. Read the current project files before revising your worker copies. Conflicting paths and reasons:\n${conflicts.join("\n")}\nProject: ${JSON.stringify(request.project)}\nUse owned workers and return a new review. Do not modify the project directly.`;
        if (feedback.length > 8_000)
          throw new Error("Too many conflicts for one request. Send feedback in smaller groups.");
        await loop.requestRevision(review.id, proposal.id);
        abort.signal.throwIfAborted();
        await prepareUnlessAborted(
          this.chatExclusive(session, () => {
            abort.signal.throwIfAborted();
            return store.requestRevision(review.id, proposal.revisionId, feedback);
          }),
          abort.signal,
        );
        return view(proposal);
      }
      if (request.type === "apply" && proposal.status !== "applied") {
        if (
          review.error ||
          review.revisions.at(-1)?.id !== proposal.revisionId ||
          !review.workers.every((worker) =>
            proposal.sources.some((source) => source.runId === worker.runId),
          )
        )
          throw new Error("New changes are available. Refresh the application preview.");
        for (const source of proposal.sources) {
          const target = await prepareDiff(
            commandDeps(this.deps, this.requireWorkspace()),
            source.runId,
          );
          const current = await git.snapshot(target.worktree, undefined, abort.signal);
          if (current !== source.commit)
            throw new Error("Worker files changed. Refresh changes before applying.");
        }
      }
      if (
        request.type === "undo" &&
        (await loop.lastApplied(review.id))?.id !== proposal.id &&
        proposal.status !== "undone"
      )
        throw new Error("Undo the most recent application first");
      const result = await loop.execute(review.id, proposal.id, request.type, abort.signal);
      this.poller.invalidate(["files", "history", "worktrees"]);
      return view(result);
    } finally {
      this.taskOperation = undefined;
      finish();
      this.changed();
      this.scheduleReviewCapture(review.id);
      if (request.type === "revise") this.scheduleFeedback();
      this.changed();
    }
  }

  reviewAction(value: ReviewAction): Promise<string> {
    const request = parseReviewAction(value);
    return this.projectRequest(request, () => this.projectReviewAction(request));
  }

  private projectReviewAction(request: ReviewAction): Promise<string> {
    return this.exclusive(async () => {
      const store = this.reviewStore(request.project);
      if (request.type === "open-run") {
        const run = this.history.find((run) => run.record.id === request.runId);
        if (!run) throw new Error("Unknown run in this project");
        let review = store
          .list()
          .find((review) => review.workers.some((worker) => worker.runId === request.runId));
        if (!review) {
          review = await store.create(
            this.conversations.current.chat?.runs()[0]?.id ?? null,
            0,
            `${run.record.agent} changes`,
          );
          await store.addWorker(review.id, request.runId, run.record.agent);
        }
        this.scheduleReviewCapture(review.id);
        this.changed();
        return review.id;
      }
      if (request.type === "reconnect" && this.taskOperation)
        throw new Error("Wait for the task operation to finish");
      const review = store.get(request.reviewId);
      const session = this.conversations.sessions.find(
        (session) =>
          session.chat?.runs()[0]?.id ===
          (request.type === "reconnect" ? request.chatId : review.chatId),
      );
      if (["submit", "retry", "reconnect"].includes(request.type)) {
        if (!session) throw new Error("Reconnect this review to a current conversation first");
        this.conversations.assertCurrent(session);
      }
      await store.action(request);
      this.scheduleFeedback();
      this.changed();
      return review.id;
    });
  }

  captureReview(value: ReviewRead): Promise<void> {
    const request = parseReviewRead(value);
    return this.projectRequest(request, () => this.captureProjectReview(request));
  }

  private captureProjectReview(request: ReviewRead): Promise<void> {
    if (this.taskOperation)
      return Promise.reject(new Error("Wait for the task operation to finish"));
    const store = this.reviewStore(request.project);
    return this.diffReads.read(
      { requestId: request.requestId, id: `capture:${request.reviewId}` },
      (signal) =>
        this.exclusive(async () => {
          signal.throwIfAborted();
          if (this.taskOperation) throw new Error("Wait for the task operation to finish");
          if (store !== this.reviewStore(request.project))
            throw new Error("Review context changed");
          const targets = [];
          for (const worker of store.get(request.reviewId).workers) {
            try {
              targets.push({
                runId: worker.runId,
                target: await prepareDiff(
                  commandDeps(this.deps, this.requireWorkspace()),
                  worker.runId,
                ),
              });
            } catch (cause) {
              targets.push({ runId: worker.runId, error: message(cause) });
            }
          }
          return targets;
        }),
      async (targets, signal) => {
        const results = [];
        const loop = this.taskLoop(store);
        const git = loop ? this.deps.git.tasks : undefined;
        const sources: TaskSource[] = [];
        const applied = loop ? (await loop.state(request.reviewId)).appliedSources : [];
        let fileCount = 0;
        let contentBytes = 0;
        for (const target of targets) {
          signal.throwIfAborted();
          try {
            if (!target.target) {
              results.push(target);
              continue;
            }
            if (!this.deps.git.reviewSnapshot) throw new Error("Structured review is unavailable");
            const captured = git
              ? await git.snapshot(target.target.worktree, undefined, signal)
              : undefined;
            const snapshot = await this.deps.git.reviewSnapshot(
              target.target.worktree,
              applied.find((source) => source.runId === target.runId)?.commit ?? target.target.base,
              signal,
              captured,
            );
            if (captured)
              sources.push({ runId: target.runId, base: target.target.base, commit: captured });
            const files = snapshot.files.slice(0, Math.max(0, 2_000 - fileCount)).map((file) => {
              const size = Buffer.byteLength(file.original) + Buffer.byteLength(file.modified);
              if (contentBytes + size > 8_388_608)
                return {
                  ...file,
                  original: "",
                  modified: "",
                  limitation: "Review content limit reached",
                };
              contentBytes += size;
              return file;
            });
            fileCount += files.length;
            results.push({
              runId: target.runId,
              files,
              ...(snapshot.truncated || files.length < snapshot.files.length
                ? { error: "File listing is partial (1,000 per worker; 2,000 per review)" }
                : {}),
            });
          } catch (cause) {
            signal.throwIfAborted();
            results.push({ runId: target.runId, error: message(cause) });
          }
        }
        signal.throwIfAborted();
        if (store !== this.reviewStore(request.project)) throw new Error("Review context changed");
        await store.capture(request.reviewId, results, sources.length ? sources : undefined);
        signal.throwIfAborted();
        this.changed();
      },
      this.projectHost.current.id,
    );
  }

  readReviewFile(value: ReviewFileRead): Promise<ReviewContent> {
    const request = parseReviewFileRead(value);
    return this.projectRequest(request, () => this.readProjectReviewFile(request));
  }

  private readProjectReviewFile(request: ReviewFileRead): Promise<ReviewContent> {
    const store = this.reviewStore(request.project);
    return this.diffReads.read(
      { requestId: request.requestId, id: request.reviewId },
      async () => store,
      async (store, signal) => {
        const content = await store.content(request.reviewId, request.revisionId, request.fileKey);
        signal.throwIfAborted();
        if (store !== this.reviewStore(request.project)) throw new Error("Review context changed");
        return content;
      },
      this.projectHost.current.id,
    );
  }

  async readReview(value: ReviewRead): Promise<Review> {
    const request = parseReviewRead(value);
    return this.projectRequest(request, async () => {
      const review = await this.readProjectReview(request);
      return this.relay
        ? {
            ...review,
            projectId: this.projectHost.current.id,
            databaseEpoch: this.projectHost.current.epoch,
          }
        : review;
    });
  }

  private async readProjectReview(request: ReviewRead): Promise<Review> {
    const store = this.reviewStore(request.project);
    if (!request.revisionId) return structuredClone(store.get(request.reviewId));
    const review = await store.withLineStats(request.reviewId, request.revisionId);
    if (store !== this.reviewStore(request.project)) throw new Error("Review context changed");
    return review;
  }

  private scheduleReviewCapture(id: string): void {
    const store = this.reviews;
    if (!store || this.closing) return;
    if (this.taskOperation) {
      void this.taskOperation.done.then(() => {
        if (this.reviews === store) this.scheduleReviewCapture(id);
      });
      return;
    }
    if (this.reviewCaptures.has(id)) {
      this.reviewCaptures.set(id, true);
      return;
    }
    this.reviewCaptures.set(id, false);
    void this.captureReview({
      project: store.project,
      projectId: this.projectHost.current.id,
      databaseEpoch: this.projectHost.current.epoch,
      reviewId: id,
      requestId: randomUUID(),
    })
      .catch(async (cause) => {
        if (this.reviews === store && !this.closing && !this.taskOperation)
          await store.fail(id, cause);
      })
      .catch((cause) => {
        this.warnings.push(`Could not save review: ${message(cause)}`);
      })
      .finally(() => {
        const changedDuringRead = this.reviewCaptures.get(id);
        this.reviewCaptures.delete(id);
        if (changedDuringRead && this.reviews === store && !this.closing)
          this.scheduleReviewCapture(id);
        this.changed();
      });
  }

  private scheduleFeedback(): void {
    if (this.closing) return;
    if (this.feedbackScheduled) {
      this.feedbackChanged = true;
      return;
    }
    this.feedbackScheduled = true;
    void this.exclusive(async () => {
      const store = this.reviews;
      if (!store) return;
      for (const review of store.list()) {
        const batch = review.submissions.find((batch) => batch.state === "pending");
        if (!batch) continue;
        const session = this.conversations.sessions.find(
          (session) => !session.revoked && session.chat?.runs()[0]?.id === review.chatId,
        );
        const run = session?.chat?.runs()[0];
        if (
          session &&
          run &&
          (run.status === "running" ||
            run.status === "waiting" ||
            run.status === "queued" ||
            run.stopping ||
            run.modeChanging ||
            session.updatesPaused)
        )
          continue;
        let delivered = false;
        try {
          if (!session || !run || run.status !== "idle")
            throw new Error("Reconnect or restart the conversation, then retry feedback");
          const text = await store.feedback(review.id, batch.id);
          await store.mutate(review.id, (current) => {
            const item = current.submissions.find((item) => item.id === batch.id);
            if (item) item.state = "delivering";
          });
          await this.sendTask(
            session,
            text,
            undefined,
            session.tasks.find((task) => task.reviewId === review.id)?.id ?? null,
          );
          delivered = true;
          session.reviewTask = { title: review.title, turn: review.turn, reviewId: review.id };
          await store.mutate(review.id, (current) => {
            const item = current.submissions.find((item) => item.id === batch.id);
            if (item) {
              item.state = "delivered";
              item.deliveredTurn = session.chat?.runs()[0]?.turns ?? 1;
              item.deliveredChatId = run.id;
            }
            for (const comment of current.comments)
              if (batch.commentIds.includes(comment.id)) comment.state = "sent";
          });
        } catch (cause) {
          await store.mutate(review.id, (current) => {
            const item = current.submissions.find((item) => item.id === batch.id);
            if (item) {
              item.error =
                `${delivered ? "Feedback was delivered but its receipt could not be saved. Check the conversation before retrying. " : ""}${message(cause)}`.slice(
                  0,
                  2_000,
                );
              item.state = "failed";
            }
          });
        }
      }
      this.changed();
    })
      .catch((cause) => {
        this.warnings.push(`Could not deliver review feedback: ${message(cause)}`);
        this.changed();
      })
      .finally(() => {
        this.feedbackScheduled = false;
        // A storage failure may leave a batch pending. Do not spin or automatically
        // retry a potentially delivered prompt; a fresh user action/idle event schedules work.
        if (this.feedbackChanged) {
          this.feedbackChanged = false;
          this.scheduleFeedback();
        }
      });
  }

  constructor(
    private readonly deps: CoreDeps,
    private readonly env: Readonly<Record<string, string | undefined>>,
    private readonly dialogs: DesktopDialogs,
    private readonly storage: DesktopStorage,
  ) {
    this.relay = storage.relay
      ? new RelayService(deps, env, () => this.changed(null), dialogs)
      : undefined;
    this.agentSetup = new AgentSetup({
      command: (id) => this.config?.agents[id]?.command,
      detect: async (id, command, signal) => {
        if (this.storage.refreshPath) await this.storage.refreshPath(signal);
        else if (!this.storage.detectAgent)
          setEnvironmentPath(
            this.env as NodeJS.ProcessEnv,
            await desktopPath({ env: this.env, signal }),
          );
        signal.throwIfAborted();
        await (this.storage.detectAgent ?? detectProvider)(id, command, this.env);
        signal.throwIfAborted();
      },
      probe: (id, command, signal) =>
        probeAgent(
          this.deps.agents,
          {
            name: id,
            command,
            env: Object.fromEntries(
              Object.entries(this.env).filter(
                (entry): entry is [string, string] => entry[1] !== undefined,
              ),
            ),
          },
          signal,
        ),
      save: async (record) => {
        if (!this.storage.preferences.setAgentSetup) throw new Error("Agent setup cannot be saved");
        await this.storage.preferences.setAgentSetup(record);
      },
      changed: () => this.changed(),
      canChangePrimary: () => !this.hasActiveWork,
    });
    this.poller = new ScopedPoller(
      (key) => this.pollOwner(key),
      (scope) => this.changed(scope?.kind === "target" ? scope.id : null),
    );
  }

  private pollOwner(key: PollKey): PollOwner {
    if (key === "config") {
      return {
        scope: { kind: "application", id: "configuration" },
        keys: ["config"],
        alive: () => true,
        active: () => this.hasActiveWork,
        visible: () => true,
        available: () => true,
        read: (source, current) =>
          this.projectHost.run(this.projectHost.fallback, () => this.readSource(source, current)),
      };
    }
    if (key === "configurations") {
      const database = this.database;
      const epoch = this.projectHost.databaseEpoch;
      return {
        scope: { kind: "database", id: String(epoch) },
        keys: ["configurations"],
        alive: () => database === this.database && epoch === this.projectHost.databaseEpoch,
        active: () => this.hasActiveWork,
        visible: () => true,
        available: () => database !== undefined,
        read: (source, current) =>
          this.projectHost.run(this.projectHost.fallback, () => this.readSource(source, current)),
      };
    }
    const owner = this.projectHost.current;
    return {
      scope: { kind: "target", id: owner.id },
      keys: ["history", "worktrees", "files"],
      alive: () => !owner.closed && owner.epoch === this.projectHost.databaseEpoch,
      active: () => [...owner.state.batches.values()].some((batch) => batch.active),
      visible: () => owner === this.projectHost.selected,
      available: (source) =>
        source === "files" ? owner.state.fileContext !== null : owner.state.workspace !== undefined,
      read: (source, current) =>
        this.projectHost.run(owner, () => this.readSource(source, current)),
    };
  }

  private async readSource(key: PollKey, current: () => boolean): Promise<void> {
    if (key === "files") {
      const context = this.fileContext;
      if (!context) return;
      await this.validateFileRoot(context);
      const files = await readFiles(context, () => current() && this.fileContext === context);
      if (current() && this.fileContext === context) this.files = files;
      return;
    }
    if (key === "worktrees") {
      const workspace = this.requireWorkspace();
      const owner = this.projectHost.current;
      const visible = () =>
        current() &&
        owner === this.projectHost.selected &&
        this.visibility.visible &&
        this.visibility.worktrees;
      const worktrees = await readWorktrees(this.deps, workspace, {
        sizes: visible(),
        current: visible,
      });
      if (current() && this.workspace === workspace) {
        this.worktrees = {
          repository: workspace.repo ? basename(workspace.repo.topLevel) : null,
          worktrees,
        };
      }
      return;
    }
    if (key === "history") {
      const workspace = this.requireWorkspace();
      const history = await listRuns(commandDeps(this.deps, workspace));
      if (current() && this.workspace === workspace) {
        this.history = history;
        for (const [batch, state] of this.batches) if (!state.active) this.batches.delete(batch);
      }
      return;
    }
    await this.exclusive(async () => {
      if (!current()) return;
      if (key === "config") {
        const config = desktopConfig(await loadConfig(this.deps.fs, this.env));
        if (current()) {
          const provider = this.orchestration.provider;
          if (
            provider &&
            JSON.stringify(this.config?.agents[provider]) !==
              JSON.stringify(config.agents[provider])
          ) {
            await this.cancelOrchestrationTest();
            await this.stopMemoryExtraction();
            await this.stopSearchSummary();
            this.orchestration = { ...this.orchestration, connection: "idle", error: null };
          }
          await this.setConfig(config);
          await this.syncOrchestrationChat();
        }
      } else {
        const database = this.requireDatabase();
        this.configurations = database.configurations();
        this.savedPrompts = this.readPrompts(database);
        this.commands = database.commands();
      }
    });
  }

  private async validateFileRoot(context: FileContext): Promise<void> {
    const workspace = this.requireWorkspace();
    if (!(await samePath(context.project, workspace.dir)))
      throw new Error("The open project has changed.");
    if (await samePath(context.root, workspace.dir)) return;
    for (const worktree of this.worktrees?.worktrees ?? []) {
      if (await samePath(worktree.path, context.root)) return;
    }
    throw new Error("This file root is not in the open project.");
  }

  async setFileContext(value: FileContext | null): Promise<void> {
    const context = parseFileContext(value);
    const owner = context?.projectId
      ? this.projectHost.byId(context.projectId)
      : this.projectHost.current;
    if (this.relay && context && context.projectId === undefined)
      throw new Error("File context requires the project instance and database epoch");
    if (context?.databaseEpoch !== undefined && context.databaseEpoch !== owner.epoch)
      throw new Error("The file context database changed");
    return this.projectHost.run(owner, async () => {
      this.projectHost.assertCurrent(owner);
      if (this.relay && context === null && this.workspace)
        throw new Error("Deactivate a file context using its project identity");
      if (this.relay && context?.active !== false && owner !== this.projectHost.selected)
        throw new Error("This project file view is inactive");
      const workspace = this.workspace;
      if (context) await this.validateFileRoot(context);
      this.projectHost.assertCurrent(owner);
      if (this.workspace !== workspace) throw new Error("The open project has changed.");
      if (this.relay && context?.active !== false && owner !== this.projectHost.selected)
        throw new Error("This project file view is inactive");
      const active = context?.active === false ? null : context;
      if (JSON.stringify(active) === JSON.stringify(this.fileContext)) return;
      this.fileContext = active;
      if (
        !active ||
        this.files?.context.root !== active.root ||
        this.files.context.project !== active.project
      )
        this.files = null;
      this.poller.invalidate(["files"]);
      this.changed();
      if (active) await this.poller.poll("files", "change");
    });
  }

  async poll(keys: PollKey[], identity?: ProjectRequestIdentity): Promise<void> {
    keys = parsePollKeys(keys);
    if (identity) {
      if (keys.some((key) => key !== "config")) this.assertDatabaseRequest(identity.databaseEpoch);
      if (keys.some((key) => key === "history" || key === "worktrees" || key === "files")) {
        if (this.relay && !identity.projectId)
          throw new Error("This poll needs the current project identity");
        const owner = identity.projectId
          ? this.projectHost.byId(identity.projectId)
          : this.projectHost.current;
        this.projectHost.assertCurrent(owner);
        if (identity.databaseEpoch !== undefined && identity.databaseEpoch !== owner.epoch)
          throw new Error("The polling database changed");
        return this.projectHost.run(owner, () => this.poll(keys));
      }
    }
    const results = await Promise.allSettled(keys.map((key) => this.poller.poll(key)));
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }

  setPollSettings(patch: PollSettingsPatch): Promise<void> {
    patch = parsePollSettings(patch);
    return this.exclusive(async () => {
      // Persist only explicit overrides so built-in defaults can change later.
      const overrides = { ...this.pollOverrides };
      for (const [key, setting] of Object.entries(patch)) {
        if (setting === null) delete overrides[key as PollKey];
        else overrides[key as PollKey] = setting;
      }
      await this.storage.preferences.setPolling?.(overrides);
      this.pollOverrides = overrides;
      this.poller.configure(patch);
      this.relayFiles.configure(patch);
    });
  }

  setPollingPaused(paused: boolean): void {
    if (typeof paused !== "boolean") throw new Error("Expected a boolean");
    this.poller.pause(paused);
    this.relayFiles.pause(paused);
  }

  setVisibility(visibility: PollVisibility): void {
    visibility = parsePollVisibility(visibility);
    this.visibility = visibility;
    this.poller.context(this.active, visibility);
    this.relayFiles.visibility(visibility);
  }

  private async setConfig(config: Awaited<ReturnType<typeof loadConfig>>): Promise<void> {
    if (JSON.stringify(this.config?.agents) !== JSON.stringify(config.agents))
      await this.agentSetup.cancel();
    const changed = JSON.stringify(this.config) !== JSON.stringify(config);
    this.config = config;
    if (changed) this.changed();
  }

  private requireEnabled(provider: string): void {
    if (!this.agentSetup.complete) throw new Error("Complete agent setup first");
    if (!this.agentSetup.enabled.includes(provider))
      throw new Error(`Agent '${provider}' is not enabled. Connect it in Settings.`);
  }

  private async enabledConfig() {
    const config = desktopConfig(await loadConfig(this.deps.fs, this.env));
    await this.setConfig(config);
    if (!this.agentSetup.complete) throw new Error("Complete agent setup first");
    return {
      ...config,
      defaultAgent: this.agentSetup.record?.primary ?? config.defaultAgent,
      agents: Object.fromEntries(
        Object.entries(config.agents).filter(([id]) => this.agentSetup.enabled.includes(id)),
      ),
    };
  }

  beginAgentSetup(request: SetupBegin): Promise<void> {
    return this.exclusive(async () => {
      await this.cancelOrchestrationTest();
      await this.setConfig(desktopConfig(await loadConfig(this.deps.fs, this.env)));
      this.agentSetup.begin(request);
    });
  }
  async attemptAgentSetup(request: SetupAttempt): Promise<void> {
    const { done } = await this.exclusive(async () => {
      await this.setConfig(desktopConfig(await loadConfig(this.deps.fs, this.env)));
      return { done: this.agentSetup.attempt(request) };
    });
    await done;
  }
  cancelAgentSetup(request?: SetupIdentity): Promise<void> {
    return this.agentSetup.cancel(request);
  }
  abandonAgentSetup(request: SetupIdentity): Promise<void> {
    return this.exclusive(() => this.agentSetup.abandon(request));
  }
  finishAgentSetup(request: SetupIdentity): Promise<void> {
    return this.exclusive(async () => {
      await this.setConfig(desktopConfig(await loadConfig(this.deps.fs, this.env)));
      const mode = this.agentSetup.snapshot().session?.mode;
      const record = await this.agentSetup.finish(request);
      if (mode === "primary") {
        await this.stopMemoryExtraction();
        await this.stopSearchSummary();
        this.chatKey = "";
      }
      this.orchestration = {
        provider: record.primary,
        allowAll: true,
        connection: "idle",
        error: null,
      };
      await this.syncOrchestrationChat();
      this.changed();
    });
  }

  setOrchestrationProvider(value: string | null): Promise<void> {
    const provider = parseOrchestrationProvider(value);
    if (!provider || provider !== this.agentSetup.record?.primary)
      return Promise.reject(new Error("Use agent setup to change the primary"));
    this.requireEnabled(provider);
    return this.exclusive(async () => {
      if (provider !== null && !Object.hasOwn(this.config?.agents ?? {}, provider))
        throw new Error(`Unavailable provider: ${provider}`);
      await this.cancelOrchestrationTest();
      await this.stopMemoryExtraction();
      await this.stopSearchSummary();
      if (!this.storage.preferences.setOrchestrationProvider)
        throw new Error("Orchestration settings cannot be saved");
      await this.storage.preferences.setOrchestrationProvider(provider);
      this.orchestration = { provider, allowAll: true, connection: "idle", error: null };
      await this.syncOrchestrationChat();
      this.changed();
    });
  }

  async testOrchestrationProvider(): Promise<void> {
    const { done } = await this.exclusive(async () => {
      if (this.agentSetup.snapshot().session) throw new Error("Finish or cancel agent setup first");
      if (this.connectionTest) return { done: this.connectionTest.done };
      const provider = this.orchestration.provider;
      const agent = provider === null ? undefined : this.config?.agents[provider];
      if (!provider || !agent || !Object.hasOwn(this.config?.agents ?? {}, provider))
        throw new Error("Select an available orchestration provider");
      this.requireEnabled(provider);
      const abort = new AbortController();
      this.orchestration = { ...this.orchestration, connection: "testing", error: null };
      this.changed();
      const done = probeAgent(
        this.deps.agents,
        {
          name: provider,
          command: agent.command,
        },
        abort.signal,
      )
        .then(
          () => {
            this.orchestration = { ...this.orchestration, connection: "connected", error: null };
          },
          (error: unknown) => {
            this.orchestration = {
              ...this.orchestration,
              connection: abort.signal.aborted ? "idle" : "failed",
              error: abort.signal.aborted ? null : message(error),
            };
          },
        )
        .finally(() => {
          this.connectionTest = undefined;
          this.changed();
        });
      this.connectionTest = { abort, done };
      return { done };
    });
    await done;
  }

  async cancelOrchestrationTest(): Promise<void> {
    const test = this.connectionTest;
    test?.abort.abort();
    await test?.done;
  }

  async summarizeSearch(value: SearchSummaryRequest): Promise<SearchSummaryResult> {
    const request = parseSearchSummary(value);
    this.requireEnabled(this.orchestration.provider ?? "");
    const { done } = await this.exclusive(async () => {
      if (this.closing) throw new Error("The app is stopping");
      const workspace = this.requireWorkspace();
      if (workspace.dir !== request.directory)
        throw new Error("The project changed. Search again.");
      const provider = this.orchestration.provider;
      const agent =
        provider && this.config && Object.hasOwn(this.config.agents, provider)
          ? this.config.agents[provider]
          : undefined;
      if (!provider || !agent)
        throw new Error("Select an available orchestration provider in Settings");
      const known = new Set(this.history.map((run) => run.record.id));
      for (const source of request.sources) {
        const valid =
          source.kind === "project"
            ? source.id === workspace.dir &&
              source.runId === undefined &&
              source.eventIndex === undefined
            : source.runId !== undefined &&
              known.has(source.runId) &&
              (source.kind === "run"
                ? source.id === source.runId && source.eventIndex === undefined
                : source.eventIndex !== undefined &&
                  source.id === `${source.runId}:${source.eventIndex}`);
        if (!valid) throw new Error("A search source is no longer in the open project");
      }
      await this.stopSearchSummary();
      if (this.closing) throw new Error("The app is stopping");
      const abort = new AbortController();
      const operation = async (): Promise<SearchSummaryResult> => {
        const temporary = await mkdtemp(join(tmpdir(), "code60-search-"));
        try {
          const cwd = join(temporary, "private");
          await privateDirectory(cwd);
          abort.signal.throwIfAborted();
          const files =
            request.includeFiles === false
              ? []
              : await projectSearchEvidence(workspace.dir, request.query, abort.signal);
          const sources = [...request.sources.slice(0, files.length ? 10 : 20), ...files];
          const text = await summarizeSearch(
            this.deps.agents,
            { name: provider, command: agent.command, cwd },
            request.query,
            sources,
            abort.signal,
          );
          abort.signal.throwIfAborted();
          if (this.workspace !== workspace) throw new Error("The project changed. Search again.");
          return { requestId: request.requestId, text, sources };
        } finally {
          await rm(temporary, { recursive: true, force: true });
        }
      };
      const done = operation()
        .catch((error: unknown) => {
          if (abort.signal.aborted) throw new Error("Overview cancelled");
          throw error;
        })
        .finally(() => {
          this.searchSummary = undefined;
        });
      void done.catch(() => {});
      this.searchSummary = { requestId: request.requestId, abort, done };
      return { done };
    });
    return done;
  }

  cancelSearchSummary(requestId?: string): Promise<void> {
    const id = requestId === undefined ? undefined : parseSearchSummaryRequestId(requestId);
    return this.exclusive(() => this.stopSearchSummary(id));
  }

  private async stopSearchSummary(requestId?: string): Promise<void> {
    const task = this.searchSummary;
    if (!task || (requestId !== undefined && task.requestId !== requestId)) return;
    task.abort.abort();
    await task.done.catch(() => {});
  }

  async extractMemory(value: MemoryExtractionRequest): Promise<MemoryExtractionResult> {
    const request = parseMemoryExtraction(value);
    this.requireEnabled(this.orchestration.provider ?? "");
    const { done } = await this.exclusive(async () => {
      if (this.memoryExtraction) throw new Error("An extraction is already running");
      const workspace = this.requireWorkspace();
      if (workspace.dir !== request.directory)
        throw new Error("The project changed. Run extraction again.");
      const provider = this.orchestration.provider;
      const agent =
        provider && Object.hasOwn(this.config?.agents ?? {}, provider)
          ? this.config?.agents[provider]
          : undefined;
      if (!provider || !agent)
        throw new Error("Select an available orchestration provider in Settings");
      const known = new Set(this.history.map((run) => run.record.id));
      if (request.runs.some((run) => !known.has(run.id)))
        throw new Error("A session is no longer in the open project");
      const abort = new AbortController();
      const live = [...this.events];
      const operation = async (): Promise<MemoryExtractionResult> => {
        const events: RunEvent[] = [];
        for (const run of request.runs) {
          abort.signal.throwIfAborted();
          const saved = await this.mergedEvents(workspace, run.id, live);
          if (saved.length < run.count)
            throw new Error("Events changed or are unavailable. Reload the page and try again.");
          events.push(...saved.slice(0, run.count));
        }
        abort.signal.throwIfAborted();
        const temporary = await mkdtemp(join(tmpdir(), "code60-memory-"));
        const cwd = join(temporary, "private");
        await privateDirectory(cwd);
        try {
          const statements = await extractEpisodicMemory(
            this.deps.agents,
            {
              name: provider,
              command: agent.command,
              cwd,
            },
            events,
            request.prompt,
            abort.signal,
          );
          if (this.workspace !== workspace)
            throw new Error("The project changed during extraction");
          return { statements, eventCount: events.length };
        } finally {
          await rm(temporary, { recursive: true, force: true });
        }
      };
      const done = operation()
        .catch((error: unknown) => {
          if (abort.signal.aborted) throw new Error("Extraction cancelled");
          throw error;
        })
        .finally(() => {
          this.memoryExtraction = undefined;
        });
      // The IPC caller receives the rejection; also handle it while the exclusive queue yields.
      void done.catch(() => {});
      this.memoryExtraction = { requestId: request.requestId, abort, done };
      return { done };
    });
    return done;
  }

  cancelMemoryExtraction(requestId: string): Promise<void> {
    const id = parseMemoryRequestId(requestId);
    return this.exclusive(() => this.stopMemoryExtraction(id));
  }

  private async stopMemoryExtraction(requestId?: string): Promise<void> {
    const task = this.memoryExtraction;
    if (!task || (requestId !== undefined && task.requestId !== requestId)) return;
    task.abort.abort();
    await task.done.catch(() => {});
  }

  private async mcpAgentServer(session: ChatSession): Promise<AgentMcpServer[]> {
    if (!session.mcpGateway) {
      const owner = this.projectHost.current;
      session.mcpGateway = await createMcpGateway((name, args) =>
        this.projectHost.run(owner, async () => {
          this.projectHost.assertCurrent(owner);
          if (this.closing) throw new Error("Code60 is shutting down");
          if (session.revoked) throw new Error("This orchestration chat is no longer current");
          const result = await this.callChatTool(name, args, session);
          this.projectHost.assertCurrent(owner);
          return result;
        }),
      );
    }
    return [
      {
        name: "code60",
        command: process.execPath,
        args: [fileURLToPath(new URL("./mcp-server.js", import.meta.url))],
        env: [
          { name: "ELECTRON_RUN_AS_NODE", value: "1" },
          { name: "CODE60_MCP_GATEWAY_URL", value: session.mcpGateway.url },
          { name: "CODE60_MCP_GATEWAY_TOKEN", value: session.mcpGateway.token },
        ],
      },
    ];
  }

  private async callChatTool(name: string, args: unknown, session: ChatSession): Promise<unknown> {
    this.conversations.assertCurrent(session);
    if (isActivityTool(name)) {
      const run = session.chat?.runs()[0];
      if (!run || run.stopping || !["running", "waiting"].includes(run.status))
        session.activity.invalidate();
      if (name === "code60_get_activity_context") {
        parseActivityContextArgs(args);
        return session.activity.context();
      }
      return session.activity.report(args);
    }
    const done =
      name === "code60_dispatch_agent"
        ? session.activity.beginOperation("dispatching")
        : name === "code60_send_agent"
          ? session.activity.beginOperation("sending")
          : () => {};
    try {
      return await (isMcpControlTool(name)
        ? this.controlTool(name, args, session)
        : readMcpTool(name, args, (table) => this.readMcpTable(table)));
    } finally {
      done();
    }
  }

  private async closeMcpGateway(session: ChatSession): Promise<void> {
    session.activity.invalidate();
    const gateway = session.mcpGateway;
    await gateway?.close();
    if (session.mcpGateway === gateway) session.mcpGateway = undefined;
  }

  private async readMcpTable(table: McpTable): Promise<readonly McpTableRow[]> {
    const snapshot = this.currentSnapshot(false);
    if (table === "sessions" || table === "messages" || table === "events") {
      const workspace = this.workspace;
      if (!workspace) return [];
      const runs = snapshot.runs.filter((run) => !run.relay);
      const events: [string, RunEvent[]][] = [];
      const live = [...this.events];
      // Limit filesystem concurrency just as the UI transcript reader does.
      for (let offset = 0; offset < runs.length; offset += 4) {
        events.push(
          ...(await Promise.all(
            runs
              .slice(offset, offset + 4)
              .map(
                async (run): Promise<[string, RunEvent[]]> => [
                  run.record.id,
                  await this.mergedEvents(workspace, run.record.id, live),
                ],
              ),
          )),
        );
      }
      if (this.workspace !== workspace)
        throw new Error("Code60 project changed; retry the table read");
      const eventsByRun = new Map(events);
      if (table === "events") {
        return runs.flatMap(({ record }) =>
          (eventsByRun.get(record.id) ?? []).map((event, index) => {
            const { runId: _, at, type, ...details } = event;
            return {
              id: `${record.id}:${index}`,
              at,
              agent: record.agent,
              session: record.id,
              type,
              status:
                event.type === "status" || event.type === "toolCall"
                  ? event.status
                  : event.type === "permission"
                    ? event.decision
                    : event.type === "turnEnd"
                      ? event.stopReason
                      : "",
              update: event.type === "acp" ? event.update : "",
              kind: "kind" in event ? event.kind : "",
              toolCallId: "toolCallId" in event ? event.toolCallId : "",
              // Raw ACP updates keep their own JSON text; MCP clips long text with a marker.
              details:
                event.type === "acp"
                  ? `${event.payload}${event.truncated ? `… [truncated; ${event.size} bytes in full]` : ""}`
                  : JSON.stringify(details),
              ...(event.type === "acp" ? { size: event.size } : {}),
            };
          }),
        );
      }
      if (table === "messages") {
        const rows: McpTableRow[] = [];
        for (const run of runs) {
          let open: McpTableRow | undefined;
          for (const [index, event] of (eventsByRun.get(run.record.id) ?? []).entries()) {
            if (event.type === "message" || event.type === "thought") {
              const kind = event.type === "message" ? "Message" : "Thought";
              if (open?.kind === kind) {
                open.text = `${String(open.text)}${event.text}`;
              } else {
                open = {
                  id: `${run.record.id}:${index}`,
                  at: event.at,
                  agent: run.record.agent,
                  session: run.record.id.slice(-6),
                  kind,
                  text: event.text,
                };
                rows.push(open);
              }
              continue;
            }
            open = undefined;
            if (event.type === "prompt") {
              rows.push({
                id: `${run.record.id}:${index}`,
                at: event.at,
                agent: run.record.agent,
                session: run.record.id.slice(-6),
                kind: "Prompt",
                text: event.text,
              });
            }
          }
        }
        return rows.toSorted((a, b) => String(b.at).localeCompare(String(a.at)));
      }
      return runs.map((run) => {
        const view = run.view;
        return {
          agent: run.record.agent,
          status: view?.status ?? run.record.status,
          turns: view?.turns ?? run.record.turns,
          approvals: view?.pending.length ?? 0,
          id: run.record.id,
          shortId: run.record.id.slice(-6),
          pid: run.record.agentPid ?? null,
          branch: run.record.branch ?? "none",
          startedAt: run.record.startedAt,
          discarded: run.record.discardedAt !== undefined,
          ...mcpSessionMetrics(
            eventsByRun.get(run.record.id) ?? [],
            this.deps.clock.now().getTime(),
          ),
        };
      });
    }
    if (table === "configurations") {
      return this.configurations
        .map((entry) => ({
          name: entry.name,
          provider: [...new Set(entry.settings.agents)].join(", "),
          agents:
            entry.settings.agents.length === 1
              ? Number(entry.settings.parallel ?? 1)
              : entry.settings.agents.length,
          uses: entry.uses,
          lastUsed: entry.lastUsed ?? "Never",
        }))
        .toSorted((a, b) => a.name.localeCompare(b.name));
    }
    if (table === "worktrees") {
      const listing = this.worktrees;
      if (this.workspace && !listing)
        throw new Error(
          "Worktrees have not been loaded. Refresh the Worktrees table in Code60 first.",
        );
      if (!listing?.repository) return [];
      return listing.worktrees.map((worktree) => ({
        path: worktree.path,
        branch: worktree.branch ?? "Detached HEAD",
        createdAt: worktree.createdAt ?? "Unknown",
        repository: listing.repository ?? "",
        sizeBytes: worktree.sizeBytes,
      }));
    }
    return this.poller.snapshot().sources.flatMap((source) => {
      const settings = `${timeSetting(source.setting.intervalMs)} and ${timeSetting(source.setting.idleIntervalMs)}`;
      const latest = source.history.at(-1);
      const sourceRow: McpTableRow = {
        rowType: "source",
        source: pollSourceLabels[source.key],
        status: source.status.charAt(0).toUpperCase() + source.status.slice(1),
        effectiveInterval: timeSetting(source.effectiveIntervalMs),
        settings,
        lastAttempt: source.polledAt ?? "Never",
        lastSuccess: source.succeededAt ?? "Never",
        nextPoll: source.nextAt ?? "Not scheduled",
        failures: source.failures,
        lastResult: latest
          ? `${latest.ok ? "Success" : "Failed"}, ${latest.trigger}, ${latest.durationMs} ms`
          : "None yet",
        recentDurationMs: latest?.durationMs ?? null,
      };
      const resultRows = source.history.toReversed().map(
        (result): McpTableRow => ({
          rowType: "result",
          source: pollSourceLabels[source.key],
          status: result.ok ? "Success" : "Failed",
          trigger: result.trigger,
          at: result.at,
          durationMs: result.durationMs,
          error: result.error ?? "",
        }),
      );
      return [sourceRow, ...resultRows];
    });
  }

  /** Recorded events plus live events not yet written to the event log. */
  private async mergedEvents(
    workspace: Workspace,
    runId: string,
    live: readonly SequencedEvent[] = this.events,
  ): Promise<RunEvent[]> {
    const disk = await workspace.store.readEvents(runId);
    const counts = new Map<string, number>();
    for (const event of disk) {
      const key = JSON.stringify(event);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const entry of live) {
      if (entry.event.runId !== runId) continue;
      const key = JSON.stringify(entry.event);
      const count = counts.get(key) ?? 0;
      if (count > 0) counts.set(key, count - 1);
      else disk.push(entry.event);
    }
    return disk;
  }

  /** Provider/database changes replace all chats; switching projects leaves them alive. */
  private async syncOrchestrationChat(restart = false): Promise<void> {
    await this.relay?.sync(
      this.agentSetup.complete ? (this.orchestration.provider ?? undefined) : undefined,
      this.config
        ? {
            ...this.config,
            agents: Object.fromEntries(
              Object.entries(this.config.agents).filter(([id]) =>
                this.agentSetup.enabled.includes(id),
              ),
            ),
          }
        : undefined,
    );
    const current = this.projectHost.current;
    for (const owner of this.relay ? this.projectHost.all() : [current])
      await this.projectHost.run(owner, () => this.syncProjectChat(restart && owner === current));
  }

  private async syncProjectChat(restart: boolean): Promise<void> {
    if (this.relay && !this.workspace) return;
    const provider = this.orchestration.provider;
    const agent = provider ? this.config?.agents[provider] : undefined;
    const key = JSON.stringify([
      this.database?.path,
      provider,
      agent?.command,
      this.agentSetup.complete,
    ]);
    if (!restart && key === this.chatKey) return;
    const root = this.database
      ? this.relay && this.workspace
        ? join(
            dirname(this.database.path),
            ".code60_workspace",
            "projects",
            createHash("sha256")
              .update(JSON.stringify([this.database.path, this.workspace.dir]))
              .digest("hex"),
          )
        : join(dirname(this.database.path), ".code60_workspace")
      : undefined;
    if (this.chatStore?.root !== root) this.chatRegistryLoaded = false;
    const loadSaved = !restart && !!root && !this.chatRegistryLoaded;
    if (restart) {
      const previous = this.conversations.current;
      await this.disposeChat(previous);
      const replacement = this.conversations.replace(previous);
      replacement.tactic = previous.tactic;
    } else {
      await Promise.all(this.conversations.sessions.map((session) => this.disposeChat(session)));
      this.conversations.replace();
    }
    this.chatKey = key;
    this.chatStore = root ? new ChatStore(root) : undefined;
    if (loadSaved && this.chatStore && provider && this.agentSetup.complete) {
      const { chats, errors } = await this.chatStore.load().catch(() => ({
        chats: [],
        errors: [
          "Saved chats could not be opened safely. Their files were preserved; repair the private chat storage or start a new chat.",
        ],
      }));
      this.chatRegistryLoaded = true;
      this.warnings.push(...errors);
      if (chats.length) {
        this.conversations.sessions = [];
        for (const saved of chats) {
          const session = this.conversations.create();
          session.saved = saved;
          session.title = saved.title;
          session.archived = saved.archived;
          session.tactic = saved.tactic;
          session.tasks = saved.tasks;
          session.taskId = saved.taskId;
          session.selectedAt = saved.selectedAt;
          session.restored = true;
          session.updatesPaused = true;
          try {
            session.chatDirectory = await this.chatStore.directory(saved.directoryId);
            const { record } = await this.chatHistory(saved, false);
            session.historyRun = {
              id: record.id,
              agent: record.agent,
              status: record.status,
              turns: record.turns,
              branch: record.branch,
              worktree: record.worktree,
              pending: [],
              modeChanging: false,
              stopping: false,
              ...(record.reason === undefined ? {} : { reason: record.reason }),
              ...(record.sessionState ? { sessionState: record.sessionState } : {}),
            };
          } catch {
            session.historyRun = {
              id: saved.runId,
              agent: saved.provider,
              status: "interrupted",
              turns: 0,
              branch: null,
              worktree: session.chatDirectory ?? "",
              pending: [],
              modeChanging: false,
              stopping: false,
            };
            session.chatError =
              "Saved chat history is missing or unsafe. Its files were preserved. Start a new chat, or repair the saved files before continuing.";
          }
        }
        const available = this.conversations.sessions
          .filter((session) => !session.archived)
          .sort((a, b) => b.selectedAt - a.selectedAt);
        const selected = available[0];
        if (selected) {
          this.conversations.current = selected;
          if (!this.relay)
            await this.loadChatHistory(selected).catch(() => {
              selected.chatError =
                "Saved chat history or plans could not be read safely. Files were preserved; repair them or start a new chat.";
            });
          this.changed();
          return;
        }
        this.conversations.create();
      } else if (errors.length) {
        this.conversations.current.chatError = errors[0] ?? "Saved chats are unavailable.";
        this.changed();
        return;
      }
    }
    // Project chats start only on explicit creation or restart under Relay.
    if (!this.relay || (restart && this.workspace))
      await this.startChat(this.conversations.current);
  }

  private async disposeChat(session: ChatSession): Promise<void> {
    // Revoke capabilities before awaiting any background process cleanup.
    this.conversations.revoke(session);
    session.titleTask?.abort.abort();
    await session.titleTask?.done;
    await this.closeMcpGateway(session);
    await session.chat?.shutdown(this.forceClosing);
    for (const dispose of session.chatDisposers) dispose();
    session.chatDisposers = [];
  }

  private async startChat(session: ChatSession): Promise<void> {
    const launchEpoch = this.projectState.launchEpoch;
    const provider = this.orchestration.provider;
    const config = this.config;
    if (
      !this.database ||
      !provider ||
      !config ||
      !this.agentSetup.complete ||
      !this.agentSetup.enabled.includes(provider)
    ) {
      this.changed();
      return;
    }
    if (!Object.hasOwn(config.agents, provider)) {
      session.chatError = `Unavailable orchestration provider: ${provider}`;
      this.changed();
      return;
    }
    // Paths are generated by the main process, never accepted from the renderer or agent.
    const directory = join(
      this.chatStore?.root ?? join(dirname(this.database.path), ".code60_workspace"),
      randomUUID(),
    );
    session.chatDirectory = directory;
    try {
      const mcpServers = await this.mcpAgentServer(session);
      const chat = await prepareOrchestrationChat(this.deps, directory, provider, config, {
        mcpServers,
        promptContext: () =>
          assembleOperatingContract(
            effectivePrompts(this.config?.prompts ?? DEFAULT_PROMPT_TEMPLATES, this.savedPrompts)
              .operatingContract,
          ),
      });
      this.attachChat(session, chat);
      if (this.closing || launchEpoch !== this.projectState.launchEpoch) {
        await chat.shutdown(this.forceClosing);
        await this.closeMcpGateway(session);
        return;
      }
      session.selectedAt = Date.now();
      await this.saveChat(session);
      chat.start();
    } catch (error) {
      await session.chat?.shutdown();
      await this.closeMcpGateway(session);
      session.chatError = message(error);
    }
    this.changed();
  }

  private attachChat(session: ChatSession, chat: Orchestrator): void {
    session.chat = chat;
    const gateway = session.mcpGateway;
    void chat.done
      .then(async () => {
        await gateway?.close();
        if (session.mcpGateway === gateway) session.mcpGateway = undefined;
      })
      .catch(() => {});
    session.chatDisposers = [
      chat.onEvent(
        this.projectHost.bind((event) => {
          session.activity.event(event);
          session.replies.event(event);
          if (
            session.plans?.active() &&
            ((event.type === "status" &&
              ["failed", "timed_out", "cancelled", "interrupted"].includes(event.status)) ||
              (event.type === "turnEnd" && event.stopReason !== "end_turn"))
          ) {
            this.conversations.pause(session);
            void this.exclusive(async () => {
              await this.pausePlan(session, "The plan conversation stopped or failed.");
              this.changed();
            }).catch((cause: unknown) => {
              session.chatError = message(cause);
              this.changed();
            });
          }
          this.changed();
          const entry = { revision: this.revision, event };
          session.chatEvents.push(entry);
          session.chatPending.push(entry);
          if (event.type === "turnEnd" && event.stopReason === "end_turn") this.titleChat(session);
          if (
            event.type === "turnEnd" ||
            (event.type === "status" && !ACTIVE_STATUSES.has(event.status))
          )
            this.persistChatSoon(session);
          if (event.type === "status" && event.status === "idle") {
            this.schedulePlans();
            this.scheduleFeedback();
            this.conversations.scheduleUpdates();
          }
        }),
      ),
      chat.onChange(
        this.projectHost.bind(() => {
          if (chat.runs()[0]?.stopping) session.activity.invalidate();
          this.changed();
        }),
      ),
      chat.onWarning(
        this.projectHost.bind((warning) => {
          session.chatError = warning;
          session.activity.invalidate();
          this.changed();
        }),
      ),
    ];
  }

  private async continueChat(
    session: ChatSession,
    text: string,
    origin: "automatic" | undefined,
    deliveredText: string | undefined,
    taskId: string,
  ): Promise<void> {
    if (!this.chatStore || !session.saved || !session.chatDirectory || !this.config)
      throw new Error("Saved chat context is unavailable");
    const saved = session.saved;
    this.requireEnabled(saved.provider);
    const command = this.config.agents[saved.provider]?.command;
    if (
      !command ||
      createHash("sha256").update(JSON.stringify(command)).digest("hex") !== saved.commandHash
    )
      throw new Error(
        "This chat's provider command changed. Restore its verified provider or start a new chat.",
      );
    const directory = await this.chatStore.directory(saved.directoryId);
    const { record, events, agentAlive } = await this.chatHistory(saved);
    if (ACTIVE_STATUSES.has(record.status) || agentAlive)
      throw new Error(
        "The saved chat still has a live owning or agent process. Stop it before continuing.",
      );
    const task = session.tasks.find((task) => task.id === taskId);
    if (!task || task.project !== (this.workspace?.dir ?? null))
      throw new Error("Open the originating task's project before continuing");
    if (session.restored) {
      await this.loadChatHistory(session);
      session.plans = await PlanStore.open(directory, record.id);
    }
    const previousTask = session.taskId;
    session.taskId = taskId;
    const deliveries = task.deliveries ? [...task.deliveries] : [];
    task.deliveries = [...deliveries, record.turns + 1];
    try {
      await this.saveChat(session);
    } catch (cause) {
      session.taskId = previousTask;
      task.deliveries = deliveries;
      throw cause;
    }
    let chat: Orchestrator | undefined;
    try {
      for (const dispose of session.chatDisposers) dispose();
      session.chatDisposers = [];
      await this.closeMcpGateway(session);
      chat = await prepareOrchestrationChat(this.deps, directory, saved.provider, this.config, {
        recovery: record,
        mcpServers: await this.mcpAgentServer(session),
        promptContext: () =>
          assembleOperatingContract(
            effectivePrompts(this.config?.prompts ?? DEFAULT_PROMPT_TEMPLATES, this.savedPrompts)
              .operatingContract,
          ),
      });
      this.attachChat(session, chat);
      session.reviewTask = {
        title: task.title,
        turn: task.turn,
        ...(task.reviewId ? { reviewId: task.reviewId } : {}),
      };
      const recovery = await chat.restore(record.id);
      if (recovery.type === "handoff-required") {
        const summary = buildHandoffPrompt(
          record,
          events,
          effectivePrompts(this.config.prompts, this.savedPrompts).handoffSummary,
        );
        await chat.handoff(
          record.id,
          summary,
          text,
          recovery.reason,
          taskDelivery(task, deliveredText ?? text, true),
          origin,
        );
      } else this.conversations.send(session, text, origin, deliveredText, taskId);
      session.restored = false;
      session.chatError = null;
      session.historyRun = undefined;
      // Recovery does not authorize saved plans, feedback, or historical workers.
      if (origin === undefined) session.updatesPaused = false;
    } catch (cause) {
      // An unstarted recovery retains its historical final status. It has no
      // process to stop and its live-run completion promise has never started.
      if (chat?.runs().some((run) => ACTIVE_STATUSES.has(run.status))) await chat.shutdown();
      for (const dispose of session.chatDisposers) dispose();
      session.chatDisposers = [];
      session.chat = undefined;
      await this.closeMcpGateway(session);
      session.restored = true;
      session.taskId = previousTask;
      task.deliveries = deliveries;
      this.persistChatSoon(session);
      throw cause;
    }
  }
  orchestrationChatAction(value: OrchestrationChatAction): Promise<void> {
    const request = parseOrchestrationChatAction(value);
    if (
      this.relay &&
      request.type !== "new" &&
      (this.relay.owns(request.id) || (request.id === null && this.relaySelected))
    ) {
      if (request.type === "select") this.relaySelected = true;
      return this.relay.action(request).then(() => this.changed());
    }
    if (request.type === "history")
      return Promise.reject(new Error("History paging is Relay-only"));
    const owner =
      request.type === "new" && request.projectId
        ? this.projectHost.byId(request.projectId)
        : "id" in request && request.id
          ? this.projectHost
              .all()
              .find((owner) =>
                owner.state.conversations.sessions.some(
                  (session) => session.run?.id === request.id,
                ),
              )
          : this.projectHost.current;
    if (this.relay && !owner)
      return Promise.reject(new Error("This orchestration chat is no longer current"));
    if (owner && (request.type === "select" || request.type === "new"))
      this.projectHost.select(owner);
    if (owner && owner !== this.projectHost.current)
      return this.projectHost.run(owner, () => this.orchestrationChatAction(request));
    if (this.relay && !this.workspace)
      return Promise.reject(new Error("Open a project to create or use a project chat."));
    if (request.type === "select" || request.type === "new") this.relaySelected = false;
    if (request.type === "set-mode")
      return this.changeHarnessMode(request.id, request.change, true);
    if (this.orchestration.provider) this.requireEnabled(this.orchestration.provider);
    return this.exclusive(async () => {
      if (request.type === "new") {
        if (!this.database) throw new Error("Connect to a database first");
        const provider = this.orchestration.provider;
        if (!provider || !Object.hasOwn(this.config?.agents ?? {}, provider))
          throw new Error("Select an available orchestration provider");
        const session = this.conversations.create();
        await this.startChat(session);
        return;
      }
      const session =
        request.id === null
          ? this.conversations.current
          : this.conversations.sessions.find((entry) => entry.run?.id === request.id);
      const run = session?.run;
      if (!session || request.id !== (run?.id ?? null))
        throw new Error("This orchestration chat is no longer current");
      if (request.type === "set-tactic") {
        if (
          session !== this.conversations.current ||
          request.project !== (this.workspace?.dir ?? null)
        )
          throw new Error("The chat or project changed. Reopen Tactics and try again.");
        if (request.tactic && !findTactic(request.tactic))
          throw new Error("This tactic is unavailable");
        const previous = session.tactic;
        session.tactic = request.tactic;
        try {
          await this.saveChat(session);
        } catch (cause) {
          session.tactic = previous;
          throw cause;
        }
      } else if (request.type === "select") {
        if (session.archived) throw new Error("This chat is archived");
        this.conversations.current = session;
        await this.loadChatHistory(session).catch(() => {
          session.chatError =
            "Saved chat history or plans could not be read safely. Files were preserved; repair them or start a new chat.";
        });
        session.selectedAt = Date.now();
        await this.saveChat(session);
      } else if (request.type === "rename") {
        session.title = request.title.trim();
        session.titleTask?.abort.abort();
        await this.saveChat(session);
      } else if (request.type === "archive") {
        session.archived = true;
        await this.saveChat(session);
        if (this.conversations.current === session) {
          const next = this.conversations.sessions.find((entry) => !entry.archived);
          if (next) this.conversations.current = next;
          else await this.startChat(this.conversations.create());
        }
      } else if (request.type === "resume-updates") {
        if (session.restored || !session.chat)
          throw new Error("Continue the stopped chat explicitly first");
        this.conversations.resume(session);
        this.schedulePlans();
        this.scheduleFeedback();
      } else if (request.type === "restart") {
        if (!this.database) throw new Error("Connect to a database first");
        if (!this.orchestration.provider) throw new Error("Select an orchestration provider");
        this.conversations.current = session;
        await this.syncOrchestrationChat(true);
      } else if (request.type === "continue-task") {
        const task = session.tasks.find((task) => task.id === request.taskId);
        if (!task || task.project !== (this.workspace?.dir ?? null))
          throw new Error("Open this task's project before continuing");
        if (!session.restored && session.chat && run?.status === "idle")
          await this.sendTask(
            session,
            "Continue the originating task. Inspect previous evidence and report blockers; do not repeat completed work.",
            "automatic",
            task.id,
          );
        else
          await this.continueChat(
            session,
            "Continue the originating task. Inspect previous evidence and report blockers; do not repeat completed work.",
            "automatic",
            undefined,
            task.id,
          );
      } else if (request.type === "send") {
        let deliveredText: string | undefined;
        if (request.command !== undefined) {
          const command =
            this.requireDatabase().command(request.command) ??
            BUILTIN_COMMANDS.find((entry) => entry.name === request.command);
          if (!command) throw new Error(`Command /${request.command} no longer exists`);
          deliveredText = expandCommand(command, request.text);
        }
        if (!run) throw new Error("No orchestration session is available");
        if (!session.restored && run.status !== "idle" && ACTIVE_STATUSES.has(run.status))
          throw new Error("Wait for the current turn to end before sending");
        const task = captureTask(
          session.tactic,
          request.text,
          run.turns + 1,
          this.workspace?.dir ?? null,
        );
        const previous = session.taskId;
        session.tasks.push(task);
        session.taskId = task.id;
        session.deliveryPending = true;
        try {
          await this.saveChat(session);
          if (session.restored || !ACTIVE_STATUSES.has(run.status))
            await this.continueChat(session, request.text, undefined, deliveredText, task.id);
          else this.conversations.send(session, request.text, undefined, deliveredText, task.id);
        } catch (cause) {
          session.tasks = session.tasks.filter((entry) => entry !== task);
          session.taskId = previous;
          this.persistChatSoon(session);
          throw cause;
        } finally {
          session.deliveryPending = false;
          this.conversations.scheduleUpdates();
        }
      } else if (!session.chat || !run) throw new Error("No orchestration session is available");
      else if (request.type === "cancel") {
        if (!session.chat.cancelTurn(run.id)) throw new Error("No turn is in progress");
        this.conversations.pause(session);
        await this.pausePlan(session, "Stopped. Inspect previous work before resuming.");
      } else {
        this.conversations.pause(session);
        await this.pausePlan(session, "Conversation stopped.");
        await session.chat.shutdown();
      }
      this.changed();
    });
  }
  get hasActiveWork(): boolean {
    return (
      this.relay?.active ||
      this.projectHost
        .all()
        .some((owner) =>
          this.projectHost.run(
            owner,
            () =>
              this.active ||
              this.conversations.sessions.some((session) =>
                session.chat
                  ?.runs()
                  .some((run) => ["queued", "running", "waiting"].includes(run.status)),
              ),
          ),
        )
    );
  }

  private titleChat(session: ChatSession): void {
    if (
      session.title ||
      session.titleAttempted ||
      this.closing ||
      session.revoked ||
      session.updatesPaused
    )
      return;
    const first = session.chatEvents.find(
      ({ event }) => event.type === "prompt" && event.origin !== "automatic",
    )?.event;
    if (first?.type !== "prompt") return;
    let reply = "";
    for (const { event } of session.chatEvents) {
      if (event.type === "message") reply += event.text.slice(0, 8_000 - reply.length);
      if (reply.length === 8_000) break;
    }
    if (!reply.trim()) return;
    const provider = this.orchestration.provider;
    const agent = provider ? this.config?.agents[provider] : undefined;
    if (!provider || !agent) return;
    session.titleAttempted = true;
    const abort = new AbortController();
    const done = (async () => {
      const temporary = await mkdtemp(join(tmpdir(), "code60-title-"));
      try {
        const cwd = join(temporary, "private");
        await privateDirectory(cwd);
        const title = await generateChatTitle(
          this.deps.agents,
          { name: provider, command: agent.command, cwd },
          first.text,
          reply,
          abort.signal,
        );
        if (!abort.signal.aborted && !session.revoked && !session.title) {
          session.title = title;
          this.persistChatSoon(session);
          this.changed();
        }
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    })()
      // A title failure must never fail the conversation.
      .catch(() => {})
      .finally(() => {
        session.titleTask = undefined;
      });
    session.titleTask = { abort, done };
  }

  get active(): boolean {
    return [...this.batches.values()].some((batch) => batch.active);
  }

  get connected(): boolean {
    return this.database !== undefined;
  }

  subscribe(listener: (snapshot: Snapshot) => void, summaries = false): () => void {
    const listeners = summaries ? this.summaryListeners : this.listeners;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  subscribeDetails(value: DetailRequest, emit: (frame: DetailFrame) => void): void {
    const request = parseDetailRequest(value);
    this.details.subscribe(request, this.revision, {
      ...this.detailSource(request.scope, request.subscriptionId),
      emit,
    });
  }

  readDetails(value: DetailRequest): DetailFrame {
    return this.details.read(parseDetailRequest(value), this.revision);
  }

  unsubscribeDetails(value: unknown): void {
    this.details.unsubscribe(parseDetailIdentity(value).subscriptionId);
  }

  clearDetailSubscriptions(): void {
    this.details.clear();
  }

  setRelayFileContext(value: unknown): void {
    const context = parseRelayFileContext(value);
    const owner = this.details.capture(context.subscriptionId);
    if (!this.relay || this.closing) throw new Error("Relay files are unavailable");
    const root = this.relay.fileRoot(owner.scope);
    this.relayFiles.set(context, root, owner.valid);
  }

  private detailSource(
    scope: DetailScope,
    subscriptionId: string,
  ): {
    valid(): void;
    read(allEvents: boolean): DetailPayload;
    version(): string | number;
  } {
    const relay = this.relay;
    const relayAddress = () => {
      if (this.closing || !relay || scope.kind === "project")
        throw new Error("This Relay detail generation is no longer available");
      return relay.fileRoot(scope);
    };
    if (scope.kind === "target") {
      const target = relayAddress();
      if (!relay) throw new Error("Relay target details are unavailable");
      return {
        version: () =>
          `${relay.detailVersion(scope.targetId)}:${this.relayFiles.version(subscriptionId)}`,
        valid: () => {
          relayAddress();
        },
        read: () => {
          const snapshot = relay.workerSnapshot(false, scope.targetId);
          const runs = snapshot.runs.filter((run) => run.relay?.targetId === scope.targetId);
          const ids = new Set(runs.map((run) => run.record.id));
          return {
            kind: "target",
            targetId: scope.targetId,
            cwd: target.cwd,
            runs,
            events: snapshot.events.filter((entry) => ids.has(entry.event.runId)),
            ...this.relayFiles.snapshot(subscriptionId),
          };
        },
      };
    }
    if (
      scope.kind === "conversation" &&
      relay?.snapshot(true).conversationId === scope.conversationId
    ) {
      if (scope.projectId !== undefined)
        throw new Error("Relay details cannot inherit a project identity");
      return {
        version: () => `${relay.detailVersion()}:${this.relayFiles.version(subscriptionId)}`,
        valid: () => {
          relayAddress();
        },
        read: () => ({
          kind: "conversation",
          chat: relay.snapshot(),
          ...this.relayFiles.snapshot(subscriptionId),
        }),
      };
    }
    if (!scope.projectId) throw new Error("Project details need the originating project identity");
    const owner = this.projectHost.byId(scope.projectId);
    const session =
      scope.kind === "conversation"
        ? owner.state.conversations.sessions.find(
            (session) => session.run?.id === scope.conversationId,
          )
        : undefined;
    const valid = () => {
      this.projectHost.assertCurrent(owner);
      if (this.closing || owner.epoch !== scope.databaseEpoch)
        throw new Error("This detail database instance is no longer open");
      if (
        scope.kind === "conversation" &&
        (!session ||
          !owner.state.conversations.sessions.includes(session) ||
          session.run?.id !== scope.conversationId ||
          session.chatGeneration !== scope.generation)
      )
        throw new Error("This conversation detail generation is no longer available");
    };
    return {
      valid,
      version: () => owner.state.detailRevision,
      read: (allEvents) =>
        this.projectHost.run(owner, () => {
          if (scope.kind === "conversation") {
            if (!session) throw new Error("This conversation is no longer available");
            return { kind: "conversation", chat: this.chatSnapshot(session, allEvents) };
          }
          return {
            kind: "project",
            projectId: owner.id,
            databaseEpoch: owner.epoch,
            ...this.projectSnapshot(allEvents),
          };
        }),
    };
  }

  snapshot(allEvents = true, summaries = false): Snapshot {
    return this.projectHost.run(this.projectHost.selected, () =>
      this.currentSnapshot(allEvents, summaries),
    );
  }

  private chatOwner(id: string) {
    return this.projectHost
      .all()
      .find((owner) =>
        owner.state.conversations.sessions.some((session) => session.run?.id === id),
      );
  }

  private chatSnapshot(
    session: ChatSession,
    allEvents: boolean,
    summary = false,
  ): OrchestrationChat {
    const owned = [...this.conversations.workers].filter(
      ([, worker]) =>
        worker.generation === session.chatGeneration && worker.directory === this.workspace?.dir,
    );
    return {
      generation: session.chatGeneration,
      replies: session.replies.snapshot(),
      ...(session.tactic === undefined ? {} : { tactic: session.tactic }),
      restored: session.restored,
      ...(session.taskId ? { taskId: session.taskId } : {}),
      ...(session.title === undefined ? {} : { title: session.title }),
      ...(this.relay && this.workspace
        ? {
            kind: "project" as const,
            projectId: this.projectHost.current.id,
          }
        : {}),
      archived: session.archived,
      plans: session.plans?.list() ?? [],
      workers: owned.map(([id]) => id),
      workerLabels: Object.fromEntries(
        owned.flatMap(([id, worker]) => (worker.label ? [[id, worker.label]] : [])),
      ),
      run: session.run ?? null,
      directory: session.chatDirectory,
      error: session.chatError,
      events: summary ? [] : [...(allEvents ? session.chatEvents : session.chatPending)],
      updates: { paused: session.updatesPaused, pending: session.inbox.length },
      activity: session.activity.snapshot(
        session.chat?.runs()[0] ?? null,
        session.chatError,
        [...this.conversations.workers].filter(
          ([id, worker]) =>
            worker.generation === session.chatGeneration &&
            worker.directory === this.workspace?.dir &&
            ["queued", "running", "waiting"].includes(this.liveView(id)?.status ?? ""),
        ).length,
      ),
    };
  }

  private projectSnapshot(
    allEvents: boolean,
    summary = false,
  ): Pick<
    Snapshot,
    "directory" | "runs" | "events" | "files" | "worktrees" | "reviews" | "liveIds"
  > {
    const views = new Map(
      [...this.batches.keys()].flatMap((batch) =>
        batch.runs().map((view) => [view.id, view] as const),
      ),
    );
    return {
      directory: this.workspace?.dir ?? null,
      runs: this.history.map((run) => {
        const view = views.get(run.record.id);
        const current =
          view === undefined
            ? run
            : {
                ...run,
                record: {
                  ...run.record,
                  status: view.status,
                  turns: view.turns,
                  ...(view.reason === undefined ? {} : { reason: view.reason }),
                },
                view,
              };
        const replies = this.projectState.replies.get(run.record.id)?.snapshot();
        const result = { ...current, ...(replies ? { replies } : {}) };
        return summary ? summarizeRun(result) : result;
      }),
      liveIds: [...views.keys()],
      events: summary ? [] : [...(allEvents ? this.events : this.pending)],
      files: summary ? null : this.files,
      worktrees: summary ? null : structuredClone(this.worktrees),
      reviews:
        (summary ? undefined : this.reviews)
          ?.list()
          .map(
            ({
              id,
              version,
              project,
              title,
              chatId,
              originChatId,
              turn,
              workers,
              submissions,
              revisions,
            }) => ({
              id,
              version,
              project,
              title,
              chatId,
              originChatId,
              turn,
              workers,
              submissions,
              revisions: revisions.map(({ id, at }) => ({ id, at })),
              ...(this.relay
                ? {
                    projectId: this.projectHost.current.id,
                    databaseEpoch: this.projectHost.current.epoch,
                  }
                : {}),
            }),
          ) ?? [],
    };
  }

  private currentSnapshot(allEvents = true, summaries = false): Snapshot {
    const project = this.projectSnapshot(allEvents, summaries);
    const relayWorkers = this.relay?.workerSnapshot(summaries);
    const session = this.conversations.current;
    const chatSnapshot = (current: ChatSession) => this.chatSnapshot(current, allEvents, summaries);
    return {
      ...project,
      ...(summaries
        ? { summaryOnly: true as const, detailRevisions: this.details.revisions() }
        : {}),
      versions: {
        code60: CODE60_VERSION,
        databaseSchema: SCHEMA,
        runRecordFormat: RUN_RECORD_FORMAT,
        acpProtocol: ACP_PROTOCOL_VERSION,
        mcpProtocol: MCP_PROTOCOL_VERSION,
        electron: process.versions.electron ?? null,
        chromium: process.versions.chrome ?? null,
        node: process.versions.node,
      },
      ...(this.gitState ? { gitReadiness: this.gitState } : {}),
      chat:
        this.relay && this.relaySelected ? this.relay.snapshot(summaries) : chatSnapshot(session),
      chats: [
        ...(this.relay ? [this.relay.snapshot(summaries)] : []),
        ...this.projectHost
          .all()
          .filter((owner) => !this.relay || owner.state.workspace)
          .flatMap((owner) =>
            this.projectHost.run(owner, () =>
              this.conversations.sessions
                .filter((session) => !this.relay || session.run)
                .map(chatSnapshot),
            ),
          ),
      ],
      workers: [
        ...this.conversations.workers.keys(),
        ...(relayWorkers?.runs.map((run) => run.record.id) ?? []),
      ],
      orchestration: { ...this.orchestration },
      agentSetup: this.agentSetup.snapshot(),
      revision: this.revision,
      database: this.database?.path ?? null,
      databaseError: this.databaseError,
      ...(this.relay
        ? {
            databaseEpoch: this.projectHost.databaseEpoch,
            projectInstanceId: this.workspace ? this.projectHost.current.id : null,
            openProjects: this.projectHost.all().flatMap((owner) =>
              owner.key && owner.state.workspace
                ? [
                    {
                      id: owner.id,
                      path: owner.state.workspace.dir,
                      active: [...owner.state.batches.values()].some((batch) => batch.active),
                      chatIds: owner.state.conversations.sessions.flatMap((session) =>
                        session.run ? [session.run.id] : [],
                      ),
                      workerIds: owner.state.history.map((run) => run.record.id),
                    },
                  ]
                : [],
            ),
          }
        : {}),
      projects: [...this.projects],
      configurations: structuredClone(this.configurations),
      commands: this.database ? structuredClone(this.commands) : [],
      agents: this.agentSetup.complete ? this.agentSetup.enabled : [],
      defaultAgent: this.agentSetup.record?.primary ?? "",
      maxParallel: this.config?.maxParallel ?? 4,
      turnTimeout: this.config?.turnTimeout ?? "30m",
      runs: [...project.runs, ...(relayWorkers?.runs ?? [])],
      liveIds: [...project.liveIds, ...(relayWorkers?.liveIds ?? [])],
      active: this.active,
      warnings: [...this.warnings],
      events: [...project.events, ...(relayWorkers?.events ?? [])],
      polling: this.poller.snapshot(),
      prompts: promptStates(this.config?.prompts ?? DEFAULT_PROMPT_TEMPLATES, this.savedPrompts),
    };
  }

  private changed(projectId: string | null = this.projectHost.current.id): void {
    const owner =
      projectId === this.projectHost.fallback.id
        ? this.projectHost.fallback
        : this.projectHost.all().find((owner) => owner.id === projectId);
    if (owner && !owner.closed) owner.state.detailRevision++;
    this.revision += 1;
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.details.publish(this.revision);
      const snapshot = this.listeners.size
        ? { ...this.snapshot(false), previousRevision: this.publishedRevision }
        : undefined;
      const summary = this.summaryListeners.size
        ? { ...this.snapshot(false, true), previousRevision: this.publishedRevision }
        : undefined;
      this.publishedRevision = this.revision;
      for (const runtime of this.projectHost.all()) {
        runtime.state.pending = [];
        for (const session of runtime.state.conversations.sessions) session.chatPending = [];
      }
      if (snapshot)
        for (const listener of this.listeners) {
          try {
            listener(snapshot);
          } catch {
            this.listeners.delete(listener);
          }
        }
      if (summary)
        for (const listener of this.summaryListeners) {
          try {
            listener(summary);
          } catch {
            this.summaryListeners.delete(listener);
          }
        }
    }, 40);
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const owner = this.projectHost.current;
    const result = this.queue.then(() => {
      if (this.closing) throw new Error("The app is stopping");
      this.projectHost.assertCurrent(owner);
      return this.projectHost.run(owner, operation);
    });
    this.queue = result.catch(() => {});
    return result;
  }

  /** Reconnects to the database remembered from the previous launch, if any. */
  restore(): Promise<void> {
    return this.exclusive(async () => {
      try {
        this.agentSetup.restore(await this.storage.preferences.agentSetup?.());
        this.orchestration = {
          provider: this.agentSetup.record?.primary ?? null,
          allowAll: true,
          connection: "idle",
          error: null,
        };
      } catch {
        this.warnings.push("Agent setup needs to be completed again.");
      }
      try {
        const overrides = (await this.storage.preferences.polling?.()) ?? {};
        this.poller.configure(overrides);
        this.relayFiles.configure(overrides);
        this.pollOverrides = overrides;
      } catch {
        this.warnings.push("Invalid saved polling settings. Using defaults.");
      }
      try {
        await this.setConfig(desktopConfig(await loadConfig(this.deps.fs, this.env)));
      } catch (error) {
        this.warnings.push(message(error));
      }
      let path: string | undefined;
      try {
        path = await this.storage.preferences.read();
      } catch (error) {
        this.databaseError = `Could not read the saved database setting: ${message(error)}`;
      }
      if (path !== undefined) {
        try {
          const database = this.storage.openDatabase(path, false);
          this.attach(database);
          emitLog(this.deps.log, {
            event: "database.connect",
            operationId: randomUUID(),
            outcome: "succeeded",
          });
        } catch (error) {
          emitLog(this.deps.log, {
            event: "database.connect",
            operationId: randomUUID(),
            outcome: "failed",
            errorCategory: "storage",
          });
          this.databaseError = `Could not reconnect to the saved database. ${message(error)}`;
        }
      }
      await this.syncOrchestrationChat();
      this.changed();
      this.poller.context(this.active);
    });
  }

  /** Connects to another database. On failure the current connection stays in use. */
  connect(
    path: string,
    create: boolean,
    databaseEpoch = this.projectHost.databaseEpoch,
  ): Promise<void> {
    const operationId = randomUUID();
    const began = Date.now();
    return this.exclusive(async () => {
      this.assertDatabaseRequest(databaseEpoch);
      if (this.relay) return this.connectRetainedDatabase(path, create);
      if (this.taskOperation) throw new Error("Wait for the task operation to finish");
      if (this.active) throw new Error("Finish or stop all runs before switching databases");
      await this.cancelOrchestrationTest();
      await this.stopMemoryExtraction();
      await this.stopSearchSummary();
      this.orchestration = { ...this.orchestration, connection: "idle", error: null };
      const config = desktopConfig(await loadConfig(this.deps.fs, this.env));
      const database = this.storage.openDatabase(path, create);
      try {
        await this.storage.preferences.write(database.path);
      } catch (error) {
        database.close();
        throw new Error(`Could not remember the database: ${message(error)}`);
      }
      await this.cancelDiffReads();
      await this.cancelGitSetup();
      const previous = this.database;
      try {
        this.attach(database);
      } catch (error) {
        database.close();
        throw error;
      }
      previous?.close();
      await this.setConfig(config);
      if (previous?.path !== database.path) {
        await this.clearWorkspace();
        this.savedPrompts = this.readPrompts(database);
      }
      await this.syncOrchestrationChat();
      this.changed();
    }).then(
      () => {
        emitLog(this.deps.log, {
          event: "database.connect",
          operationId,
          outcome: "succeeded",
          durationMs: Date.now() - began,
        });
      },
      (error: unknown) => {
        emitLog(this.deps.log, {
          event: "database.connect",
          operationId,
          outcome: "failed",
          durationMs: Date.now() - began,
          errorCategory: "storage",
        });
        throw error;
      },
    );
  }

  /** Opens a folder chosen by the user and adds it to the project history. */
  open(directory: string, databaseEpoch = this.projectHost.databaseEpoch): Promise<void> {
    return this.databaseWrite(databaseEpoch, () => this.openDirectory(directory));
  }

  private async connectRetainedDatabase(path: string, create: boolean): Promise<void> {
    const database = this.storage.openDatabase(path, create);
    try {
      const owners = this.projectHost.all();
      if (
        owners.some(
          (owner) =>
            owner.state.workspace ||
            owner.state.conversations.sessions.some((session) => session.chat),
        ) &&
        !(await this.dialogs.confirm(
          "Replace database?",
          "This stops and closes database-owned projects and chats. Relay and its workers will keep running.",
        ))
      ) {
        database.close();
        return;
      }
      const stopped = await Promise.allSettled(
        owners.map((owner) => this.projectHost.run(owner, () => this.stopProject())),
      );
      if (stopped.some((result) => result.status === "rejected"))
        throw new Error(
          "Database replacement stopped because some project work could not be stopped.",
        );
      await this.storage.preferences.write(database.path);
      const previous = this.database;
      this.attach(database);
      previous?.close();
      for (const owner of owners) {
        owner.state.conversations.stop();
        this.projectHost.run(owner, () => this.detach());
      }
      this.projectHost.replaceDatabase();
      this.relaySelected = true;
      await this.projectHost.run(this.projectHost.fallback, async () => {
        await this.setConfig(desktopConfig(await loadConfig(this.deps.fs, this.env)));
        await this.syncOrchestrationChat();
      });
      this.poller.invalidate(["history", "worktrees", "files", "configurations"]);
      this.changed();
    } catch (cause) {
      if (this.database !== database) database.close();
      throw cause;
    }
  }

  /** Opens a folder only if it is already in the connected database's history. */
  openProject(path: string, databaseEpoch?: number): Promise<void> {
    return this.databaseWrite(databaseEpoch, async () => {
      if (!this.projects.some((project) => project.path === path))
        throw new Error("This project is not in the database's history");
      await this.openDirectory(path);
    });
  }

  /** Removes a project from the history. Its folder and run records are not touched. */
  removeProject(path: string, databaseEpoch?: number): Promise<void> {
    return this.databaseWrite(databaseEpoch, async () => {
      const database = this.requireDatabase();
      if (!this.projects.some((project) => project.path === path))
        throw new Error("This project is not in the database's history");
      database.remove(path);
      this.projects = database.list();
      this.changed();
    });
  }

  /** Clears the whole project history after confirmation. Resolves false when declined. */
  clearProjects(databaseEpoch?: number): Promise<boolean> {
    return this.databaseWrite(databaseEpoch, async () => {
      const database = this.requireDatabase();
      if (this.projects.length === 0) return true;
      const confirmed = await this.dialogs.confirm(
        "Clear project history?",
        `This removes all ${this.projects.length} projects from ${database.path}. Project folders and their runs are not affected.`,
      );
      if (!confirmed) return false;
      database.clear();
      this.projects = database.list();
      this.changed();
      return true;
    });
  }

  private requireDatabase(): ProjectDatabase {
    if (this.database === undefined) throw new Error("Connect to a database first");
    return this.database;
  }

  private async openDirectory(directory: string): Promise<void> {
    if (this.relay) return this.openRetainedProject(directory);
    await this.stopMemoryExtraction();
    await this.stopSearchSummary();
    const database = this.requireDatabase();
    if (this.active) throw new Error("Finish or stop all runs before switching folders");
    let dir: string;
    try {
      dir = await realpath(directory);
      if (!(await stat(dir)).isDirectory()) throw new Error("not a folder");
    } catch {
      throw new Error(`This folder is not available: ${directory}`);
    }
    const config = desktopConfig(await loadConfig(this.deps.fs, this.env));
    const workspace = await openWorkspace(this.deps, dir, this.env, true);
    const history = await listRuns(commandDeps(this.deps, workspace));
    await this.clearWorkspace();
    this.workspace = workspace;
    this.gitState = await this.probeGit(workspace.dir);
    try {
      this.reviews = await ReviewStore.open(
        join(
          dirname(database.path),
          ".code60_workspace",
          "reviews",
          createHash("sha256").update(database.path).digest("hex"),
        ),
        workspace.dir,
      );
    } catch (cause) {
      this.warnings.push(`Reviews unavailable: ${message(cause)}`);
    }
    await this.setConfig(config);
    this.history = history;
    this.poller.context(this.active);
    try {
      database.record(workspace.dir, this.deps.clock.now().toISOString());
      this.projects = database.list();
    } catch (error) {
      this.warnings.push(`Could not save this project to the database: ${message(error)}`);
    }
    this.changed();
  }

  private async openRetainedProject(directory: string): Promise<void> {
    const database = this.requireDatabase();
    let dir: string;
    try {
      dir = await realpath(directory);
      if (!(await stat(dir)).isDirectory()) throw new Error("not a folder");
    } catch {
      throw new Error(`This folder is not available: ${directory}`);
    }
    const previous = this.projectHost.find(dir);
    if (previous) {
      this.selectProject(previous.id);
      return;
    }
    const workspace = await openWorkspace(this.deps, dir, this.env, true);
    const history = await listRuns(commandDeps(this.deps, workspace));
    const owner = this.projectHost.open(dir);
    await this.projectHost.run(owner, async () => {
      this.workspace = workspace;
      this.history = history;
      this.gitState = await this.probeGit(dir);
      try {
        this.reviews = await ReviewStore.open(
          join(
            dirname(database.path),
            ".code60_workspace",
            "reviews",
            createHash("sha256").update(database.path).digest("hex"),
          ),
          dir,
        );
      } catch (cause) {
        this.warnings.push(`Reviews unavailable: ${message(cause)}`);
      }
      await this.syncProjectChat(false);
    });
    try {
      database.record(dir, this.deps.clock.now().toISOString());
      this.projects = database.list();
    } catch (cause) {
      owner.state.warnings.push(`Could not save this project to the database: ${message(cause)}`);
    }
    this.selectProject(owner.id);
  }

  private selectProject(id: string): void {
    const owner = this.projectHost.byId(id);
    this.projectHost.select(owner);
    this.relaySelected = !owner.state.conversations.current.run;
    owner.state.pending = [...owner.state.events];
    for (const session of owner.state.conversations.sessions)
      session.chatPending = [...session.chatEvents];
    this.projectHost.run(owner, () => this.poller.context(this.active));
    this.changed();
  }

  projectAction(value: ProjectAction): Promise<void> {
    const request = parseProjectAction(value);
    const owner = this.projectHost.byId(request.projectId);
    return this.projectHost.run(owner, () =>
      this.exclusive(async () => {
        if (request.type === "select") return this.selectProject(owner.id);
        if (!this.workspace) throw new Error("This project is no longer open");
        const folder = this.workspace.dir;
        if (
          !(await this.dialogs.confirm(
            request.type === "close" ? "Close project?" : "Stop folder?",
            request.type === "close"
              ? `Close ${folder} and stop its project-owned work? Relay workers in this folder will keep running.`
              : `Stop project work and Relay workers in ${folder}? Other folders will keep running.`,
          ))
        )
          return;
        const stopped = await Promise.allSettled([
          this.stopProject(),
          request.type === "stop-folder" ? this.relay?.stopFolder(folder) : undefined,
        ]);
        if (stopped.some((result) => result.status === "rejected"))
          throw new Error("Some project work could not be stopped. The project was kept open.");
        if (request.type === "close") {
          if (this.projectHost.selected === owner) this.relaySelected = true;
          this.projectHost.remove(owner);
        }
        this.poller.invalidate(["history", "files", "worktrees"]);
        this.changed();
      }),
    );
  }

  private async stopProject(force = false): Promise<void> {
    this.projectState.launchEpoch++;
    this.conversations.rotateScopes();
    const operation = this.taskOperation;
    operation?.abort.abort(new Error("Project work is stopping"));
    for (const session of this.conversations.sessions) {
      this.conversations.pause(session);
      session.titleTask?.abort.abort();
    }
    const results = await Promise.allSettled([
      operation?.done,
      this.stopMemoryExtraction(),
      this.stopSearchSummary(),
      this.cancelGitSetup(),
      this.cancelProjectDiffReads(),
      this.shutdownBatches(force),
      ...this.conversations.sessions.map((session) => session.titleTask?.done),
      ...this.conversations.sessions.map((session) =>
        this.pausePlan(session, "Project work stopped."),
      ),
      ...this.conversations.sessions.map((session) => this.closeMcpGateway(session)),
    ]);
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Some project-owned work could not be stopped");
  }

  private attach(database: ProjectDatabase): void {
    const projects = database.list();
    const configurations = database.configurations();
    const prompts = this.readPrompts(database);
    const commands = database.commands();
    this.projects = projects;
    this.configurations = configurations;
    this.savedPrompts = prompts;
    this.commands = commands;
    this.database = database;
    this.databaseError = null;
    this.poller.invalidate(["configurations"]);
  }

  private async clearWorkspace(): Promise<void> {
    if (this.taskOperation) throw new Error("Wait for the task operation to finish");
    await this.cancelGitSetup();
    this.gitSetup = undefined;
    this.gitState = undefined;
    await this.cancelProjectDiffReads();
    this.reviews = undefined;
    this.tasks = undefined;
    for (const session of this.conversations.sessions) session.reviewTask = undefined;
    this.detach();
    this.workspace = undefined;
    this.conversations.rotateScopes();
    for (const session of this.conversations.sessions)
      await this.pausePlan(session, "Project changed. Inspect previous work before resuming.");
    this.worktrees = null;
    this.fileContext = null;
    this.files = null;
    this.poller.invalidate(["history", "worktrees", "files"]);
    this.history = [];
    this.batches.clear();
    this.events = [];
    this.pending = [];
    this.warnings = [];
    this.launches.clear();
  }

  /** Native dialogs capture this before yielding and recheck it before acting. */
  assertDatabaseRequest(epoch: number | undefined): number {
    if (this.closing) throw new Error("The app is stopping");
    if (this.relay && epoch === undefined)
      throw new Error("This request needs the current database epoch");
    if (
      epoch !== undefined &&
      (!Number.isSafeInteger(epoch) || epoch < 0 || epoch !== this.projectHost.databaseEpoch)
    )
      throw new Error("The database instance changed. Reopen this view before trying again.");
    return epoch ?? this.projectHost.databaseEpoch;
  }

  private databaseWrite<T>(epoch: number | undefined, operation: () => Promise<T>): Promise<T> {
    let captured: number;
    try {
      captured = this.assertDatabaseRequest(epoch);
    } catch (cause) {
      return Promise.reject(cause);
    }
    return this.exclusive(async () => {
      this.assertDatabaseRequest(captured);
      const result = await operation();
      this.assertDatabaseRequest(captured);
      return result;
    });
  }

  saveConfiguration(request: SaveConfiguration, databaseEpoch?: number): Promise<void> {
    request = parseSaveConfiguration(request);
    return this.databaseWrite(databaseEpoch, async () => {
      const database = this.requireDatabase();
      const existing = request.id
        ? this.configurations.find((entry) => entry.id === request.id)
        : undefined;
      if (request.id && !existing) throw new Error("Unknown run configuration");
      const launch = request.launchId ? this.launches.get(request.launchId) : undefined;
      if (request.launchId && !launch) throw new Error("This launch is no longer available");
      if (launch?.saved) throw new Error("This launch was already saved as a run configuration");
      const settings = parseRunSettings(launch?.settings ?? request.settings);
      const config = await this.enabledConfig();
      for (const name of settings.agents) this.requireEnabled(name);
      if (!launch) {
        for (const name of settings.agents) {
          if (!Object.hasOwn(config.agents, name)) throw new Error(`Unavailable provider: ${name}`);
        }
      }
      const resolved: RunSettings = {
        ...settings,
        parallel:
          settings.parallel ?? String(settings.agents.length === 1 ? 1 : config.maxParallel),
        turnTimeout: settings.turnTimeout ?? config.turnTimeout,
      };
      database.saveConfiguration({
        id: existing?.id ?? randomUUID(),
        name: request.name,
        settings: resolved,
        uses: existing?.uses ?? (launch ? 1 : 0),
        lastUsed: existing?.lastUsed ?? launch?.at ?? null,
      });
      if (launch) launch.saved = true;
      this.configurations = database.configurations();
      void this.poller.poll("configurations", "change").catch(() => {});
      this.changed();
    });
  }

  deleteConfiguration(id: string, databaseEpoch?: number): Promise<boolean> {
    return this.databaseWrite(databaseEpoch, async () => {
      const database = this.requireDatabase();
      const entry = this.configurations.find((item) => item.id === id);
      if (!entry) throw new Error("Unknown run configuration");
      if (
        !(await this.dialogs.confirm(
          "Delete run configuration?",
          `Delete "${entry.name}"? Existing sessions are not affected.`,
        ))
      )
        return false;
      database.deleteConfiguration(id);
      this.configurations = database.configurations();
      void this.poller.poll("configurations", "change").catch(() => {});
      this.changed();
      return true;
    });
  }

  private readPrompts(database: ProjectDatabase): Partial<PromptTemplates> {
    const saved = database.promptTemplates();
    for (const warning of saved.skipped) {
      if (!this.warnings.includes(warning)) this.warnings.push(warning);
    }
    return saved.templates;
  }

  async saveCommand(value: SaveCommand, databaseEpoch?: number): Promise<void> {
    const request = parseSaveCommand(value);
    return this.databaseWrite(databaseEpoch, async () => {
      this.storeCommand(request);
    });
  }

  /** Caller owns the action queue. MCP passes validated create-only fields. */
  private storeCommand(request: ReturnType<typeof parseSaveCommand>): Command {
    const database = this.requireDatabase();
    const previous = request.id
      ? database.commands().find((entry) => entry.id === request.id)
      : undefined;
    if (request.id && !previous) throw new Error("This command no longer exists");
    const at = this.deps.clock.now().toISOString();
    const command = {
      ...request,
      id: request.id ?? randomUUID(),
      createdAt: previous?.createdAt ?? at,
      updatedAt: at,
    };
    database.saveCommand(command);
    this.commands = database.commands();
    this.changed();
    return command;
  }

  async deleteCommand(request: DeleteCommand, databaseEpoch?: number): Promise<boolean> {
    request = parseDeleteCommand(request);
    return this.databaseWrite(databaseEpoch, async () => {
      const database = this.requireDatabase();
      const entry = database.commands().find((entry) => entry.id === request.id);
      if (!entry) throw new Error("This command no longer exists");
      if (
        !(await this.dialogs.confirm(
          "Delete command?",
          `Delete /${entry.name}? This cannot be undone.`,
        ))
      )
        return false;
      database.deleteCommand(request.id);
      this.commands = database.commands();
      this.changed();
      return true;
    });
  }

  /** Saves a template edit for future orchestration turns or handoffs. */
  async savePromptTemplate(request: SavePromptTemplate, databaseEpoch?: number): Promise<void> {
    request = parseSavePromptTemplate(request);
    return this.databaseWrite(databaseEpoch, async () => {
      const database = this.requireDatabase();
      database.savePromptTemplate(
        request.id,
        request.template,
        this.deps.clock.now().toISOString(),
      );
      this.savedPrompts = this.readPrompts(database);
      this.changed();
    });
  }

  /** Removes a saved template edit after confirmation. Resolves false when declined. */
  async resetPromptTemplate(id: PromptId, databaseEpoch?: number): Promise<boolean> {
    id = parsePromptTemplateId(id);
    return this.databaseWrite(databaseEpoch, async () => {
      const database = this.requireDatabase();
      if (this.savedPrompts[id] === undefined) return true;
      const restores =
        promptStates(this.config?.prompts ?? DEFAULT_PROMPT_TEMPLATES, {}).find(
          (state) => state.id === id,
        )?.fallbackSource === "config"
          ? "the template from config.json"
          : "the built-in template";
      if (
        !(await this.dialogs.confirm(
          "Reset prompt template?",
          `Remove the saved ${id} edit from ${database.path}? Future uses of this template use ${restores}. Turns already in progress are not affected.`,
        ))
      )
        return false;
      database.deletePromptTemplate(id);
      this.savedPrompts = this.readPrompts(database);
      this.changed();
      return true;
    });
  }

  private publishEvent(event: RunEvent): void {
    let replies = this.projectState.replies.get(event.runId);
    if (!replies) {
      replies = new ConversationReplies();
      this.projectState.replies.set(event.runId, replies);
    }
    replies.event(event);
    this.changed();
    const entry = { revision: this.revision, event };
    this.events.push(entry);
    this.pending.push(entry);
    if (
      (event.type === "status" &&
        ["failed", "timed_out", "cancelled", "interrupted"].includes(event.status)) ||
      (event.type === "turnEnd" && event.stopReason !== "end_turn")
    ) {
      const worker = this.conversations.workers.get(event.runId);
      const session = this.conversations.sessions.find(
        (item) => item.chatGeneration === worker?.generation,
      );
      if (session && worker?.planId === session.plans?.active()?.id && worker?.planId) {
        this.conversations.pause(session);
        void this.exclusive(async () => {
          await this.pausePlan(
            session,
            "A plan worker stopped or failed. Inspect its result before resuming.",
          );
          this.changed();
        }).catch((cause: unknown) => {
          session.chatError = message(cause);
          this.changed();
        });
      }
    }
    this.conversations.trackWorker(event);
    if (
      event.type === "turnEnd" ||
      (event.type === "status" &&
        ["idle", "failed", "timed_out", "cancelled", "finished", "interrupted"].includes(
          event.status,
        ))
    ) {
      for (const review of this.reviews?.list() ?? [])
        if (review.workers.some((worker) => worker.runId === event.runId))
          this.scheduleReviewCapture(review.id);
    }
  }

  private publishPriorEvents(runId: string, events: readonly RunEvent[]): void {
    const existing = new Map<string, number>();
    for (const entry of this.events) {
      if (entry.event.runId !== runId) continue;
      const key = JSON.stringify(entry.event);
      existing.set(key, (existing.get(key) ?? 0) + 1);
    }
    for (const event of events) {
      const key = JSON.stringify(event);
      const count = existing.get(key) ?? 0;
      if (count > 0) existing.set(key, count - 1);
      else this.publishEvent(event);
    }
  }

  private activateBatch(orchestrator: Orchestrator, workspace: Workspace): void {
    const batch: Batch = {
      active: true,
      disposers: [
        orchestrator.onEvent(this.projectHost.bind((event) => this.publishEvent(event))),
        orchestrator.onChange(this.projectHost.bind(() => this.changed())),
        orchestrator.onWarning(
          this.projectHost.bind((warning) => {
            this.warnings.push(warning);
            this.changed();
          }),
        ),
      ],
    };
    this.batches.set(orchestrator, batch);
    this.poller.context(this.active);
    this.changed();
    void orchestrator.done.then(() => {
      batch.active = false;
      this.poller.context(this.active);
      for (const dispose of batch.disposers) dispose();
      batch.disposers = [];
      this.changed();
      if (!this.closing && this.workspace === workspace)
        void this.poller.poll("history", "change").catch((error: unknown) => {
          this.warnings.push(message(error));
          this.changed();
        });
    });
  }

  private async recoverableRun(workspace: Workspace, id: string): Promise<DesktopRun> {
    if (!this.history.some((run) => run.record.id === id))
      throw new Error("Unknown run in this workspace");
    const batch = this.liveBatch(id);
    const view = batch?.runs().find((run) => run.id === id);
    if (view && !ACTIVE_STATUSES.has(view.status)) await batch?.settled(id);
    this.history = await listRuns(commandDeps(this.deps, workspace));
    const run = this.history.find((entry) => entry.record.id === id);
    if (!run) throw new Error("Unknown run in this workspace");
    if (ACTIVE_STATUSES.has(run.record.status))
      throw new Error(`run ${id} is ${run.record.status}; active runs cannot be recovered`);
    if (run.agentAlive) {
      throw new Error(
        `the leftover agent for run ${id} is still alive (process group ${run.record.agentPid}); stop it before retrying`,
      );
    }
    return run;
  }

  /** Restores the run's ACP session and sends the message, or hands off to a fresh session. */
  private async continueRun(
    workspace: Workspace,
    id: string,
    text: string,
  ): Promise<RecoveryActionResult> {
    await this.requireGitRun(id);
    const restored = await this.resumeRun(workspace, id);
    if (restored.type === "handoff-required")
      return this.handoffRun(workspace, id, text, restored.reason);
    restored.orchestrator.reply(id, text);
    this.changed();
    return { type: "restored" };
  }

  private async resumeRun(
    workspace: Workspace,
    id: string,
  ): Promise<
    | { type: "restored"; orchestrator: Orchestrator }
    | Extract<RecoveryResult, { type: "handoff-required" }>
  > {
    const run = await this.recoverableRun(workspace, id);
    const enabledConfig = await this.enabledConfig();
    this.requireEnabled(run.record.agent);
    if (!run.record.acpSessionId) {
      return {
        type: "handoff-required",
        reason: "This run has no saved ACP session ID to restore.",
      };
    }
    let prepared: Awaited<ReturnType<typeof prepareRecovery>>;
    try {
      prepared = await prepareRecovery(
        this.deps,
        workspace,
        run.record,
        this.env,
        {},
        this.workerOverrides(id),
        enabledConfig,
      );
    } catch (error) {
      if (
        error instanceof RefusedError &&
        (error.message.includes("still alive") || error.message.includes("only ended"))
      )
        throw error;
      return { type: "handoff-required", reason: message(error) };
    }
    const priorEvents = await workspace.store.readEvents(id);
    const emitted: RunEvent[] = [];
    const off = prepared.orchestrator.onEvent((event) => emitted.push(event));
    let result: RecoveryResult;
    try {
      result = await prepared.orchestrator.restore(id);
    } catch (error) {
      off();
      throw error;
    }
    off();
    if (result.type === "handoff-required") return result;
    if (this.closing) {
      await prepared.orchestrator.shutdown(this.forceClosing);
      throw new Error("The app is stopping");
    }
    this.publishPriorEvents(id, priorEvents);
    for (const event of emitted) this.publishEvent(event);
    this.activateBatch(prepared.orchestrator, workspace);
    try {
      this.history = await listRuns(commandDeps(this.deps, workspace));
    } catch (error) {
      this.warnings.push(message(error));
    }
    this.changed();
    return { type: "restored", orchestrator: prepared.orchestrator };
  }

  private async handoffRun(
    workspace: Workspace,
    id: string,
    text: string,
    reason: string,
  ): Promise<RecoveryActionResult> {
    const run = await this.recoverableRun(workspace, id);
    const enabledConfig = await this.enabledConfig();
    this.requireEnabled(run.record.agent);
    const priorEvents = await workspace.store.readEvents(id);
    const saved = { ...this.savedPrompts };
    const prepared = await prepareRecovery(
      this.deps,
      workspace,
      run.record,
      this.env,
      saved,
      this.workerOverrides(id),
      enabledConfig,
    );
    const summary = buildHandoffPrompt(
      run.record,
      priorEvents,
      effectivePrompts(prepared.config.prompts, saved).handoffSummary,
    );
    const emitted: RunEvent[] = [];
    const off = prepared.orchestrator.onEvent((event) => emitted.push(event));
    try {
      await prepared.orchestrator.handoff(id, summary, text, reason);
    } catch (error) {
      off();
      throw error;
    }
    off();
    if (this.closing) {
      await prepared.orchestrator.shutdown(this.forceClosing);
      throw new Error("The app is stopping");
    }
    this.publishPriorEvents(id, priorEvents);
    for (const event of emitted) this.publishEvent(event);
    this.activateBatch(prepared.orchestrator, workspace);
    try {
      this.history = await listRuns(commandDeps(this.deps, workspace));
    } catch (error) {
      this.warnings.push(message(error));
    }
    this.changed();
    return { type: "handoff-started" };
  }

  /** Returns only the new run IDs, or an empty list when confirmation is declined. */
  async start(request: StartRequest): Promise<string[]> {
    if (request.projectId !== undefined) {
      const owner = this.projectHost.byId(request.projectId);
      if (request.databaseEpoch !== owner.epoch) throw new Error("The launch database changed.");
      if (owner !== this.projectHost.current)
        return this.projectHost.run(owner, () => this.start(request));
    }
    const epoch = this.projectState.launchEpoch;
    return this.exclusive(() => {
      if (epoch !== this.projectState.launchEpoch) throw new Error("Project launch was cancelled.");
      return this.startBatch(request);
    });
  }

  /** `register` sees the new run IDs before any of them starts. */
  private async startBatch(
    request: StartRequest,
    register?: (ids: string[], workspace: Workspace) => void,
  ): Promise<string[]> {
    const launchEpoch = this.projectState.launchEpoch;
    await this.requireGitRun();
    if (launchEpoch !== this.projectState.launchEpoch)
      throw new Error("Project launch was cancelled.");
    const workspace = this.requireWorkspace();
    const configuration = request.configurationId
      ? this.configurations.find((entry) => entry.id === request.configurationId)
      : undefined;
    if (request.configurationId && !configuration) throw new Error("Unknown run configuration");
    const {
      configurationId: _configurationId,
      prompt: _prompt,
      projectId: _projectId,
      databaseEpoch: _databaseEpoch,
      ...options
    } = request;
    const settings = parseRunSettings(options);
    const enabledConfig = await this.enabledConfig();
    const prepared = await prepareRuns(
      this.deps,
      {
        ...request,
        cwd: workspace.dir,
        env: this.env,
        mode: "interactive",
        requireIsolation: true,
      },
      enabledConfig,
    );
    const orchestrator = prepared.orchestrator;
    // Shutdown may have begun while preparation or the native confirmation was pending.
    if (this.closing || launchEpoch !== this.projectState.launchEpoch) {
      await orchestrator.shutdown(this.forceClosing);
      throw new Error(this.closing ? "The app is stopping" : "Project launch was cancelled.");
    }
    let history: DesktopRun[];
    try {
      history = await listRuns(commandDeps(this.deps, workspace));
    } catch (error) {
      await orchestrator.shutdown(this.forceClosing);
      throw error;
    }
    if (this.closing || launchEpoch !== this.projectState.launchEpoch) {
      await orchestrator.shutdown(this.forceClosing);
      throw new Error(this.closing ? "The app is stopping" : "Project launch was cancelled.");
    }

    this.history = history;
    this.activateBatch(orchestrator, workspace);
    register?.(
      orchestrator.runs().map((run) => run.id),
      workspace,
    );
    orchestrator.start();
    const ids = orchestrator.runs().map((run) => run.id);
    const at = this.deps.clock.now().toISOString();
    if (ids[0])
      this.launches.set(ids[0], {
        settings: {
          ...settings,
          parallel:
            settings.parallel ??
            String(settings.agents.length === 1 ? 1 : prepared.config.maxParallel),
          turnTimeout: settings.turnTimeout ?? prepared.config.turnTimeout,
        },
        at,
        saved: false,
      });
    if (configuration) {
      try {
        this.requireDatabase().useConfiguration(configuration.id, at);
        this.configurations = this.requireDatabase().configurations();
        void this.poller.poll("configurations", "change").catch(() => {});
      } catch {
        this.warnings.push(
          "Agents started, but run configuration usage could not be saved. Do not start the batch again.",
        );
      }
      this.changed();
    }
    return ids;
  }

  private changeHarnessMode(id: string, change: ModeChange, chat: boolean): Promise<void> {
    return this.projectHost.run(this.projectHost.current, () =>
      this.changeProjectHarnessMode(id, change, chat),
    );
  }

  private async changeProjectHarnessMode(
    id: string,
    change: ModeChange,
    chat: boolean,
  ): Promise<void> {
    // Reserve the session under the controller lock, but never hold the lock across
    // the RPC: Stop all, shutdown and other conversations must remain responsive.
    const { completion } = await this.exclusive(async () => {
      let owner: Orchestrator | undefined;
      if (chat) {
        owner = this.conversations.sessions.find(
          (session) => session.chat?.runs()[0]?.id === id,
        )?.chat;
      } else {
        this.requireWorkspace();
        if (!this.history.some((run) => run.record.id === id))
          throw new Error("Unknown run in this workspace");
        owner = [...this.batches.keys()].find((batch) => batch.runs().some((run) => run.id === id));
      }
      if (!owner) throw new Error("This session is no longer controlled by this app");
      const completion = owner.setMode(id, change);
      // Attach a handler before releasing the controller queue.
      void completion.catch(() => {});
      return { completion };
    });
    try {
      await completion;
    } finally {
      this.conversations.scheduleUpdates();
      this.scheduleFeedback();
      this.changed();
    }
  }

  readDiff(value: DiffRequest): Promise<string> {
    const request = parseDiffRequest(value);
    const owner = this.projectHost
      .all()
      .find((owner) => owner.state.history.some((run) => run.record.id === request.id));
    return this.projectHost.run(owner ?? this.projectHost.current, () =>
      this.readProjectDiff(request),
    );
  }

  private readProjectDiff(request: DiffRequest): Promise<string> {
    const runtime = this.projectHost.current;
    const workspace = this.workspace;
    const database = this.database;
    const current = () => {
      this.projectHost.assertCurrent(runtime);
      if (this.closing || workspace !== this.workspace || database !== this.database)
        throw new Error("The diff workspace is no longer current");
    };
    return this.diffReads.read(
      request,
      (signal) =>
        this.exclusive(async () => {
          signal.throwIfAborted();
          current();
          if (!workspace) throw new Error("Choose a folder first");
          if (!this.history.some((run) => run.record.id === request.id))
            throw new Error("Unknown run in this workspace");
          const target = await prepareDiff(commandDeps(this.deps, workspace), request.id);
          signal.throwIfAborted();
          current();
          return target;
        }),
      async (target, signal) => {
        current();
        const result = await executeDiff(this.deps.git, target, signal);
        current();
        return result;
      },
      runtime.id,
    );
  }

  cancelDiff(value: DiffIdentity): Promise<void> {
    return this.diffReads.cancel(parseDiffIdentity(value).requestId);
  }

  async cancelDiffReads(): Promise<void> {
    await Promise.allSettled([this.diffReads.cancel(), this.relay?.cancelReviewReads()]);
  }

  private cancelProjectDiffReads(): Promise<void> {
    return this.diffReads.cancel(undefined, undefined, this.projectHost.current.id);
  }

  action(action: Action): Promise<ActionResult> {
    if (this.relay?.handlesWorkerAction(action)) return this.relay.workerAction(action);
    const owner = this.projectHost
      .all()
      .find((owner) =>
        action.type === "permission"
          ? [...owner.state.batches.keys()].some((batch) =>
              batch.runs().some((run) => run.pending.some((pending) => pending.id === action.id)),
            )
          : owner.state.history.some((run) => run.record.id === action.id),
      );
    if (owner && owner !== this.projectHost.current)
      return this.projectHost.run(owner, () => this.action(action));
    if (action.type === "diff") return this.readDiff({ requestId: randomUUID(), id: action.id });
    if (action.type === "set-mode")
      return this.changeHarnessMode(action.id, action.change, false).then(() => undefined);
    return this.exclusive(async () => {
      const workspace = this.requireWorkspace();
      const cmd = commandDeps(this.deps, workspace);
      const orchestrator = [...this.batches.entries()]
        .reverse()
        .find(
          ([batch, state]) =>
            state.active &&
            batch
              .runs()
              .some((run) =>
                action.type === "permission"
                  ? run.pending.some((permission) => permission.id === action.id)
                  : run.id === action.id,
              ),
        )?.[0];
      if (action.type === "permission") {
        if (!orchestrator?.answerPermission(action.id, action.answer))
          throw new Error("This approval request is no longer pending");
        return;
      }
      if (!this.history.some((run) => run.record.id === action.id))
        throw new Error("Unknown run in this workspace");
      if (action.type === "continue") return this.continueRun(workspace, action.id, action.text);
      switch (action.type) {
        case "events":
          return workspace.store.readEvents(action.id);
        case "discard": {
          if (this.taskOperation) throw new Error("Wait for the task operation to finish");
          await this.cancelProjectDiffReads();
          const operationId = randomUUID();
          const began = Date.now();
          const result = await discardRun(
            cmd,
            workspace.repo?.topLevel ?? workspace.dir,
            action.id,
            async (files, record) =>
              this.dialogs.confirm(
                "Discard this worktree?",
                `This permanently removes ${record.worktree} and ${record.branch}.\n\nFiles that will be lost:\n${files.map((file) => `${file.status} ${file.path}`).join("\n") || "(no changed files)"}`,
              ),
          ).catch((error: unknown) => {
            emitLog(this.deps.log, {
              event: "worktree.remove",
              operationId,
              runId: action.id,
              projectId: logProjectId(workspace.dir),
              outcome: "failed",
              durationMs: Date.now() - began,
            });
            throw error;
          });
          emitLog(this.deps.log, {
            event: "worktree.remove",
            operationId,
            runId: action.id,
            projectId: logProjectId(workspace.dir),
            outcome: result.discarded ? "succeeded" : "cancelled",
            durationMs: Date.now() - began,
          });
          this.history = await listRuns(cmd);
          break;
        }
        case "stop":
          await stopRun(cmd, action.id);
          this.history = await listRuns(cmd);
          break;
        default:
          if (!orchestrator?.runs().some((run) => run.id === action.id))
            throw new Error("This run is not controlled by this app");
          if (action.type === "reply") {
            await this.requireGitRun(action.id);
            await this.enabledConfig();
            this.requireEnabled(
              this.history.find((run) => run.record.id === action.id)?.record.agent ?? "",
            );
            orchestrator.reply(action.id, action.text);
          } else if (action.type === "finish") orchestrator.finish(action.id);
          else if (!orchestrator.cancelTurn(action.id)) throw new Error("No turn is in progress");
      }
      this.changed();
    });
  }

  /** Orchestrated workers keep their fixed allow-all policy through restore and handoff. */
  private workerOverrides(id: string) {
    return this.conversations.workers.has(id) ? { allow: [], allowAll: true } : undefined;
  }

  private liveBatch(id: string): Orchestrator | undefined {
    return [...this.batches.entries()]
      .reverse()
      .find(([batch, state]) => state.active && batch.runs().some((run) => run.id === id))?.[0];
  }

  private liveView(id: string): RunView | undefined {
    for (const batch of [...this.batches.keys()].reverse()) {
      const view = batch.runs().find((run) => run.id === id);
      if (view) return view;
    }
    return undefined;
  }

  private requireScope(scope: string, session: ChatSession): Workspace {
    this.conversations.requireScope(scope, session);
    return this.requireWorkspace();
  }

  private async assertCapacity(session: ChatSession, ownReservation = 0): Promise<void> {
    const config = this.config ?? desktopConfig(await loadConfig(this.deps.fs, this.env));
    this.conversations.assertCapacity(session, config.maxParallel, ownReservation);
  }

  private workerInfo(id: string) {
    const worker = this.conversations.workers.get(id) as Worker;
    const listed = this.history.find((run) => run.record.id === id);
    const view = this.liveView(id);
    const status = view?.status ?? listed?.record.status ?? "queued";
    const live = view !== undefined && ACTIVE_STATUSES.has(status) && !view.stopping;
    const agentAlive = listed?.agentAlive === true;
    const discarded = listed?.record.discardedAt !== undefined;
    const canPrompt = listed?.record.base !== null && this.gitState?.status === "ready";
    const actions = live
      ? status === "idle"
        ? canPrompt
          ? ["send", "finish", "stop"]
          : ["finish", "stop"]
        : status === "queued"
          ? ["stop"]
          : ["cancel", "stop"]
      : view?.stopping
        ? []
        : agentAlive
          ? ["stop"]
          : discarded || !canPrompt
            ? []
            : ["resume"];
    const reason = view?.reason ?? listed?.record.reason;
    const stopReason = view?.lastStopReason ?? listed?.record.lastStopReason;
    return {
      runId: id,
      provider: worker.provider,
      status,
      ...(reason === undefined ? {} : { reason }),
      turns: view?.turns ?? listed?.record.turns ?? 0,
      ...(stopReason === undefined ? {} : { lastStopReason: stopReason }),
      stopping: view?.stopping === true,
      branch: listed?.record.branch ?? view?.branch ?? null,
      worktree: listed?.record.worktree ?? view?.worktree ?? "",
      startedAt: listed?.record.startedAt ?? null,
      agentAlive,
      discarded,
      actions,
    };
  }

  /** Runs one worker tool for the current chat. Every change is serialized and scope-checked. */
  private chatExclusive<T>(session: ChatSession, operation: () => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      this.conversations.assertCurrent(session);
      return operation();
    });
  }

  private controlTool(name: McpControlTool, args: unknown, session: ChatSession): Promise<unknown> {
    switch (name) {
      case "code60_create_command": {
        const request = parseControlArgs(name, args);
        return this.chatExclusive(session, async () => this.storeCommand(request));
      }
      case "code60_create_plan": {
        const request = parseControlArgs(name, args);
        return this.chatExclusive(session, async () => {
          const plan = await (await this.plans(session)).create(
            request,
            this.workspace?.dir ?? null,
          );
          const task = session.tasks.find((task) => task.id === session.taskId);
          if (task && !task.planIds.includes(plan.id)) {
            task.planIds.push(plan.id);
            await this.saveChat(session);
          }
          this.changed();
          return { ...plan, markdown: planMarkdown(plan) };
        });
      }
      case "code60_read_plan": {
        const request = parseControlArgs(name, args);
        return this.chatExclusive(session, async () => {
          const plan = (await this.plans(session)).get(request.planId);
          return { ...plan, markdown: planMarkdown(plan) };
        });
      }
      case "code60_update_plan": {
        const request = parseControlArgs(name, args);
        return this.chatExclusive(session, async () => {
          const store = await this.plans(session);
          if (store.get(request.planId).project !== (this.workspace?.dir ?? null))
            throw new Error("This plan belongs to another project");
          if (request.operation === "progress") {
            this.assertPlanWork(session);
            for (const id of request.workerIds ?? []) this.conversations.ownedWorker(id, session);
          }
          const plan = await store.update(request);
          this.changed();
          return { ...plan, markdown: planMarkdown(plan) };
        });
      }
      case "code60_read_review":
      case "code60_address_feedback": {
        const request = parseControlArgs(name, args);
        return this.chatExclusive(session, async () => {
          const store = this.reviewStore(this.requireWorkspace().dir);
          const review = store.get(request.reviewId);
          if (review.chatId !== session.chat?.runs()[0]?.id)
            throw new Error("This review is not attached to this conversation");
          if ("scope" in request) {
            this.requireScope(request.scope, session);
            await store.mutate(review.id, (review) => {
              const comment = review.comments.find(
                (comment) => comment.id === request.commentId && comment.state === "sent",
              );
              if (!comment) throw new Error("Unknown sent feedback");
              comment.addressed = request.note;
            });
            this.changed();
          }
          const current = store.get(review.id);
          const sent = current.comments.filter((comment) => comment.state !== "draft");
          const latest = current.revisions.at(-1);
          return {
            id: current.id,
            title: current.title,
            workers: current.workers,
            comments: sent.slice(-100),
            revisions: current.revisions.map(({ id, at }) => ({ id, at })),
            latest: latest
              ? {
                  id: latest.id,
                  at: latest.at,
                  errors: latest.errors,
                  files: latest.files.slice(0, 200),
                }
              : null,
            truncated: sent.length > 100 || (latest?.files.length ?? 0) > 200,
          };
        });
      }
      case "code60_get_context":
        parseControlArgs(name, args);
        return this.chatExclusive(session, async () => {
          const config = this.config ?? desktopConfig(await loadConfig(this.deps.fs, this.env));
          const workspace = this.workspace;
          return {
            project: workspace?.dir ?? null,
            scope: workspace ? session.workerScope : null,
            gitRepository: workspace ? workspace.repo !== null : null,
            gitReadiness: workspace ? await this.checkProjectGit(workspace.dir) : null,
            providers: this.agentSetup.complete ? this.agentSetup.enabled : [],
            defaultProvider: this.orchestration.provider,
            turnTimeout: config.turnTimeout,
            maxParallel: config.maxParallel,
            liveWorkers: this.conversations.liveWorkerCount(session),
            updatesPaused: session.updatesPaused,
            activeReviewId: session.reviewTask?.reviewId ?? null,
            plans: session.plans?.list() ?? [],
          };
        });
      case "code60_dispatch_agent":
        return this.dispatchWorker(parseControlArgs(name, args), session);
      case "code60_list_agents":
        parseControlArgs(name, args);
        return this.chatExclusive(session, async () => {
          const directory = this.workspace?.dir;
          return {
            project: directory ?? null,
            workers: [...this.conversations.workers]
              .filter(
                ([, worker]) =>
                  worker.generation === session.chatGeneration && worker.directory === directory,
              )
              .reverse()
              .map(([id]) => this.workerInfo(id)),
          };
        });
      case "code60_read_agent": {
        const request = parseControlArgs(name, args);
        return this.chatExclusive(session, async () => {
          this.conversations.ownedWorker(request.runId, session);
          const workspace = this.requireWorkspace();
          const entries = workerTranscript(await this.mergedEvents(workspace, request.runId));
          const limit = request.limit ?? 50;
          const cursor = request.tail
            ? Math.max(0, entries.length - limit)
            : Math.min(request.cursor ?? 0, entries.length);
          const page = entries.slice(cursor, cursor + limit);
          return {
            worker: this.workerInfo(request.runId),
            cursor,
            total: entries.length,
            nextCursor: cursor + page.length < entries.length ? cursor + page.length : null,
            entries: page,
          };
        });
      }
      default:
        return this.controlWorker(name, parseControlArgs(name, args), session);
    }
  }

  private dispatchWorker(
    request: ControlArgs<"code60_dispatch_agent">,
    session: ChatSession,
  ): Promise<unknown> {
    const { requestId, ...settings } = request;
    const key = JSON.stringify(settings);
    return this.conversations.deduplicate(session, requestId, key, () => {
      const reserved = this.relay ? 1 : 0;
      if (reserved) {
        this.requireScope(request.scope, session);
        if (!session.taskId) throw new Error("Send a human task before dispatching workers.");
        this.conversations.assertCapacity(session, this.config?.maxParallel ?? 4);
        session.reservations++;
      }
      return this.chatExclusive(session, async () => {
        this.requireScope(request.scope, session);
        if (!session.taskId) {
          const task = captureTask(
            undefined,
            session.reviewTask?.title ?? request.prompt,
            session.reviewTask?.turn ?? 0,
            this.workspace?.dir ?? null,
          );
          session.tasks.push(task);
          session.taskId = task.id;
          await this.saveChat(session);
        }
        const assignment = this.planTask(session, request.planTaskId);
        await this.requireGitRun();
        const workspace = this.requireWorkspace();
        const config = desktopConfig(await loadConfig(this.deps.fs, this.env));
        const provider = request.provider ?? this.orchestration.provider;
        await this.setConfig(config);
        this.requireEnabled(provider ?? "");
        if (!provider || !Object.hasOwn(config.agents, provider))
          throw new Error(
            `Unknown provider '${provider}' (configured: ${Object.keys(config.agents).join(", ")})`,
          );
        await this.assertCapacity(session, reserved);
        const reviewStore = this.reviews;
        let review: Review | undefined;
        if (reviewStore) {
          const id = request.reviewId ?? session.reviewTask?.reviewId;
          if (id) {
            review = reviewStore.get(id);
            if (review.chatId !== session.chat?.runs()[0]?.id)
              throw new Error("This review belongs to another conversation");
          } else {
            review = await reviewStore.create(
              session.chat?.runs()[0]?.id ?? null,
              session.reviewTask?.turn ?? 0,
              session.reviewTask?.title ?? request.prompt,
            );
          }
          session.reviewTask = { title: review.title, turn: review.turn, reviewId: review.id };
          const task = session.tasks.find((task) => task.id === session.taskId);
          if (task) {
            task.reviewId = review.id;
            await this.saveChat(session);
          }
        }
        const loop = reviewStore && this.taskLoop(reviewStore);
        const base =
          request.base ??
          (review &&
          loop &&
          workspace.repo &&
          (await samePath(workspace.dir, workspace.repo.topLevel))
            ? await loop.baseline(review.id)
            : undefined);
        const ids = await this.startBatch(
          {
            agents: [provider],
            allow: [],
            allowAll: true,
            prompt: request.prompt,
            ...(base === undefined ? {} : { base }),
            ...(request.turnTimeout === undefined ? {} : { turnTimeout: request.turnTimeout }),
          },
          (started, target) => {
            for (const id of started) {
              this.conversations.register(id, session, target.dir, provider, request.label);
              if (assignment)
                Object.assign(this.conversations.workers.get(id) as Worker, assignment);
            }
          },
        );
        const [runId] = ids;
        if (runId === undefined || workspace !== this.workspace)
          throw new Error("Worker launch did not complete in the current project");
        try {
          await this.associatePlanWorker(session, runId, assignment);
        } catch {
          this.warnings.push(
            "The worker started, but its plan association failed. Do not dispatch it again.",
          );
        }
        try {
          await this.saveChat(session);
        } catch {
          this.warnings.push(
            "The worker started, but its task context could not be saved. Inspect it before continuing; do not dispatch it again.",
          );
        }
        if (reviewStore && review) {
          try {
            await reviewStore.addWorker(
              review.id,
              runId,
              request.label ?? `${provider} ${review.workers.length + 1}`,
            );
            this.scheduleReviewCapture(review.id);
          } catch (cause) {
            this.warnings.push(
              `Worker ${runId} started, but review association failed: ${message(cause)}. Open its review from Sessions; do not dispatch it again.`,
            );
          }
          this.changed();
        }
        return {
          ...this.workerInfo(runId),
          reviewId: review?.id ?? null,
          note: "The worker is running. Code60 sends an automatic update when its turn ends.",
        };
      }).finally(() => {
        session.reservations -= reserved;
      });
    });
  }

  private controlWorker(
    name: Exclude<
      McpControlTool,
      | "code60_create_command"
      | "code60_create_plan"
      | "code60_read_plan"
      | "code60_update_plan"
      | "code60_get_context"
      | "code60_dispatch_agent"
      | "code60_list_agents"
      | "code60_read_agent"
      | "code60_read_review"
      | "code60_address_feedback"
    >,
    request: { scope: string; runId: string; prompt?: string; planTaskId?: string | undefined },
    session: ChatSession,
  ): Promise<unknown> {
    return this.chatExclusive(session, async () => {
      const workspace = this.requireScope(request.scope, session);
      const worker = this.conversations.ownedWorker(request.runId, session);
      const assignment =
        name === "code60_send_agent" || name === "code60_resume_agent"
          ? this.planTask(session, request.planTaskId, request.runId)
          : undefined;
      const id = request.runId;
      const batch = this.liveBatch(id);
      const view = batch?.runs().find((run) => run.id === id);
      const live = view !== undefined && ACTIVE_STATUSES.has(view.status);
      if (name === "code60_resume_agent") {
        if (live) throw new Error(`Worker ${id} is ${view.status}; resume only ended workers`);
        await this.assertCapacity(session);
        const previous = worker.taskId;
        worker.taskId = session.taskId;
        let result: RecoveryActionResult;
        try {
          result = await this.continueRun(workspace, id, request.prompt as string);
        } catch (cause) {
          worker.taskId = previous;
          throw cause;
        }
        await this.associatePlanWorker(session, id, assignment);
        this.persistChatSoon(session);
        return { ...this.workerInfo(id), recovery: result.type };
      }
      if (name === "code60_stop_agent") {
        if (batch && live) {
          void batch.shutdown().catch((error: unknown) => {
            this.warnings.push(message(error));
            this.changed();
          });
          this.changed();
          return { ...this.workerInfo(id), note: "The worker is stopping." };
        }
        const stopped = await stopRun(commandDeps(this.deps, workspace), id);
        this.history = await listRuns(commandDeps(this.deps, workspace));
        this.changed();
        return { ...this.workerInfo(id), note: stopped.message };
      }
      if (!batch || !live) throw new Error(`Worker ${id} has ended; resume it with a new prompt`);
      if (name === "code60_send_agent") {
        await this.requireGitRun(id);
        await this.enabledConfig();
        this.requireEnabled(this.conversations.workers.get(id)?.provider ?? "");
        const previous = worker.taskId;
        worker.taskId = session.taskId;
        try {
          batch.reply(id, request.prompt as string);
        } catch (cause) {
          worker.taskId = previous;
          throw cause;
        }
        await this.associatePlanWorker(session, id, assignment);
        this.persistChatSoon(session);
      } else if (name === "code60_finish_agent") batch.finish(id);
      else if (!batch.cancelTurn(id)) throw new Error(`Worker ${id} has no turn in progress`);
      this.changed();
      return this.workerInfo(id);
    });
  }
  async stopAll(): Promise<void> {
    if (this.relay) {
      const owners = this.projectHost.all();
      const results = await Promise.allSettled([
        ...owners.map((owner) => this.projectHost.run(owner, () => this.stopProject())),
        this.relay.stopAll(),
      ]);
      await this.queue;
      const final = await Promise.allSettled(
        owners.map((owner) => this.projectHost.run(owner, () => this.stopProject())),
      );
      this.changed();
      if ([...results, ...final].some((result) => result.status === "rejected"))
        throw new Error(
          "Some agents could not be stopped. Inspect retained work before continuing.",
        );
      return;
    }
    const active = this.taskOperation;
    active?.abort.abort(new Error("Task operation cancelled"));
    await active?.done;
    return this.exclusive(async () => {
      for (const session of this.conversations.sessions) this.conversations.pause(session);
      for (const session of this.conversations.sessions) session.titleTask?.abort.abort();
      const stopped = await Promise.allSettled([
        ...this.conversations.sessions.map((session) => session.titleTask?.done),
        ...this.conversations.sessions.map((session) =>
          this.pausePlan(session, "Stopped. Inspect previous work before resuming."),
        ),
        this.stopMemoryExtraction(),
        this.stopSearchSummary(),
        this.shutdownBatches(),
        this.relay?.stopAll(),
      ]);
      if (stopped.some((result) => result.status === "rejected"))
        throw new Error(
          "Some agents could not be stopped. Inspect retained work before continuing.",
        );
      this.changed();
    });
  }

  async shutdown(force = false): Promise<void> {
    this.details.clear();
    if (this.relay) return this.shutdownOwners(force);
    this.closing = true;
    const active = this.taskOperation;
    active?.abort.abort(new Error("Application is stopping"));
    for (const session of this.conversations.sessions) session.titleTask?.abort.abort();
    this.poller.stop();
    this.forceClosing ||= force;
    // Stop every process owner immediately, even if unrelated helper cleanup fails.
    // A force request must not wait behind an earlier graceful shutdown or read.
    const preparation = await Promise.allSettled([
      active?.done,
      ...this.conversations.sessions.map((session) => session.titleTask?.done),
      this.cancelGitSetup(),
      this.cancelDiffReads(),
      this.agentSetup.cancel(),
      this.cancelOrchestrationTest(),
      this.stopMemoryExtraction(),
      this.stopSearchSummary(),
      this.shutdownBatches(this.forceClosing),
    ]);
    await this.queue;
    const stopped = await Promise.allSettled([this.shutdownBatches(this.forceClosing)]);
    this.detach();
    for (const session of this.conversations.sessions) {
      for (const dispose of session.chatDisposers) dispose();
      session.chatDisposers = [];
    }
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.conversations.stop();
    this.listeners.clear();
    this.database?.close();
    this.database = undefined;
    const gateways = await Promise.allSettled(
      this.conversations.sessions.map((session) => this.closeMcpGateway(session)),
    );
    if ([...preparation, ...stopped, ...gateways].some((result) => result.status === "rejected"))
      throw new Error(
        "Some agents could not be stopped. Workspaces and Relay ownership were retained.",
      );
  }

  private requireWorkspace(): Workspace {
    if (this.workspace === undefined) throw new Error("Choose a folder first");
    return this.workspace;
  }

  private async shutdownOwners(force: boolean): Promise<void> {
    this.closing = true;
    this.forceClosing ||= force;
    this.poller.stop();
    const owners = this.projectHost.all();
    const preliminary = await Promise.allSettled([
      ...owners.map((owner) =>
        this.projectHost.run(owner, () => this.stopProject(this.forceClosing)),
      ),
      this.relay?.shutdown(this.forceClosing),
      this.agentSetup.cancel(),
      this.cancelOrchestrationTest(),
      this.cancelDiffReads(),
    ]);
    await this.queue;
    const final = await Promise.allSettled([
      ...owners.map((owner) =>
        this.projectHost.run(owner, () => this.stopProject(this.forceClosing)),
      ),
      this.relay?.shutdown(this.forceClosing),
    ]);
    if ([...preliminary, ...final].some((result) => result.status === "rejected"))
      throw new Error(
        "Some agents could not be stopped. Their owners were retained for forced cleanup.",
      );
    for (const owner of owners) {
      this.projectHost.run(owner, () => this.detach());
      owner.state.conversations.stop();
      for (const session of owner.state.conversations.sessions) {
        for (const dispose of session.chatDisposers) dispose();
        session.chatDisposers = [];
      }
      owner.closed = true;
    }
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.listeners.clear();
    this.database?.close();
    this.database = undefined;
  }

  private detach(): void {
    for (const batch of this.batches.values()) {
      for (const dispose of batch.disposers) dispose();
      batch.disposers = [];
    }
  }

  private async shutdownBatches(force = false): Promise<void> {
    const results = await Promise.allSettled(
      [
        ...this.batches.keys(),
        ...this.conversations.sessions.flatMap((session) => (session.chat ? [session.chat] : [])),
      ].map((batch) => batch.shutdown(force)),
    );
    if (results.some((result) => result.status === "rejected"))
      throw new Error("Some project or orchestration processes could not be stopped.");
  }
}
