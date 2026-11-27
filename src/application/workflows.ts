import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  branchNameSchema,
  parseWorkflowRequest,
  type WorkflowDraft,
  type WorkflowDraftReply,
  type WorkflowList,
  type WorkflowOrigin,
  type WorkflowProviderOption,
  type WorkflowRead,
  type WorkflowRecord,
  type WorkflowRequest,
  type WorkflowSnapshot,
  workflowDiffSchema,
  workflowDraftReplySchema,
  workflowDraftSchema,
  workflowEventsSchema,
  workflowOriginSchema,
  workflowSnapshotSchema,
} from "../bridge/index.js";
import {
  type CoreDeps,
  stateHome,
  WorkflowEngine,
  WorkflowProviderError,
  type WorkflowProviderResolver,
} from "../core/index.js";
import {
  fileCode,
  installationDirectory,
  lockPrivateState,
  readPrivateJson,
  writePrivateJson,
} from "../platform/index.js";
import { workflowContext, workflowDirectoryIdentity } from "./workflow-context.js";

const maximum = 16 * 1024 * 1024;
const WORKFLOW_HISTORY_LIMIT = 1000;
const recordSchema = z.strictObject({
  stopPending: z.boolean().optional(),
  id: z.uuid(),
  name: z.string().max(160),
  repository: z.string().max(32_768),
  worktree: z.string().max(32_768),
  branch: z.string().regex(/^code60\/workflow-[a-f0-9-]{36}$/),
  baseBranch: branchNameSchema.optional(),
  baseline: z.string().regex(/^[a-f0-9]{40,64}$/),
  repositoryIdentity: z.string().max(40_000),
  repositoryGitIdentity: z.string().max(40_000),
  worktreeIdentity: z.string().max(40_000),
  definition: workflowDraftSchema.omit({ repositoryToken: true }),
  origin: workflowOriginSchema.optional(),
  key: z.uuid(),
  createdAt: z.string().max(100),
  snapshot: workflowSnapshotSchema.optional(),
  updatedAt: z.string().max(100).optional(),
  state: z.enum(["preparing", "preparation_failed", "starting", "submitted", "uncertain"]),
});
const registrySchema = z.strictObject({
  format: z.literal(2),
  entries: z.array(recordSchema).max(WORKFLOW_HISTORY_LIMIT),
});
const ended = (record: WorkflowRecord) =>
  record.state === "preparation_failed" ||
  (!record.stopPending &&
    record.snapshot &&
    ["completed", "failed", "cancelled"].includes(record.snapshot.status));

/** Saved-work inspection only: never launches agents or acquires a writer lock. */
export async function inspectWorkflowRecordsForUninstall(env: Readonly<NodeJS.ProcessEnv>) {
  return inspectWorkflowRecordRoot(join(stateHome(env), "code60", "workflows"));
}

async function readWorkflowRemovalRecords(root: string): Promise<WorkflowRecord[]> {
  const exists = await lstat(root).catch((error: unknown) => {
    if (fileCode(error) !== "ENOENT") throw error;
    return null;
  });
  if (!exists) return [];
  await installationDirectory(root, false, true);
  const raw = await readPrivateJson(join(root, "registry.json"), maximum).catch(
    (error: unknown) => {
      if (fileCode(error) !== "ENOENT")
        throw Error("Workflow history is unavailable; preserve state before uninstalling");
      return undefined;
    },
  );
  if (raw === undefined) return [];
  const parsed = registrySchema.safeParse(raw);
  if (!parsed.success)
    throw Error("Workflow history is invalid; preserve state and recover it before uninstalling");
  const records = parsed.data.entries;
  if (
    new Set(records.map((record) => record.id)).size !== records.length ||
    new Set(records.map((record) => record.key)).size !== records.length
  )
    throw Error("Workflow history has duplicate ownership; preserve state before uninstalling");
  return records as WorkflowRecord[];
}

async function inspectWorkflowRecordRoot(root: string) {
  return workflowRemovalCounts(await readWorkflowRemovalRecords(root));
}

