import { randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  type AgentSession,
  type AgentSpec,
  AgentStartError,
  type Agents,
  type PermissionAnswer,
  type PermissionRequest,
} from "../agents/index.js";
import type { WorkflowEvent, WorkflowSnapshot } from "../contracts/index.js";
import {
  resolveWorkflowRepository,
  snapshotWorkflowTree,
  writeWorkflowPatch,
} from "./workflow-repository.js";

z.config({ jitless: true });

export class WorkflowProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowProviderError";
  }
}

const text = z.string().trim().min(1).max(65_536);
const providerSchema = z.string().trim().min(1).max(128);
const taskSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  instructions: text,
  verify: text,
  checks: z.array(text).max(30).optional(),
});
const planSchema = z.strictObject({
  repository: text,
  provider: providerSchema,
  tasks: z.array(taskSchema).min(1).max(100),
  confirmed: z.literal(true),
  idempotencyKey: z.string().min(1).max(256),
  repairs: z.number().int().min(0).max(30).default(2),
  retries: z.number().int().min(0).max(30).default(2),
  autoApprove: z.boolean().default(true),
});
type WorkflowEnginePlan = z.output<typeof planSchema>;
export type WorkflowEnginePlanInput = z.input<typeof planSchema>;

const checkEvidenceSchema = z.object({
  command: text,
  passed: z.boolean(),
  evidence: text,
});
const workerReplySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("result"), summary: text }),
  z.object({ kind: z.literal("question"), question: text }),
]);
const verifierReplySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("verdict"),
    decision: z.enum(["accept", "reject"]),
    reason: text,
    checks: z.array(checkEvidenceSchema).optional(),
  }),
  z.object({ kind: z.literal("question"), question: text }),
]);

type Status = WorkflowSnapshot["status"];
type TaskState = WorkflowSnapshot["tasks"][number]["state"];
type Accepted = WorkflowSnapshot["accepted"][number];
type Question = NonNullable<WorkflowSnapshot["decision"]>;

interface StoredRun {
  id: string;
  plan: WorkflowEnginePlan;
  initialPlan?: WorkflowEnginePlan;
  planRevision?: number;
  baseline: string;
  index: number;
  status: Status;
  phase: "worker" | "verifier";
  accepted: Accepted[];
  generation: number;
  repairsUsed: number;
  worker?: string;
  verifier?: string;
  candidate?: { summary: string; revision: string };
  feedback: string;
  messages: string[];
  question?: Question;
  questionKind?: "scope" | "permission";
  guidance: string[];
  formatErrors: number;
  lastAnswer?: { id: string; answer: string };
  failure?: string;
  attempts: string[];
}

interface ManagedSession {
  session: AgentSession;
  unsubscribe: () => void;
  output: string;
  messageId: string | null | undefined;
  sawToolCall: boolean;
}

interface RunSessions {
  worker?: ManagedSession;
  verifier?: ManagedSession;
}

type PendingDecision = { id: string; resolve: (value: string | undefined) => void };

export type WorkflowProviderResolver = (providerId: string, cwd: string) => AgentSpec;

const isTerminal = (status: Status): boolean =>
  status === "completed" || status === "failed" || status === "cancelled";

const diagnostic = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function extractTrailingJsonObject(raw: string): string | undefined {
  if (!raw.endsWith("}")) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  let lastStart = -1;
  let lastEnd = -1;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          lastStart = start;
          lastEnd = i;
          start = -1;
        }
      }
    }
  }
  if (lastStart !== -1 && lastEnd === raw.length - 1) {
    return raw.slice(lastStart, lastEnd + 1);
  }
  return undefined;
}

export function parseWorkflowAgentJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const stripped = trimmed.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  if (stripped !== trimmed) {
    try {
      return JSON.parse(stripped);
    } catch {
      /* fall through */
    }
  }
  const lines = stripped
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines.at(-1);
  if (last) {
    try {
      return JSON.parse(last);
    } catch {
      /* fall through */
    }
  }
  const fences = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/g)];
  for (let i = fences.length - 1; i >= 0; i--) {
    const block = fences[i]?.[1]?.trim();
    if (!block) continue;
    try {
      return JSON.parse(block);
    } catch {
      /* fall through */
    }
  }
  const trailing = extractTrailingJsonObject(trimmed);
  if (trailing) {
    try {
      return JSON.parse(trailing);
    } catch {
      /* fall through */
    }
  }
  return undefined;
}

