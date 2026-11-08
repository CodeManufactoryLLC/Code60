import type {
  AgentSession,
  AgentSpec,
  Agents,
  AgentUpdate,
  PermissionAnswer,
  PermissionHandler,
  PermissionRequest,
  StopReason,
} from "../src/agents/index.js";
import { AgentStartError } from "../src/agents/index.js";
import type { Clock } from "../src/core/clock.js";
import type { Processes } from "../src/core/processes.js";
import type { RecordStore } from "../src/core/records.js";
import type { RunEvent, RunRecord } from "../src/core/types.js";
import type { ChangedFile, Git, GitWorktree, WorktreeSpec } from "../src/git/index.js";

export const flush = async (times = 5) => {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setImmediate(resolve));
};

export class FakeClock implements Clock {
  private t = 0;
  private nextId = 1;
  private timers: { id: number; at: number; callback: () => void }[] = [];

  now(): Date {
    return new Date(Date.UTC(2026, 10, 2, 12, 0, 0) + this.t);
  }
  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.push({ id, at: this.t + ms, callback });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  }
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    for (;;) {
      await flush();
      const due = this.timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.t = due.at;
      due.callback();
    }
    this.t = target;
    await flush();
  }
}

/** What a fake turn does: end with a stop reason, hang, or fail. */
export type TurnScript = (text: string, session: FakeSession) => StopReason | "hang" | Error;

export class FakeSession implements AgentSession {
  readonly sessionId: string;
  readonly exited: Promise<void>;
  readonly prompts: string[] = [];
  readonly stops: (number | undefined)[] = [];
  cancels = 0;
  /** What `cancel()` does to a hanging turn. */
  onCancel: "end" | "ignore" = "end";
  private exit!: () => void;
  private turn: { resolve(r: StopReason): void; reject(e: Error): void } | undefined;
  private listeners = new Set<(u: AgentUpdate) => void>();
  private permissionHandler: PermissionHandler | undefined;
  private permissionAborts = new Set<AbortController>();

  constructor(
    readonly pid: number,
    private readonly script: TurnScript,
    sessionId = `fake-session-${pid}`,
  ) {
    this.sessionId = sessionId;
    this.exited = new Promise((resolve) => {
      this.exit = resolve;
    });
  }

  get turnActive(): boolean {
    return this.turn !== undefined;
  }