function workflowRemovalCounts(records: readonly WorkflowRecord[]) {
  const counts = { completed: 0, active: 0, uncertain: 0 };
  for (const record of records) {
    const snapshot = record.snapshot;
    if (
      record.stopPending ||
      ["preparing", "starting", "uncertain"].includes(record.state) ||
      (record.state === "preparation_failed" && snapshot) ||
      (record.state === "submitted" && !snapshot)
    ) {
      counts.uncertain++;
      continue;
    }
    if (record.state === "preparation_failed") {
      counts.completed++;
      continue;
    }
    if (!snapshot) {
      counts.uncertain++;
      continue;
    }
    const terminal = ["completed", "failed", "cancelled"].includes(snapshot.status);
    if (
      terminal !== (snapshot.activeTaskIndex === null) ||
      snapshot.tasks.length !== record.definition.tasks.length ||
      snapshot.tasks.some(
        (task, index) => task.index !== index || task.name !== record.definition.tasks[index]?.name,
      ) ||
      (snapshot.activeTaskIndex !== null && snapshot.activeTaskIndex >= snapshot.tasks.length) ||
      snapshot.accepted.length > snapshot.tasks.length ||
      (snapshot.status === "completed" && snapshot.accepted.length !== snapshot.tasks.length) ||
      snapshot.accepted.some(
        (task, index) =>
          task.name !== record.definition.tasks[index]?.name ||
          snapshot.tasks[index]?.state !== "accepted",
      )
    )
      counts.uncertain++;
    else if (terminal) counts.completed++;
    else counts.active++;
  }
  return counts;
}

/** Verifies offline workflow history is idle before uninstalling the backend. */
export async function verifyOfflineWorkflowsIdleForUninstall(
  env: Readonly<NodeJS.ProcessEnv>,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const root = join(stateHome(env), "code60", "workflows");
  const exists = await lstat(root).catch((error: unknown) => {
    if (fileCode(error) !== "ENOENT") throw error;
    return null;
  });
  if (!exists) return;
  await installationDirectory(root, false, true);
  const release = await lockPrivateState(root, { reclaimStale: false });
  try {
    const records = await readWorkflowRemovalRecords(root);
    const counts = workflowRemovalCounts(records);
    if (counts.active || counts.uncertain) {
      throw Error("Workflows are active or uncertain; resolve them before uninstalling");
    }
  } finally {
    await release();
  }
}

export interface WorkflowProviderPorts {
  list(): { providers: WorkflowProviderOption[]; defaultProvider: string | null };
  resolve: WorkflowProviderResolver;
}

type Choice = {
  path: string;
  identity: string;
  gitIdentity: string;
  formId: string;
  expires: number;
};
type Approval = {
  draft: WorkflowDraft;
  choice: Choice;
  formId: string;
  revision: number;
  expires: number;
  recordId?: string;
};

export class WorkflowCheckoutBusyError extends Error {
  constructor() {
    super("A workflow is already active or uncertain for this checkout");
    this.name = "WorkflowCheckoutBusyError";
  }
}

export interface ScheduledWorkflowStartInput {
  workflowId: string;
  name: string;
  repository: string;
  baseBranch: string;
  provider: string;
  tasks: WorkflowDraft["tasks"];
  repairs: number;
  retries: number;
  autoApprove: boolean;
  origin: WorkflowOrigin;
}

/** Human-approved ordered workflows running natively in-process through Code60's ACP agents. */
export class DesktopWorkflows {
  readonly root: string;
  private engine: WorkflowEngine | undefined;
  private unwatchEngine: (() => void) | undefined;
  private readonly workflowObservers = new Map<string, Set<(snapshot: WorkflowSnapshot) => void>>();
  private readonly globalObservers = new Set<
    (recordId: string, snapshot: WorkflowSnapshot) => void
  >();
  private choices = new Map<string, Choice>();
  private approvals = new Map<string, Approval>();
  private forms = new Map<string, number>();
  private drafts = new Map<
    string,
    { requestId: string; abort: AbortController; done: Promise<unknown> }
  >();
  private entries: WorkflowRecord[] = [];
  private previous: unknown;
  private loading: Promise<void> | undefined;
  private release: (() => Promise<void>) | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private saveChain: Promise<unknown> = Promise.resolve();
  private queuedActions = 0;
  private pendingDrafts = 0;
  private removalReservation: symbol | null = null;
  private generation = 0;
  private closed = false;
  private startup = new AbortController();
  private provider = "";

  constructor(
    env: Readonly<NodeJS.ProcessEnv>,
    private readonly deps: CoreDeps,
    private readonly pick: () => Promise<string | null>,
    private readonly generate: (input: string, signal: AbortSignal) => Promise<WorkflowDraftReply>,
    private readonly providers: WorkflowProviderPorts,
  ) {
    this.root = join(stateHome(env), "code60", "workflows");
  }