function taskState(run: StoredRun, index: number): TaskState {
  if (index < run.index) return "accepted";
  if (index > run.index) return "pending";
  switch (run.status) {
    case "running":
      if (run.phase === "verifier") return "verifying";
      return run.repairsUsed > 0 ? "repairing" : "implementing";
    case "completed":
      return "accepted";
    default:
      return run.status;
  }
}

/**
 * In-process deterministic workflow engine backed by private SQLite state and Code60's ACP Agents.
 * Each task runs in a fresh worker session and is verified in a separate independent verifier session.
 */
export class WorkflowEngine {
  private readonly db: DatabaseSync;
  private readonly runs = new Map<string, StoredRun>();
  private readonly pumps = new Map<string, Promise<void>>();
  private readonly sessions = new Map<string, RunSessions>();
  private readonly pending = new Map<string, PendingDecision>();
  private readonly disposals = new Map<string, Promise<void>>();
  private readonly pauses = new Map<string, Promise<WorkflowSnapshot>>();
  private readonly settling = new Set<string>();
  private readonly shutdown = new AbortController();
  private closing = false;

  constructor(
    readonly stateDir: string,
    private readonly agents: Agents,
    private readonly resolveProvider: WorkflowProviderResolver,
  ) {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(stateDir, "workflows.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, caller_key TEXT UNIQUE NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY, run TEXT NOT NULL, time TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS by_run ON events(run,sequence);`);
    for (const row of this.db.prepare("SELECT body FROM runs").all()) {
      const r = JSON.parse(String(row.body)) as StoredRun;
      this.runs.set(r.id, r);
      if (isTerminal(r.status)) continue;
      if (r.status === "pausing" || r.status === "paused") {
        this.withdrawPermission(r);
        this.retireSessions(r);
        const interrupted = r.status === "pausing";
        r.status = "paused";
        if (interrupted) this.save(r, "paused");
        continue;
      }
      if (r.worker || r.verifier) {
        this.retireSessions(r);
        r.feedback +=
          "\nCode60 restarted. Inspect existing work and the outcome of consequential actions before repeating them. Ask if their outcome cannot be determined.";
        this.save(r, "task_resumed", { task: r.plan.tasks[r.index]?.name ?? "" });
      }
      this.wake(r);
    }
  }

  private runDir(r: StoredRun): string {
    return join(this.stateDir, r.id);
  }

  private save(r: StoredRun, kind: string, detail: object = {}): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("INSERT INTO runs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body")
        .run(r.id, r.plan.idempotencyKey, JSON.stringify(r));
      this.event(r, kind, detail);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private event(r: StoredRun, kind: string, detail: object): void {
    this.db
      .prepare("INSERT INTO events(run,time,kind,detail) VALUES(?,?,?,?)")
      .run(
        r.id,
        new Date().toISOString(),
        kind,
        JSON.stringify({ ...detail, planRevision: r.planRevision ?? 0 }),
      );
  }

  private getRun(id: string): StoredRun {
    const r = this.runs.get(id);
    if (!r) throw new Error("Unknown workflow.");
    return r;
  }

  start(input: WorkflowEnginePlanInput): WorkflowSnapshot {
    if (this.closing) throw new Error("Workflow engine is stopping.");
    const plan = planSchema.parse(input, { jitless: true });
    const root = resolveWorkflowRepository(plan.repository);
    const normalizedPlan: WorkflowEnginePlan = { ...plan, repository: root };

    const prior = this.db
      .prepare("SELECT id FROM runs WHERE caller_key=?")
      .get(plan.idempotencyKey);
    if (prior) {
      const r = this.getRun(String(prior.id));
      const original = r.initialPlan ?? r.plan;
      if (!isDeepStrictEqual(jsonCopy(original), jsonCopy(normalizedPlan))) {
        throw new Error("This key belongs to a different workflow.");
      }
      return this.status(r.id);
    }

    const canonicalState = realpathSync(this.stateDir);
    if (canonicalState === root || canonicalState.startsWith(root + sep)) {
      throw new Error("Keep workflow state outside the target repository.");
    }
    if (
      [...this.runs.values()].some(
        (r) => (!isTerminal(r.status) || this.settling.has(r.id)) && r.plan.repository === root,
      )
    ) {
      throw new Error("A workflow is already active in this project.");
    }

    // Validate provider availability synchronously before creating run state.
    this.resolveProvider(plan.provider, root);

    const id = randomUUID();
    const r: StoredRun = {
      id,
      plan: normalizedPlan,
      planRevision: 0,
      baseline: snapshotWorkflowTree(root, join(this.stateDir, id)),
      index: 0,
      status: "running",
      phase: "worker",
      generation: 0,
      repairsUsed: 0,
      feedback: "",
      messages: [],
      guidance: [],
      formatErrors: 0,
      accepted: [],
      attempts: [],
    };
    this.save(r, "started", { provider: plan.provider });
    this.runs.set(id, r);
    this.wake(r);
    return this.status(id);
  }

  status(id: string): WorkflowSnapshot {
    const row = this.db
      .prepare(
        "SELECT body, (SELECT MAX(sequence) FROM events WHERE run = runs.id) AS cursor FROM runs WHERE id = ?",
      )
      .get(id);
    if (!row) throw new Error("Unknown workflow.");
    const r = JSON.parse(String(row.body)) as StoredRun;
    const lastAccepted = r.accepted.at(-1);
    return {
      runId: id,
      provider: r.plan.provider,
      planRevision: r.planRevision ?? 0,
      status: r.status,
      tasks: r.plan.tasks.map(({ name }, index) => ({
        index,
        name,
        state: taskState(r, index),
      })),
      activeTaskIndex: isTerminal(r.status) ? null : r.index,
      eventCursor: Number(row.cursor ?? 0),
      ...(r.plan.tasks[r.index] ? { task: r.plan.tasks[r.index]?.name } : {}),
      ...(isTerminal(r.status) ? {} : { phase: r.phase }),
      accepted: r.accepted,
      ...(r.question ? { decision: r.question } : {}),
      ...(r.failure ? { reason: r.failure } : {}),
      attempts: r.attempts,
      ...(r.status === "completed" && lastAccepted
        ? { result: lastAccepted.result, verdict: lastAccepted.verdict }
        : {}),
    };
  }

  events(id: string, after: number): WorkflowEvent[] {
    this.getRun(id);
    return this.db
      .prepare(
        "SELECT sequence,time,kind,detail FROM events WHERE run=? AND sequence>? ORDER BY sequence LIMIT 100",
      )
      .all(id, after)
      .map((e) => ({
        sequence: Number(e.sequence),
        time: String(e.time),
        kind: String(e.kind),
        detail: JSON.parse(String(e.detail)) as Record<string, unknown>,
      }));
  }

  diff(
    id: string,
    offset: number,
  ): { content: string; nextOffset: number | null; revision?: string } {
    const r = this.getRun(id);
    const rev = r.accepted.at(-1)?.revision;
    if (!rev) return { content: "", nextOffset: null };
    const patchPath = join(this.runDir(r), `${rev}.patch`);
    const fd = openSync(patchPath, "r");
    try {
      const size = fstatSync(fd).size;
      const buf = Buffer.alloc(Math.max(0, Math.min(size - offset, 65_536)));
      const n = readSync(fd, buf, 0, buf.length, offset);
      return {
        content: buf.subarray(0, n).toString("base64"),
        nextOffset: offset + n < size ? offset + n : null,
        revision: rev,
      };
    } finally {
      closeSync(fd);
    }
  }

  answer(id: string, questionId: string, answer: string): WorkflowSnapshot {
    const r = this.getRun(id);
    if (r.lastAnswer?.id === questionId && r.lastAnswer.answer === answer) {
      return this.status(id);
    }
    if (!["needs_input", "pausing", "paused"].includes(r.status) || r.question?.id !== questionId) {
      throw new Error("This decision is no longer pending.");
    }
    if (r.question.options && !r.question.options.some((opt) => opt.id === answer)) {
      throw new Error("Select one of the offered option IDs.");
    }
    const q = r.question;
    const p = this.pending.get(id);
    delete r.question;
    delete r.questionKind;
    r.lastAnswer = { id: questionId, answer };
    if (r.status === "needs_input") r.status = "running";
    if (!p || p.id !== q.id) {
      r.guidance.push(`Decision: ${q.text}\nUser answer: ${answer}`);
    }
    this.save(r, "answered", { question: q, answer });
    this.pending.delete(id);
    p?.resolve(answer);
    this.wake(r);
    return this.status(id);
  }

  message(id: string, message: string): WorkflowSnapshot {
    const r = this.getRun(id);
    if (isTerminal(r.status)) throw new Error("Workflow has ended.");
    r.messages.push(message);
    r.guidance.push(message);
    this.save(r, "message", { message });
    return this.status(id);
  }

  pause(id: string): Promise<WorkflowSnapshot> {
    const r = this.getRun(id);
    if (this.closing) throw new Error("Workflow engine is stopping.");
    if (isTerminal(r.status)) throw new Error("Workflow has ended.");
    const prior = this.pauses.get(id);
    if (prior) return prior;
    if (r.status === "paused") return Promise.resolve(this.status(id));
    if (r.status !== "pausing") {
      r.status = "pausing";
      this.withdrawPermission(r);
      this.save(r, "pause_requested");
    }
    const work = Promise.resolve()
      .then(async () => {
        await this.dispose(r);
        await this.pumps.get(id);
        if (r.status === "pausing") {
          this.retireSessions(r);
          r.status = "paused";
          this.save(r, "paused");
        }
        return this.status(id);
      })
      .finally(() => {
        this.pauses.delete(id);
      });
    this.pauses.set(id, work);
    return work;
  }

  resume(id: string): WorkflowSnapshot {
    const r = this.getRun(id);
    if (this.closing) throw new Error("Workflow engine is stopping.");
    if (isTerminal(r.status)) throw new Error("Workflow has ended.");
    if (r.status === "pausing") throw new Error("Workflow is still pausing.");
    if (r.status !== "paused") return this.status(id);
    this.retireSessions(r);
    r.feedback +=
      "\nWorkflow resumed after an operator pause. Inspect existing work and the outcome of consequential actions before repeating them. Ask if their outcome cannot be determined.";
    r.status = r.question ? "needs_input" : "running";
    this.save(r, "resumed");
    this.wake(r);
    return this.status(id);
  }

  async cancel(id: string): Promise<WorkflowSnapshot> {
    const r = this.getRun(id);
    if (!isTerminal(r.status)) {
      r.status = "cancelled";
      delete r.question;
      delete r.questionKind;
      this.save(r, "cancelled");
    }
    if (r.status === "cancelled") {
      this.settling.add(id);
      try {
        await this.dispose(r);
        await this.pumps.get(id);
      } finally {
        this.settling.delete(id);
      }
    }
    return this.status(id);
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.shutdown.abort();
    await Promise.all([...this.runs.values()].map((r) => this.dispose(r).catch(() => {})));
    await Promise.all([...this.pumps.values()].map((p) => p.catch(() => {})));
    await Promise.all([...this.pauses.values()].map((p) => p.catch(() => {})));
    this.db.close();
  }

  private withdrawPermission(r: StoredRun): void {
    if (r.questionKind === "permission" || r.question?.options) {
      delete r.question;
      delete r.questionKind;
    }
  }

  private retireSessions(r: StoredRun): void {
    delete r.worker;
    delete r.verifier;
    delete r.candidate;
    r.phase = "worker";
    r.formatErrors = 0;
  }

  private async stopManaged(managed: ManagedSession | undefined): Promise<void> {
    if (!managed) return;
    managed.unsubscribe();
    await managed.session.cancel().catch(() => {});
    await managed.session.stop(1_500);
  }

  private dispose(r: StoredRun): Promise<void> {
    const prior = this.disposals.get(r.id);
    if (prior) return prior;
    this.pending.get(r.id)?.resolve(undefined);
    this.pending.delete(r.id);
    const active = this.sessions.get(r.id);
    this.sessions.delete(r.id);
    const work = Promise.resolve()
      .then(async () => {
        if (!active) return;
        await Promise.all([this.stopManaged(active.worker), this.stopManaged(active.verifier)]);
      })
      .catch((error) => {
        if (active) this.sessions.set(r.id, active);
        throw error;
      })
      .finally(() => {
        this.disposals.delete(r.id);
      });
    this.disposals.set(r.id, work);
    return work;
  }

  private wake(r: StoredRun): void {
    if (this.closing || r.status !== "running" || this.pumps.has(r.id)) return;
    const work = Promise.resolve()
      .then(() => this.drive(r))
      .finally(() => {
        this.pumps.delete(r.id);
        this.wake(r);
      });
    this.pumps.set(r.id, work);
  }

  private failFatal(r: StoredRun, reason: string): void {
    r.attempts.push(reason);
    this.retireSessions(r);
    delete r.question;
    delete r.questionKind;
    r.failure = reason;
    r.status = "failed";
    this.save(r, "attempt_ended", {
      reason,
      next: r.status,
      retriesUsed: r.generation,
    });
  }

  private restart(r: StoredRun, reason: string): void {
    r.attempts.push(reason);
    this.retireSessions(r);
    r.repairsUsed = 0;
    delete r.question;
    delete r.questionKind;
    if (r.generation >= r.plan.retries) {
      r.failure = `${reason} Fresh-session retry limit reached.`;
      r.status = "failed";
    } else {
      r.generation++;
      r.feedback = `${reason} Inspect existing work before continuing.`;
      r.status = "running";
    }
    this.save(r, "attempt_ended", {
      reason,
      next: r.status,
      retriesUsed: r.generation,
    });
  }

  private ask(r: StoredRun, question: Question, kind: "scope" | "permission" = "scope"): void {
    r.question = question;
    r.questionKind = kind;
    r.status = "needs_input";
    this.save(r, "needs_input", question);
  }

  private async ensureSession(r: StoredRun, role: "worker" | "verifier"): Promise<ManagedSession> {
    let bucket = this.sessions.get(r.id);
    if (!bucket) {
      bucket = {};
      this.sessions.set(r.id, bucket);
    }
    const existing = bucket[role];
    if (existing && r[role] === existing.session.sessionId) return existing;
    if (existing) {
      delete bucket[role];
      await this.stopManaged(existing).catch(() => {});
    }

    const spec = this.resolveProvider(r.plan.provider, r.plan.repository);
    const session = await this.agents.start(
      { ...spec, cwd: r.plan.repository, mcpServers: [] },
      this.shutdown.signal,
    );
    const managed: ManagedSession = {
      session,
      unsubscribe: () => {},
      output: "",
      messageId: undefined,
      sawToolCall: false,
    };

    const isOwned = () => this.sessions.get(r.id)?.[role] === managed;

    managed.unsubscribe = session.onUpdate((update) => {
      if (!isOwned()) return;
      if (update.type === "message") {
        if (update.messageId && managed.messageId !== update.messageId) {
          managed.output = "";
          managed.sawToolCall = false;
        } else if (managed.sawToolCall && managed.output && !managed.output.endsWith("\n")) {
          managed.output += "\n";
        }
        managed.sawToolCall = false;
        managed.messageId = update.messageId;
        managed.output = (managed.output + update.text).slice(-256 * 1024);
      } else if (update.type === "toolCall") {
        managed.sawToolCall = true;
        this.event(r, "tool", {
          session: session.sessionId,
          detail: [update.toolCallId, update.kind, update.title, update.status]
            .filter(Boolean)
            .join(" ")
            .slice(0, 1600),
        });
      }
    });

    session.onPermission(
      async (request: PermissionRequest, signal: AbortSignal): Promise<PermissionAnswer> => {
        if (r.status !== "running" || this.closing || !isOwned() || signal.aborted) {
          return "deny";
        }
        const options = request.options ?? [];
        if (r.plan.autoApprove) {
          const approved =
            options.find((o) => o.kind === "allow_once") ??
            options.find((o) => o.kind === "allow_always");
          if (approved) {
            this.event(r, "permission", {
              session: session.sessionId,
              selected: approved.optionId,
            });
            return { optionId: approved.optionId };
          }
          if (options.length === 0) {
            this.event(r, "permission", {
              session: session.sessionId,
              selected: "allow",
            });
            return "allow";
          }
        }
        const question: Question = {
          id: randomUUID(),
          text: request.title || "Choose an agent permission.",
          ...(options.length > 0
            ? { options: options.map((o) => ({ id: o.optionId, name: o.name })) }
            : {}),
        };
        this.ask(r, question, "permission");
        const selected = await new Promise<string | undefined>((resolve) => {
          const onAbort = () => {
            if (this.pending.get(r.id)?.id === question.id) this.pending.delete(r.id);
            resolve(undefined);
          };
          signal.addEventListener("abort", onAbort, { once: true });
          this.pending.set(r.id, {
            id: question.id,
            resolve: (value) => {
              signal.removeEventListener("abort", onAbort);
              resolve(value);
            },
          });
        });
        if (!selected) return "deny";
        if (options.some((o) => o.optionId === selected)) {
          return { optionId: selected };
        }
        return selected === "allow" ? "allow" : "deny";
      },
    );

    // If paused/cancelled/closed while starting the session, clean up immediately.
    if (this.closing || r.status !== "running") {
      await this.stopManaged(managed).catch(() => {});
      throw new Error("Workflow interrupted during session startup.");
    }

    bucket[role] = managed;
    r[role] = session.sessionId;
    const task = r.plan.tasks[r.index];
    this.save(r, "session_started", {
      role,
      session: session.sessionId,
      task: task?.name ?? "",
      generation: r.generation,
    });
    return managed;
  }

  private async runTurn(managed: ManagedSession, promptText: string): Promise<string> {
    managed.output = "";
    managed.messageId = undefined;
    managed.sawToolCall = false;
    const stopReason = await Promise.race([
      managed.session.prompt(promptText),
      managed.session.exited.then(() => {
        throw new Error("Agent process exited unexpectedly.");
      }),
    ]);
    if (stopReason !== "end_turn") {
      throw new Error(`Agent stopped: ${stopReason}`);
    }
    return managed.output;
  }

  private async drive(r: StoredRun): Promise<void> {
    try {
      while (!this.closing && r.status === "running") {
        const role = r.phase;
        const task = r.plan.tasks[r.index];
        if (!task) break;

        const managed = await this.ensureSession(r, role);
        if (this.closing || r.status !== "running") return;

        const sessionId = managed.session.sessionId;
        const messages = [...r.messages];
        const data = {
          task:
            role === "verifier"
              ? task
              : {
                  name: task.name,
                  instructions: task.instructions,
                  checks: task.checks,
                },
          incoming: messages,
          priorTasks: r.accepted.slice(-8).map((a) => ({
            name: a.name,
            result: a.result.slice(0, 4096),
          })),
          feedback: r.feedback,
          operatorGuidance: r.guidance.join("\n").slice(-65_536),
          ...(role === "verifier" ? { candidate: r.candidate } : {}),
        };
        const instructions =
          role === "worker"
            ? 'Implement the assigned task using your normal tools in this project. Preserve prior edits, HEAD and staging. Install dependencies and run the relevant checks. Finish commands and stop temporary background services before submitting. Act on feedback from independent review. End with one line of JSON: {"kind":"result","summary":"result and executed checks"}.'
            : 'Independently verify the candidate in the current repository against the verification prompt. Inspect and test it yourself. Leave the source unchanged. If task.checks are specified, run each command with your own harness and include a checks array in the final JSON with command (exact), passed (boolean), and evidence (observed output) for each. End with one line of JSON: {"kind":"verdict","decision":"accept" or "reject","reason":"specific evidence or actionable repair instructions"}.';

        this.save(r, "turn_started", { role, session: sessionId, task: task.name });
        const raw = await this.runTurn(
          managed,
          `${instructions} Only for a genuine decision about intent or scope, end with {"kind":"question","question":"decision needed"}.\n${JSON.stringify(data)}`,
        );
        if (this.closing || r.status !== "running") return;

        // Retain messages until a turn consumes them successfully.
        r.messages.splice(0, messages.length);

        const value = parseWorkflowAgentJson(raw);
        const reply =
          role === "worker"
            ? workerReplySchema.safeParse(value, { jitless: true })
            : verifierReplySchema.safeParse(value, { jitless: true });

        if (!reply.success && role === "verifier" && r.formatErrors < r.plan.repairs) {
          r.formatErrors++;
          r.feedback =
            "Your verdict could not be parsed. Return the specified JSON verdict and evidence.";
          this.save(r, "invalid_verdict", { session: sessionId });
          continue;
        }
        if (!reply.success && role === "verifier") {
          this.restart(r, "The verifier did not return a valid verdict.");
          await this.dispose(r);
          return;
        }
        if (!reply.success) {
          await this.repair(r, `Invalid ${role} response. Return the requested final JSON object.`);
          continue;
        }

        r.formatErrors = 0;
        const v = reply.data;
        if (v.kind === "question") {
          this.ask(r, { id: randomUUID(), text: v.question });
          return;
        }

        const revision = snapshotWorkflowTree(r.plan.repository, this.runDir(r));
        if (v.kind === "result") {
          r.candidate = { summary: v.summary, revision };
          delete r.verifier;
          const bucket = this.sessions.get(r.id);
          if (bucket?.verifier) {
            const oldVerifier = bucket.verifier;
            delete bucket.verifier;
            await this.stopManaged(oldVerifier).catch(() => {});
          }
          r.phase = "verifier";
          r.feedback = "";
          this.save(r, "submitted", { session: sessionId, revision, summary: v.summary });
          continue;
        }

        const candidate = r.candidate;
        if (!candidate) {
          this.restart(r, "Missing candidate summary during verification.");
          await this.dispose(r);
          return;
        }
        const missing = task.checks?.filter(
          (command) => !v.checks?.some((c) => c.command === command && c.passed),
        );
        let decision = v.decision;
        let reason = v.reason;
        if (decision === "accept" && missing?.length) {
          decision = "reject";
          reason = `Missing passing verifier evidence for ${missing.join(", ")}. ${reason}`;
        }
        this.save(r, "verdict", {
          worker: r.worker,
          verifier: sessionId,
          revision: candidate.revision,
          kind: "verdict",
          decision,
          reason,
          ...(v.checks ? { checks: v.checks } : {}),
        });
        if (
          decision === "reject" ||
          candidate.revision !== revision ||
          r.messages.length ||
          messages.length
        ) {
          await this.repair(
            r,
            decision === "reject"
              ? reason
              : candidate.revision !== revision
                ? "Source changed during verification. Submit the current candidate."
                : `Address user guidance before resubmitting: ${[...messages, ...r.messages].join("\n")}`,
          );
          continue;
        }

        const accepted: Accepted = {
          name: task.name,
          result: candidate.summary,
          revision,
          worker: r.worker ?? "",
          verifier: sessionId,
          verdict: {
            decision,
            reason,
            ...(v.checks ? { checks: v.checks } : {}),
          },
        };
        const patchPath = join(this.runDir(r), `${revision}.patch`);
        const tmpPath = `${patchPath}.tmp`;
        const fd = openSync(tmpPath, "w", 0o600);
        try {
          try {
            writeWorkflowPatch(r.plan.repository, this.runDir(r), r.baseline, revision, fd);
          } finally {
            closeSync(fd);
          }
          renameSync(tmpPath, patchPath);
        } finally {
          rmSync(tmpPath, { force: true });
        }

        r.accepted.push(accepted);
        r.guidance = [];
        r.index++;
        r.phase = "worker";
        r.feedback = "";
        r.repairsUsed = 0;
        r.generation = 0;
        delete r.worker;
        delete r.verifier;
        delete r.candidate;
        if (r.index === r.plan.tasks.length) {
          r.status = "completed";
        }
        this.save(r, "task_accepted", accepted);
        await this.dispose(r);
      }
    } catch (error) {
      if (this.closing || isTerminal(r.status) || r.status === "pausing" || r.status === "paused") {
        return;
      }
      if (
        error instanceof WorkflowProviderError ||
        (error instanceof AgentStartError && error.authRequired)
      ) {
        this.failFatal(r, diagnostic(error));
        await this.dispose(r);
        return;
      }
      this.restart(r, diagnostic(error));
      await this.dispose(r);
    }
  }

  private async repair(r: StoredRun, reason: string): Promise<void> {
    if (r.repairsUsed >= r.plan.repairs) {
      this.restart(r, reason);
      await this.dispose(r);
      return;
    }
    r.repairsUsed++;
    r.attempts.push(reason);
    r.feedback = reason;
    r.phase = "worker";
    delete r.verifier;
    const bucket = this.sessions.get(r.id);
    if (bucket?.verifier) {
      const oldVerifier = bucket.verifier;
      delete bucket.verifier;
      await this.stopManaged(oldVerifier).catch(() => {});
    }
    this.save(r, "repair_requested", { worker: r.worker, reason });
  }
}