  prompt(text: string): Promise<StopReason> {
    if (this.turn !== undefined) return Promise.reject(new Error("a turn is already in progress"));
    this.prompts.push(text);
    return new Promise((resolve, reject) => {
      this.turn = { resolve, reject };
      const result = this.script(text, this);
      if (result instanceof Error) this.failTurn(result);
      else if (result !== "hang") this.endTurn(result);
    });
  }
  endTurn(reason: StopReason): void {
    const turn = this.turn;
    this.turn = undefined;
    turn?.resolve(reason);
  }
  failTurn(error: Error): void {
    const turn = this.turn;
    this.turn = undefined;
    turn?.reject(error);
  }
  async cancel(): Promise<void> {
    this.cancels += 1;
    for (const controller of this.permissionAborts) controller.abort();
    if (this.onCancel === "end") this.endTurn("cancelled");
  }
  async stop(graceMs?: number): Promise<void> {
    this.stops.push(graceMs);
    this.failTurn(new Error("agent exited on signal SIGTERM"));
    this.exit();
  }
  stderrTail(): string {
    return "";
  }
  onUpdate(listener: (u: AgentUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onPermission(handler: PermissionHandler): void {
    this.permissionHandler = handler;
  }
  update(u: AgentUpdate): void {
    for (const listener of this.listeners) listener(u);
  }
  requestPermission(request: PermissionRequest): Promise<PermissionAnswer> {
    const controller = new AbortController();
    this.permissionAborts.add(controller);
    return (this.permissionHandler as PermissionHandler)(request, controller.signal).finally(() =>
      this.permissionAborts.delete(controller),
    );
  }
  /** Simulates the agent process exiting on its own. */
  crash(): void {
    this.failTurn(new Error("agent exited with code 1"));
    this.exit();
  }
}

export class FakeAgents implements Agents {
  readonly sessions: FakeSession[] = [];
  readonly specs: AgentSpec[] = [];
  readonly restores: { spec: AgentSpec; sessionId: string }[] = [];
  private nextPid = 1000;
  startError: Error | undefined;
  restoreError: Error | undefined;
  restoreUnavailable = false;
  /** When set, `start` waits for this before resolving. */
  startGate: Promise<void> | undefined;

  constructor(public script: TurnScript = () => "end_turn") {}

  async start(spec: AgentSpec, signal?: AbortSignal): Promise<AgentSession> {
    this.specs.push(spec);
    if (this.startGate !== undefined) {
      const gate = this.startGate;
      await new Promise<void>((resolve, reject) => {
        gate.then(resolve);
        signal?.addEventListener("abort", () =>
          reject(new AgentStartError("agent start cancelled", "")),
        );
      });
    }
    if (this.startError !== undefined) throw this.startError;
    const session = new FakeSession(this.nextPid++, this.script);
    this.sessions.push(session);
    return session;
  }

  async restore(spec: AgentSpec, sessionId: string, _signal?: AbortSignal): Promise<AgentSession> {
    this.restores.push({ spec, sessionId });
    if (this.restoreUnavailable) throw new Error("ACP session restore is unavailable");
    if (this.restoreError !== undefined) throw this.restoreError;
    const session = new FakeSession(this.nextPid++, this.script, sessionId);
    this.sessions.push(session);
    return session;
  }
}

export class FakeGit implements Git {
  readonly worktrees: WorktreeSpec[] = [];
  listedWorktrees: GitWorktree[] = [];
  readonly removed: { path: string; branch: string }[] = [];
  addError: Error | undefined;
  files: ChangedFile[] = [];

  async repoInfo() {
    return { topLevel: "/repo", commonDir: "/repo/.git" };
  }
  async listWorktrees() {
    return this.listedWorktrees.map((worktree) => ({ ...worktree }));
  }
  async resolveCommit(_repo: string, rev: string) {
    if (rev === "bad") throw new Error("unknown revision 'bad'");
    return "c0ffee";
  }
  async addWorktree(spec: WorktreeSpec) {
    if (this.addError !== undefined) throw this.addError;
    this.worktrees.push(spec);
  }
  async removeWorktree(_repo: string, path: string, branch: string) {
    this.removed.push({ path, branch });
  }
  async diff(_worktree?: string, _base?: string, _signal?: AbortSignal) {
    return "diff --git a/x b/x\n";
  }
  async changedFiles() {
    return this.files;
  }
}

export class MemoryStore implements RecordStore {
  readonly dir = "/memory";
  readonly records = new Map<string, RunRecord>();
  readonly events: RunEvent[] = [];

  async save(record: RunRecord) {
    this.records.set(record.id, structuredClone(record));
  }
  async appendEvent(event: RunEvent) {
    this.events.push(event);
  }
  async read(id: string) {
    const record = this.records.get(id);
    if (record === undefined) throw new Error(`no run with ID '${id}'`);
    return structuredClone(record);
  }
  async readEvents(id: string) {
    return this.events.filter((e) => e.runId === id);
  }
  async list() {
    return [...this.records.values()].map((r) => structuredClone(r));
  }
  statuses(id: string): string[] {
    return this.events
      .filter((e) => e.runId === id && e.type === "status")
      .map((e) => (e as { status: string }).status);
  }
}

export class FakeProcesses implements Processes {
  alive = new Set<number>();
  groups = new Set<number>();
  commandLines = new Map<number, string>();
  signals: { pgid: number; signal: string }[] = [];
  /** Signals the group ignores. */
  ignores = new Set<string>();

  isAlive(pid: number) {
    return this.alive.has(pid);
  }
  groupAlive(pgid: number) {
    return this.groups.has(pgid);
  }
  async commandLine(pid: number) {
    return this.commandLines.get(pid);
  }
  signalGroup(pgid: number, signal: NodeJS.Signals) {
    this.signals.push({ pgid, signal });
    if (!this.ignores.has(signal)) this.groups.delete(pgid);
  }
}