  private ensureEngine(): WorkflowEngine {
    if (!this.engine) {
      this.engine = new WorkflowEngine(
        join(this.root, "engine"),
        this.deps.agents,
        (providerId, cwd) => this.providers.resolve(providerId, cwd),
      );
      this.unwatchEngine = this.engine.onRunChange((snapshot) => {
        this.handleEngineSnapshot(snapshot);
      });
    }
    return this.engine;
  }

  private notifyWorkflowObservers(recordId: string, snapshot: WorkflowSnapshot) {
    const scoped = this.workflowObservers.get(recordId);
    if (scoped) {
      for (const listener of scoped) {
        try {
          listener(snapshot);
        } catch {
          /* Observer failures must not disrupt workflow execution. */
        }
      }
    }
    for (const listener of this.globalObservers) {
      try {
        listener(recordId, snapshot);
      } catch {
        /* Observer failures must not disrupt workflow execution. */
      }
    }
  }

  private handleEngineSnapshot(snapshot: WorkflowSnapshot) {
    const record = this.entries.find((entry) => entry.snapshot?.runId === snapshot.runId);
    if (!record) return;
    this.notifyWorkflowObservers(record.id, snapshot);
  }

  observeWorkflow(workflowId: string, listener: (snapshot: WorkflowSnapshot) => void): () => void {
    let set = this.workflowObservers.get(workflowId);
    if (!set) {
      set = new Set();
      this.workflowObservers.set(workflowId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set && set.size === 0) this.workflowObservers.delete(workflowId);
    };
  }

  subscribeChanges(listener: (recordId: string, snapshot: WorkflowSnapshot) => void): () => void {
    this.globalObservers.add(listener);
    return () => {
      this.globalObservers.delete(listener);
    };
  }

  workflowName(recordId: string): string | undefined {
    return this.entries.find((entry) => entry.id === recordId)?.name;
  }

  async hasActiveWorkflowForRepository(repositoryPath: string): Promise<boolean> {
    if (this.closed) return false;
    await this.load();
    let identity: string;
    try {
      identity = await workflowDirectoryIdentity(await realpath(repositoryPath));
    } catch {
      return false;
    }
    return this.entries.some((record) => record.repositoryIdentity === identity && !ended(record));
  }

  async startScheduled(input: ScheduledWorkflowStartInput): Promise<WorkflowRecord> {
    if (this.closed || this.removalReservation) throw new Error("Workflows is closing");
    return this.queueAction(async () => {
      if (this.closed || this.removalReservation) throw new Error("Workflows is closing");
      await this.load();
      if (this.entries.length >= WORKFLOW_HISTORY_LIMIT)
        throw new Error("Workflow history limit reached");
      const path = await realpath(input.repository);
      const repo = await this.deps.git.repoInfo(path);
      if (repo.topLevel !== path) throw new Error("Choose the repository root");
      const repoIdentity = await workflowDirectoryIdentity(path);
      const gitIdentity = await workflowDirectoryIdentity(repo.commonDir);
      if (
        this.entries.some((record) => record.repositoryIdentity === repoIdentity && !ended(record))
      )
        throw new WorkflowCheckoutBusyError();
      const baseline = await this.deps.git.resolveCommit(path, `refs/heads/${input.baseBranch}`);
      this.providers.resolve(input.provider, path);
      const definition: Omit<WorkflowDraft, "repositoryToken"> = {
        name: input.name,
        provider: input.provider,
        tasks: structuredClone(input.tasks),
        repairs: input.repairs,
        retries: input.retries,
        autoApprove: input.autoApprove,
      };
      const record: WorkflowRecord = {
        id: input.workflowId,
        name: input.name,
        repository: path,
        repositoryIdentity: repoIdentity,
        repositoryGitIdentity: gitIdentity,
        definition,
        baseBranch: input.baseBranch,
        origin: structuredClone(input.origin),
        worktree: join(`${path}.worktrees`, `workflow-${input.workflowId}`),
        worktreeIdentity: "",
        branch: `code60/workflow-${input.workflowId}`,
        baseline,
        key: randomUUID(),
        createdAt: new Date().toISOString(),
        state: "preparing",
      };
      this.entries.push(record);
      await this.save();
      try {
        await mkdir(dirname(record.worktree), { recursive: true });
        await this.deps.git.addWorktree(
          {
            repoDir: record.repository,
            path: record.worktree,
            branch: record.branch,
            base: record.baseline,
          },
          this.startup.signal,
        );
        record.worktreeIdentity = await workflowDirectoryIdentity(record.worktree);
        record.state = "starting";
        await this.save();
      } catch {
        record.state = "preparation_failed";
        await this.save();
        throw new Error(
          "Worktree preparation failed before workflow dispatch. Evidence and any partial worktree were retained.",
        );
      }
      const submitted = await this.submit(record);
      if (submitted.snapshot) this.notifyWorkflowObservers(submitted.id, submitted.snapshot);
      return submitted;
    });
  }

