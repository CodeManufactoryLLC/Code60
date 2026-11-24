import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  LEGACY_TRANSMISSION_VERSION,
  parseWorkflowRequest,
  TRANSMISSION_VERSION,
  type WorkflowDraft,
  type WorkflowDraftReply,
  type WorkflowRecord,
  type WorkflowRequest,
  workflowDiffSchema,
  workflowDraftReplySchema,
  workflowDraftSchema,
  workflowEngineVersion,
  workflowEventsSchema,
  workflowSnapshotSchema,
} from "../bridge/index.js";
import { type CoreDeps, stateHome } from "../core/index.js";
import {
  fileCode,
  installationDirectory,
  lockPrivateState,
  readPrivateJson,
  writePrivateJson,
} from "../platform/index.js";
import { LocalTransmission, type TransmissionClient } from "./transmission.js";
import { workflowContext, workflowDirectoryIdentity } from "./workflow-context.js";

const maximum = 8 * 1024 * 1024;
const recordSchema = z.strictObject({
  engineVersion: workflowEngineVersion.optional(),
  stopPending: z.boolean().optional(),
  id: z.uuid(),
  name: z.string().max(160),
  repository: z.string().max(32_768),
  worktree: z.string().max(32_768),
  branch: z.string().regex(/^code60\/transmission-[a-f0-9-]{36}$/),
  baseline: z.string().regex(/^[a-f0-9]{40,64}$/),
  repositoryIdentity: z.string().max(40_000),
  repositoryGitIdentity: z.string().max(40_000),
  worktreeIdentity: z.string().max(40_000),
  definition: workflowDraftSchema.omit({ repositoryToken: true }),
  key: z.uuid(),
  createdAt: z.string().max(100),
  snapshot: workflowSnapshotSchema.optional(),
  updatedAt: z.string().max(100).optional(),
  state: z.enum(["preparing", "preparation_failed", "starting", "submitted", "uncertain"]),
});
const registrySchema = z.strictObject({
  format: z.literal(1),
  version: workflowEngineVersion,
  entries: z.array(recordSchema).max(200),
});
const ended = (record: WorkflowRecord) =>
  record.state === "preparation_failed" ||
  (!record.stopPending &&
    record.snapshot &&
    ["completed", "failed", "cancelled"].includes(record.snapshot.status));