  async readScheduledState(
    workflowId: string,
    options: { live?: boolean } = {},
  ): Promise<WorkflowRecord | null> {
    if (this.closed) return null;
    const live = options.live ?? true;
    return this.queueAction(async () => {
      if (this.closed) return null;
      await this.load(live);
      const record = this.entries.find((entry) => entry.id === workflowId);
      if (!record) return null;
      if (live && record.snapshot && !ended(record)) {
        try {
          await this.target(record);
          const latest = this.ensureEngine().status(record.snapshot.runId);
          this.snapshot(record, latest);
          await this.save();
        } catch {
          /* Preserve last known persisted state when inspection cannot read live status. */
        }
      }
      return structuredClone(record);
    });
  }

  async cancelScheduled(workflowId: string): Promise<WorkflowRecord | null> {
    if (this.closed) return null;
    return this.queueAction(async () => {
      if (this.closed) return null;
      await this.load();
      const record = this.entries.find((entry) => entry.id === workflowId);
      if (!record || !record.snapshot || ended(record))
        return record ? structuredClone(record) : null;
      if (!record.stopPending) {
        record.stopPending = true;
        await this.save();
      }
      const nextSnapshot = await this.ensureEngine().cancel(record.snapshot.runId);
      this.snapshot(record, nextSnapshot);
      if (["cancelled", "completed", "failed"].includes(record.snapshot.status))
        delete record.stopPending;
      await this.save();
      this.notifyWorkflowObservers(record.id, record.snapshot);
      return structuredClone(record);
    });
  }

  async readScheduledDiff(
    workflowId: string,
  ): Promise<{ runId: string; text: string; truncated: boolean }> {
    await this.load();
    const record = this.entries.find((entry) => entry.id === workflowId);
    if (!record) throw new Error("Unknown workflow");
    await this.target(record);
    const text = await this.deps.git.diff(record.worktree, record.baseline);
    return {
      runId: record.snapshot?.runId ?? record.id,
      text: text.slice(0, 48_000),
      truncated: text.length > 48_000,
    };
  }

  observeProvider(identity: string) {
    if (this.provider !== identity) {
      this.provider = identity;
      this.cancelDrafts();
    }
  }

  private cancelDrafts() {
    for (const draft of this.drafts.values()) draft.abort.abort();
  }

  async reset() {
    this.generation++;
    this.choices.clear();
    this.approvals.clear();
    this.forms.clear();
    this.cancelDrafts();
    await Promise.all([...this.drafts.values()].map((draft) => draft.done.catch(() => {})));
  }

  async close() {
    this.closed = true;
    this.startup.abort();
    await this.reset();
    await this.queue.catch(() => {});
    await this.loading?.catch(() => {});
    this.unwatchEngine?.();
    this.unwatchEngine = undefined;
    this.workflowObservers.clear();
    this.globalObservers.clear();
    await this.engine?.close().catch(() => {});
    this.engine = undefined;
    await this.release?.();
    this.release = undefined;
  }

  private queueAction<T>(operation: () => Promise<T>) {
    this.queuedActions++;
    const result = this.queue.then(operation).finally(() => {
      this.queuedActions--;
    });
    this.queue = result.catch(() => {});
    return result;
  }

  async reserveIdleForUninstall(signal?: AbortSignal): Promise<() => Promise<void>> {
    signal?.throwIfAborted();
    if (this.queuedActions)
      throw Error("Workflow preparation is pending; finish it before uninstalling.");
    const run = this.queueAction(async () => {
      signal?.throwIfAborted();
      if (this.closed || this.removalReservation || this.pendingDrafts || this.drafts.size)
        throw Error("Workflow preparation is active or closing; finish it before uninstalling.");
      const token = Symbol("uninstall reservation");
      this.removalReservation = token;
      try {
        await this.loading;
        const writer = await lstat(join(this.root, ".writer")).catch((error: unknown) => {
          if (fileCode(error) !== "ENOENT") throw error;
          return null;
        });
        if (writer && !this.release)
          throw Error("Workflow writer ownership is uncertain; inspect it before uninstalling.");
        const counts = await inspectWorkflowRecordRoot(this.root);
        signal?.throwIfAborted();
        if (this.closed || counts.active || counts.uncertain)
          throw Error(
            "Workflows are active or their ownership is uncertain; resolve them before uninstalling.",
          );
        let released = false;
        return () => {
          const done = this.queueAction(async () => {
            if (released) return;
            if (this.removalReservation !== token)
              throw Error("Workflow uninstall reservation changed.");
            this.removalReservation = null;
            released = true;
          });
          return done;
        };
      } catch (error) {
        if (this.removalReservation === token) this.removalReservation = null;
        throw error;
      }
    });
    return run;
  }

  private async load(reconcileEngine = true) {
    this.loading ??= (async () => {
      this.release = await lockPrivateState(this.root);
      try {
        const raw = await readPrivateJson(join(this.root, "registry.json"), maximum).catch(
          (error) => {
            if (fileCode(error) === "ENOENT") return undefined;
            throw error;
          },
        );
        if (raw !== undefined) {
          this.entries = structuredClone(registrySchema.parse(raw).entries) as WorkflowRecord[];
          if (new Set(this.entries.map((entry) => entry.id)).size !== this.entries.length)
            throw new Error("Duplicate workflow registry identities");
          this.previous = raw;
        }
      } catch (error) {
        await this.release?.();
        this.release = undefined;
        throw error;
      }
    })();
    await this.loading;
    // Reconcile any active/paused runs persisted in workflows.sqlite once callers allow live engine startup.
    if (
      reconcileEngine &&
      !this.engine &&
      this.entries.some((entry) => entry.snapshot && !ended(entry))
    ) {
      this.ensureEngine();
    }
  }

  private async save() {
    const write = this.saveChain.then(async () => {
      const parsed = registrySchema.parse({ format: 2 as const, entries: this.entries });
      const normalized = JSON.parse(JSON.stringify(parsed)) as unknown;
      await writePrivateJson(join(this.root, "registry.json"), normalized, this.previous, maximum);
      this.previous = normalized;
    });
    this.saveChain = write.catch(() => {});
    await write;
  }

  private form(formId: string, revision: number) {
    if (this.forms.size >= 32 && !this.forms.has(formId))
      throw new Error("Too many open workflow forms");
    const current = this.forms.get(formId) ?? -1;
    if (current > revision) throw new Error("Workflow form changed");
    this.forms.set(formId, revision);
  }

  private choice(token: string, formId: string) {
    const choice = this.choices.get(token);
    if (!choice || choice.formId !== formId || choice.expires < Date.now())
      throw new Error("Choose the workflow repository again");
    return choice;
  }

  private async identity(choice: Choice) {
    const repo = await this.deps.git.repoInfo(choice.path);
    if ((await workflowDirectoryIdentity(repo.commonDir)) !== choice.gitIdentity)
      throw new Error("Workflow Git repository identity changed");
    if ((await workflowDirectoryIdentity(choice.path)) !== choice.identity)
      throw new Error("Workflow repository changed");
  }

  private record(id: string) {
    const record = this.entries.find((entry) => entry.id === id);
    if (!record) throw new Error("Unknown workflow");
    return record;
  }

  private async target(record: WorkflowRecord) {
    if ((await workflowDirectoryIdentity(record.repository)) !== record.repositoryIdentity)
      throw new Error("Source repository identity changed");
    if (
      !record.worktreeIdentity ||
      (await workflowDirectoryIdentity(record.worktree)) !== record.worktreeIdentity
    )
      throw new Error(
        "Execution worktree identity changed; preserve evidence and recover manually",
      );
    const repo = await this.deps.git.repoInfo(record.worktree);
    if (
      repo.topLevel !== record.worktree ||
      (await workflowDirectoryIdentity(repo.commonDir)) !== record.repositoryGitIdentity
    )
      throw new Error("Execution worktree changed");
    const inventory = await this.deps.git.listWorktrees(record.repository, { sizes: false });
    if (
      !inventory.some((entry) => entry.path === record.worktree && entry.branch === record.branch)
    )
      throw new Error("Execution branch changed");
  }