/** Saved-work inspection only: process ownership must be verified separately before removal. */
export async function inspectWorkflowRecordsForUninstall(env: Readonly<NodeJS.ProcessEnv>) {
  const root = join(stateHome(env), "code60", "workflows");
  const counts = { completed: 0, active: 0, uncertain: 0 };
  const exists = await lstat(root).catch((error: unknown) => {
    if (fileCode(error) !== "ENOENT") throw error;
    return null;
  });
  if (!exists) return counts;
  await installationDirectory(root, false, true);
  const raw = await readPrivateJson(join(root, "registry.json"), maximum).catch(
    (error: unknown) => {
      if (fileCode(error) !== "ENOENT") throw error;
      return undefined;
    },
  );
  if (raw === undefined) return counts;
  const parsed = registrySchema.safeParse(raw);
  if (!parsed.success)
    throw Error("Workflow history is invalid; preserve state and recover it before uninstalling");
  const records = parsed.data.entries;
  if (
    new Set(records.map((record) => record.id)).size !== records.length ||
    new Set(records.map((record) => record.key)).size !== records.length
  )
    throw Error("Workflow history has duplicate ownership; preserve state before uninstalling");
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

/** Human-approved external work owns its checkout independently of desktop conversations. */
export class DesktopWorkflows {
  readonly root: string;
  private readonly client: TransmissionClient;
  private readonly legacyClient: TransmissionClient;
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
  private generation = 0;
  private closed = false;
  private startup = new AbortController();
  private provider = "";
  constructor(
    env: Readonly<NodeJS.ProcessEnv>,
    private readonly deps: CoreDeps,
    private readonly pick: () => Promise<string | null>,
    private readonly generate: (input: string, signal: AbortSignal) => Promise<WorkflowDraftReply>,
    client?: TransmissionClient,
    legacyClient?: TransmissionClient,
  ) {
    this.root = join(stateHome(env), "code60", "workflows");
    this.client =
      client ?? new LocalTransmission(join(this.root, `transmission-${TRANSMISSION_VERSION}`), env);
    this.legacyClient =
      legacyClient ??
      new LocalTransmission(
        join(this.root, `transmission-${LEGACY_TRANSMISSION_VERSION}`),
        env,
        LEGACY_TRANSMISSION_VERSION,
      );
  }
  private engine(record: WorkflowRecord) {
    return record.engineVersion === TRANSMISSION_VERSION ? this.client : this.legacyClient;
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
    await this.release?.();
    this.release = undefined;
  }
  private async load() {
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
  }
  private async save() {
    const next = { format: 1, version: TRANSMISSION_VERSION, entries: this.entries };
    registrySchema.parse(next);
    await writePrivateJson(join(this.root, "registry.json"), next, this.previous, maximum);
    this.previous = structuredClone(next);
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
    try {
      const result = await this.engine(record).call(
        "start_workflow",
        {
          repository: record.worktree,
          tasks: record.definition.tasks,
          confirmed: true,
          idempotencyKey: record.key,
          repairs: record.definition.repairs,
          retries: record.definition.retries,
          autoApprove: record.definition.autoApprove,
        },
        this.startup.signal,
      );
      this.snapshot(record, result);
      await this.save();
      return structuredClone(record);
    } catch {
      record.state = "uncertain";
      await this.save();
      throw new Error(
        "Workflow start is unconfirmed. Keep this worktree and recover the same request; do not create a duplicate.",
      );
    }
  }
  async request(value: unknown): Promise<unknown> {
    const request = parseWorkflowRequest(value);
    if (this.closed) throw new Error("Workflows is closing");
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
    if (request.action === "draft") return this.draft(request);
    if (request.action === "list") {
      await this.load();
      return {
        supported: this.client.supported,
        version: TRANSMISSION_VERSION,
        entries: structuredClone(this.entries),
      };
    }
    const generation = this.generation;
    const run = this.queue.then(async () => {
      if (generation !== this.generation || this.closed) throw new Error("Workflow view changed");
      await this.load();
      return this.handle(request, generation);
    });
    this.queue = run.catch(() => {});
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
      if (!this.client.supported) throw new Error("Transmission execution requires macOS");
      if (JSON.stringify(request.draft).length > 1_000_000)
        throw new Error("Workflow definition exceeds its limit");
      const choice = this.choice(request.draft.repositoryToken, request.formId);
      await this.identity(choice);
      for (const [key, approval] of this.approvals)
        if (approval.formId === request.formId || approval.expires < Date.now())
          this.approvals.delete(key);
      const approvalId = randomUUID();
      this.approvals.set(approvalId, {
        draft: structuredClone(request.draft),
        choice,
        formId: request.formId,
        revision: request.revision,
        expires: Date.now() + 10 * 60_000,
      });
      return { approvalId, repository: choice.path, draft: request.draft };
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
      if (this.entries.length >= 200) throw new Error("Workflow history limit reached");
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
        engineVersion: TRANSMISSION_VERSION,
        repository: approval.choice.path,
        repositoryIdentity: approval.choice.identity,
        repositoryGitIdentity: approval.choice.gitIdentity,
        definition,
        worktree: join(`${approval.choice.path}.worktrees`, `transmission-${id}`),
        worktreeIdentity: "",
        branch: `code60/transmission-${id}`,
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
      // Only the explicit human start/reconnect path may bootstrap the external engine.
      await this.client.connect(this.startup.signal);
      return this.submit(record);
    }
    const record = this.record(request.id);
    const client = this.engine(record);
    if (request.action === "reconnect") {
      await client.connect(this.startup.signal);
      return { connected: true };
    }
    if (request.action === "recover") {
      if (!client.supported) throw new Error("Transmission execution requires macOS");
      if (record.snapshot || !["starting", "uncertain"].includes(record.state))
        throw new Error("Only an unconfirmed dispatch can be recovered");
      return this.submit(record);
    }
    if (request.action === "read") {
      if (!record.snapshot)
        return {
          record: structuredClone(record),
          connected: false,
          error:
            "Start is unconfirmed. Recover the same request after checking engine availability.",
        };
      try {
        if (!client.supported) throw new Error("Transmission execution requires macOS");
        await this.target(record);
        this.snapshot(
          record,
          await client.call("get_workflow", { runId: record.snapshot.runId }, this.startup.signal),
        );
        await this.save();
        return { record: structuredClone(record), connected: true };
      } catch {
        return {
          record: structuredClone(record),
          connected: false,
          error:
            "Status unavailable. The workflow may still be running; the last verified state is retained.",
        };
      }
    }
    if (!record.snapshot) throw new Error("Recover the workflow start first");
    if (!client.supported) throw new Error("Transmission execution requires macOS");
    await this.target(record);
    const runId = record.snapshot.runId;
    if (request.action === "events") {
      const page = workflowEventsSchema.parse(
        await client.call(
          "get_workflow_events",
          { runId, after: request.after },
          this.startup.signal,
        ),
      );
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
      const page = workflowDiffSchema.parse(
        await client.call(
          "get_workflow_diff",
          { runId, offset: request.offset },
          this.startup.signal,
        ),
      );
      if (
        (page.nextOffset !== null && page.nextOffset <= request.offset) ||
        Buffer.from(page.content, "base64").toString("base64") !== page.content
      )
        throw new Error("Invalid accepted diff page");
      return page;
    }
    if (
      (request.action === "pause" || request.action === "resume") &&
      record.engineVersion !== TRANSMISSION_VERSION
    )
      throw new Error("Pause and resume require Transmission staging.20");
    if (record.stopPending && request.action !== "cancel")
      throw new Error("Stop acknowledgement is pending");
    if (request.action === "cancel" && !record.stopPending) {
      record.stopPending = true;
      await this.save();
    }
    const operation = {
      pause: "pause_workflow",
      resume: "resume_workflow",
      cancel: "cancel_workflow",
      answer: "answer_workflow_question",
      message: "send_workflow_message",
    }[request.action];
    const args =
      request.action === "answer"
        ? { runId, questionId: request.questionId, answer: request.answer }
        : request.action === "message"
          ? { runId, message: request.message }
          : { runId };
    this.snapshot(record, await client.call(operation, args, this.startup.signal));
    if (
      request.action === "cancel" &&
      ["cancelled", "completed", "failed"].includes(record.snapshot.status)
    )
      delete record.stopPending;
    await this.save();
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