  private snapshot(record: WorkflowRecord, raw: unknown) {
    const snapshot = workflowSnapshotSchema.parse(raw);
    const terminal = ["completed", "failed", "cancelled"].includes(snapshot.status);
    if (
      terminal !== (snapshot.activeTaskIndex === null) ||
      snapshot.accepted.length > snapshot.tasks.length ||
      (snapshot.status === "completed" && snapshot.accepted.length !== snapshot.tasks.length) ||
      snapshot.accepted.some(
        (accepted, index) =>
          accepted.name !== record.definition.tasks[index]?.name ||
          snapshot.tasks[index]?.state !== "accepted",
      )
    )
      throw new Error("Workflow acceptance snapshot is inconsistent");
    if (record.snapshot && record.snapshot.runId !== snapshot.runId)
      throw new Error("Workflow response identity changed");
    if (
      snapshot.tasks.length !== record.definition.tasks.length ||
      snapshot.tasks.some(
        (task, index) => task.index !== index || task.name !== record.definition.tasks[index]?.name,
      ) ||
      (snapshot.activeTaskIndex !== null && snapshot.activeTaskIndex >= snapshot.tasks.length)
    )
      throw new Error("Workflow task snapshot does not match the approved definition");
    if (!record.snapshot || snapshot.eventCursor >= record.snapshot.eventCursor) {
      record.snapshot = snapshot;
      record.updatedAt = new Date().toISOString();
      record.state = "submitted";
    }
  }

  private async submit(record: WorkflowRecord) {
    await this.target(record);
    const providerId = record.definition.provider ?? this.providers.list().defaultProvider;
    if (!providerId) {
      throw new WorkflowProviderError("Connect a verified provider first.");
    }
    try {
      const result = this.ensureEngine().start({
        repository: record.worktree,
        provider: providerId,
        tasks: record.definition.tasks,
        confirmed: true,
        idempotencyKey: record.key,
        repairs: record.definition.repairs,
        retries: record.definition.retries,
        autoApprove: record.definition.autoApprove,
      });
      this.snapshot(record, result);
      await this.save();
      return structuredClone(record);
    } catch (error) {
      if (error instanceof WorkflowProviderError) {
        record.state = "uncertain";
        await this.save();
        throw error;
      }
      record.state = "uncertain";
      await this.save();
      throw new Error(
        "Workflow start is unconfirmed. Keep this worktree and recover the same request; do not create a duplicate.",
      );
    }
  }

  async request(value: unknown): Promise<unknown> {
    const request = parseWorkflowRequest(value);
    if (this.closed || this.removalReservation) throw new Error("Workflows is closing");
    if (request.action === "disposeForm") {
      const draft = this.drafts.get(request.formId);
      draft?.abort.abort();
      this.forms.delete(request.formId);
      for (const [key, choice] of this.choices)
        if (choice.formId === request.formId) this.choices.delete(key);
      for (const [key, approval] of this.approvals)
        if (approval.formId === request.formId) this.approvals.delete(key);
      await draft?.done.catch(() => {});
      return null;
    }
    if (request.action === "cancelDraft") {
      const draft = this.drafts.get(request.formId);
      if (draft && (!request.requestId || draft.requestId === request.requestId)) {
        draft.abort.abort();
        await draft.done.catch(() => {});
      }
      return null;
    }
    if (request.action === "invalidate") {
      this.form(request.formId, request.revision);
      this.drafts.get(request.formId)?.abort.abort();
      for (const [key, approval] of this.approvals)
        if (approval.formId === request.formId && approval.revision !== request.revision)
          this.approvals.delete(key);
      return null;
    }
    if (request.action === "draft") {
      this.pendingDrafts++;
      try {
        return await this.draft(request);
      } finally {
        this.pendingDrafts--;
      }
    }
    if (request.action === "list") {
      await this.load();
      // Sync live snapshots for any non-terminal runs so list badges stay fresh.
      if (this.engine) {
        let dirty = false;
        for (const entry of this.entries) {
          if (!entry.snapshot || ended(entry)) continue;
          try {
            const latest = this.engine.status(entry.snapshot.runId);
            if (latest.eventCursor > entry.snapshot.eventCursor) {
              this.snapshot(entry, latest);
              dirty = true;
            }
          } catch {
            /* Retain last saved snapshot if engine lookup fails. */
          }
        }
        if (dirty) await this.save();
      }
      const { providers, defaultProvider } = this.providers.list();
      const response: WorkflowList = {
        entries: structuredClone(this.entries),
        providers,
        defaultProvider,
      };
      return response;
    }
    const generation = this.generation;
    const run = this.queueAction(async () => {
      if (generation !== this.generation || this.closed || this.removalReservation)
        throw new Error("Workflow view changed");
      await this.load();
      return this.handle(request, generation);
    });
    return run;
  }

  private async handle(
    request: Exclude<
      WorkflowRequest,
      { action: "draft" | "invalidate" | "cancelDraft" | "disposeForm" | "list" }
    >,
    generation: number,
  ): Promise<unknown> {
    if (request.action === "pickRepository") {
      const selected = await this.pick();
      if (generation !== this.generation) throw new Error("Workflow view changed");
      if (!selected) return null;
      const path = await realpath(selected);
      const repo = await this.deps.git.repoInfo(path);
      if (repo.topLevel !== path) throw new Error("Choose the repository root");
      await this.deps.git.resolveCommit(path, "HEAD");
      this.drafts.get(request.formId)?.abort.abort();
      for (const [key, choice] of this.choices)
        if (choice.formId === request.formId || choice.expires < Date.now())
          this.choices.delete(key);
      if (this.choices.size >= 32) throw new Error("Too many repository choices");
      const token = randomUUID();
      this.choices.set(token, {
        path,
        identity: await workflowDirectoryIdentity(path),
        gitIdentity: await workflowDirectoryIdentity(repo.commonDir),
        formId: request.formId,
        expires: Date.now() + 60 * 60_000,
      });
      return { token, label: path };
    }
    if (request.action === "review") {
      this.form(request.formId, request.revision);
      if (JSON.stringify(request.draft).length > 1_000_000)
        throw new Error("Workflow definition exceeds its limit");
      const choice = this.choice(request.draft.repositoryToken, request.formId);
      await this.identity(choice);
      const providerId = request.draft.provider ?? this.providers.list().defaultProvider;
      if (!providerId) throw new Error("Connect a verified provider first");
      this.providers.resolve(providerId, choice.path);
      const normalizedDraft: WorkflowDraft = { ...request.draft, provider: providerId };
      for (const [key, approval] of this.approvals)
        if (approval.formId === request.formId || approval.expires < Date.now())
          this.approvals.delete(key);
      const approvalId = randomUUID();
      this.approvals.set(approvalId, {
        draft: structuredClone(normalizedDraft),
        choice,
        formId: request.formId,
        revision: request.revision,
        expires: Date.now() + 10 * 60_000,
      });
      return { approvalId, repository: choice.path, draft: normalizedDraft };
    }
    if (request.action === "start") {
      const approval = this.approvals.get(request.approvalId);
      if (
        !approval ||
        approval.expires < Date.now() ||
        approval.formId !== request.formId ||
        approval.revision !== request.revision ||
        this.forms.get(request.formId) !== request.revision
      )
        throw new Error("Workflow changed. Review it again before starting.");
      if (approval.recordId) return structuredClone(this.record(approval.recordId));
      await this.identity(approval.choice);
      if (this.entries.length >= WORKFLOW_HISTORY_LIMIT)
        throw new Error("Workflow history limit reached");
      if (
        this.entries.some(
          (record) => record.repositoryIdentity === approval.choice.identity && !ended(record),
        )
      )
        throw new Error("A workflow is already active or uncertain for this checkout");
      const id = randomUUID();
      const { repositoryToken: _token, ...definition } = approval.draft;
      const record: WorkflowRecord = {
        id,
        name: definition.name,
        repository: approval.choice.path,
        repositoryIdentity: approval.choice.identity,
        repositoryGitIdentity: approval.choice.gitIdentity,
        definition,
        worktree: join(`${approval.choice.path}.worktrees`, `workflow-${id}`),
        worktreeIdentity: "",
        branch: `code60/workflow-${id}`,
        baseline: "0".repeat(40),
        key: randomUUID(),
        createdAt: new Date().toISOString(),
        state: "preparing",
      };
      this.entries.push(record);
      approval.recordId = id;
      await this.save();
      try {
        const tasks = this.deps.git.tasks;
        if (!tasks) throw new Error("Current-file snapshots are unavailable");
        record.baseline = await tasks.snapshot(record.repository, {}, this.startup.signal);
        await this.identity(approval.choice);
        await mkdir(dirname(record.worktree), { recursive: true });
        await this.deps.git.addWorktree(
          {
            repoDir: record.repository,
            path: record.worktree,
            branch: record.branch,
            base: record.baseline,
          },
          this.startup.signal,
        );
        record.worktreeIdentity = await workflowDirectoryIdentity(record.worktree);
        record.state = "starting";
        await this.save();
      } catch {
        record.state = "preparation_failed";
        await this.save();
        throw new Error(
          "Worktree preparation failed before workflow dispatch. Evidence and any partial worktree were retained.",
        );
      }
      return this.submit(record);
    }

    const record = this.record(request.id);
    if (request.action === "recover") {
      if (record.snapshot || !["starting", "uncertain"].includes(record.state))
        throw new Error("Only an unconfirmed dispatch can be recovered");
      return this.submit(record);
    }
    if (request.action === "read") {
      if (!record.snapshot) {
        const res: WorkflowRead = { record: structuredClone(record) };
        return res;
      }
      try {
        await this.target(record);
        const latest = this.ensureEngine().status(record.snapshot.runId);
        this.snapshot(record, latest);
        await this.save();
        const res: WorkflowRead = { record: structuredClone(record) };
        return res;
      } catch (error) {
        const res: WorkflowRead = {
          record: structuredClone(record),
          error: error instanceof Error ? error.message : String(error),
        };
        return res;
      }
    }
    if (!record.snapshot) throw new Error("Recover the workflow start first");
    await this.target(record);
    const engine = this.ensureEngine();
    const runId = record.snapshot.runId;
    if (request.action === "events") {
      const page = workflowEventsSchema.parse({ events: engine.events(runId, request.after) });
      let sequence = request.after;
      for (const event of page.events) {
        if (event.sequence <= sequence) throw new Error("Invalid workflow event ordering");
        sequence = event.sequence;
        const detail = JSON.stringify(event.detail);
        if (detail.length > 32_768)
          event.detail = { excerpt: detail.slice(0, 32_000), incomplete: true };
      }
      return page;
    }
    if (request.action === "diff") {
      const page = workflowDiffSchema.parse(engine.diff(runId, request.offset));
      if (
        (page.nextOffset !== null && page.nextOffset <= request.offset) ||
        Buffer.from(page.content, "base64").toString("base64") !== page.content
      )
        throw new Error("Invalid accepted diff page");
      return page;
    }
    if (record.stopPending && request.action !== "cancel")
      throw new Error("Stop acknowledgement is pending");
    if (request.action === "cancel" && !record.stopPending) {
      record.stopPending = true;
      await this.save();
    }
    let nextSnapshot: unknown;
    switch (request.action) {
      case "pause":
        nextSnapshot = await engine.pause(runId);
        break;
      case "resume":
        nextSnapshot = engine.resume(runId);
        break;
      case "cancel":
        nextSnapshot = await engine.cancel(runId);
        break;
      case "answer":
        nextSnapshot = engine.answer(runId, request.questionId, request.answer);
        break;
      case "message":
        nextSnapshot = engine.message(runId, request.message);
        break;
    }
    this.snapshot(record, nextSnapshot);
    if (
      request.action === "cancel" &&
      ["cancelled", "completed", "failed"].includes(record.snapshot.status)
    )
      delete record.stopPending;
    await this.save();
    if (record.snapshot) this.notifyWorkflowObservers(record.id, record.snapshot);
    return structuredClone(record);
  }

  private async draft(request: Extract<WorkflowRequest, { action: "draft" }>) {
    this.form(request.formId, request.revision);
    const previous = this.drafts.get(request.formId);
    previous?.abort.abort();
    await previous?.done.catch(() => {});
    this.form(request.formId, request.revision);
    const abort = new AbortController();
    const generation = this.generation;
    const provider = this.provider;
    const choice = request.repositoryToken
      ? this.choice(request.repositoryToken, request.formId)
      : undefined;
    const operation = async () => {
      if (choice) await this.identity(choice);
      const context = choice ? await workflowContext(choice.path) : null;
      const result = await this.generate(
        JSON.stringify({
          fields: request.fields,
          conversation: request.messages,
          repository: context,
        }),
        abort.signal,
      );
      abort.signal.throwIfAborted();
      if (choice) {
        await this.identity(choice);
        if (this.choices.get(request.repositoryToken ?? "") !== choice)
          throw new Error("Repository changed");
      }
      if (
        generation !== this.generation ||
        provider !== this.provider ||
        this.forms.get(request.formId) !== request.revision
      )
        throw new Error("Workflow draft is stale");
      return workflowDraftReplySchema.parse(result);
    };
    const task = { requestId: request.requestId, abort, done: Promise.resolve<unknown>(null) };
    task.done = operation().finally(() => {
      if (this.drafts.get(request.formId) === task) this.drafts.delete(request.formId);
    });
    this.drafts.set(request.formId, task);
    return task.done;
  }
}
