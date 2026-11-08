import { randomUUID } from "node:crypto";
import { MCP_CONTROL_LIMITS, type SequencedEvent } from "../bridge/index.js";
import { ACTIVE_STATUSES, type Orchestrator, type RunEvent, type RunView } from "../core/index.js";
import { diagnosticMessage } from "../platform/index.js";
import { ActivityDisplay } from "./activity-display.js";
import type { WorkerUpdate } from "./mcp-control.js";
import type { McpGateway } from "./mcp-gateway.js";

const message = diagnosticMessage;

/** A worker run dispatched by the orchestration chat. Ownership is held only in memory. */
export interface Worker {
  /** The chat generation that dispatched it; only that chat may control it. */
  generation: number;
  directory: string;
  provider: string;
  /** The last turn already reported to the chat, so each turn wakes it at most once. */
  reportedTurn: number;
  /** The tail of the reply in the current turn. */
  reply: string;
}

/** Automatic updates sent to the chat in one prompt, at most. */
const UPDATE_BATCH = 20;

/** All mutable state and capabilities belong to one orchestration conversation. */
export class ChatSession {
  reviewTask: { title: string; turn: number; reviewId?: string } | undefined;
  revoked = false;
  chat: Orchestrator | undefined;
  chatDirectory: string | null = null;
  chatError: string | null = null;
  chatEvents: SequencedEvent[] = [];
  chatPending: SequencedEvent[] = [];
  chatDisposers: (() => void)[] = [];
  mcpGateway: McpGateway | undefined;
  dispatches = new Map<string, { key: string; result: Promise<unknown> }>();
  workerScope = randomUUID();
  inbox: WorkerUpdate[] = [];
  updatesPaused = false;

  readonly activity: ActivityDisplay;
  constructor(
    readonly chatGeneration: number,
    changed: () => void = () => {},
  ) {
    this.activity = new ActivityDisplay({ changed });
  }
}

interface CoordinationDeps {
  hasPendingFeedback?(session: ChatSession): boolean;
  directory(): string | undefined;
  view(id: string): RunView | undefined;
  closing(): boolean;
  changed(): void;
  formatUpdates(updates: WorkerUpdate[]): string;
  deliver(session: ChatSession, text: string, origin?: "automatic"): void;
}

/** In-memory conversation authority and delivery; process lifecycle stays in the controller. */
export class ConversationCoordinator {
  private generation = 0;
  current: ChatSession;
  sessions: ChatSession[];
  private readonly registry = new Map<string, Worker>();
  private updateTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: CoordinationDeps) {
    this.current = new ChatSession(0, deps.changed);
    this.sessions = [this.current];
  }

  get workers(): ReadonlyMap<string, Worker> {
    return this.registry;
  }

  create(): ChatSession {
    const session = new ChatSession(++this.generation, this.deps.changed);
    this.sessions.push(session);
    this.current = session;
    return session;
  }

  replace(previous?: ChatSession): ChatSession {
    const session = new ChatSession(++this.generation, this.deps.changed);
    if (previous) this.sessions.splice(this.sessions.indexOf(previous), 1, session);
    else this.sessions = [session];
    this.current = session;
    return session;
  }

  assertCurrent(session: ChatSession): void {
    if (session.revoked || !this.sessions.includes(session))
      throw new Error("This orchestration chat is no longer current");
  }

  requireScope(scope: string, session: ChatSession): void {
    this.assertCurrent(session);
    if (!this.deps.directory())
      throw new Error("Open a project in Code60 before dispatching workers");
    if (scope !== session.workerScope)
      throw new Error("The scope token is stale; call code60_get_context again");
  }

  ownedWorker(id: string, session: ChatSession): Worker {
    this.assertCurrent(session);
    const worker = this.registry.get(id);
    if (
      !worker ||
      worker.generation !== session.chatGeneration ||
      worker.directory !== this.deps.directory()
    )
      throw new Error("No worker with this ID was dispatched by this chat in the open project");
    return worker;
  }

  register(id: string, session: ChatSession, directory: string, provider: string): void {
    this.registry.set(id, {
      generation: session.chatGeneration,
      directory,
      provider,
      reportedTurn: -1,
      reply: "",
    });
  }

  liveWorkerCount(session: ChatSession): number {
    return [...this.registry].filter(([id, worker]) => {
      const status = this.deps.view(id)?.status;
      return worker.generation === session.chatGeneration && status && ACTIVE_STATUSES.has(status);
    }).length;
  }

  assertCapacity(session: ChatSession, maxParallel: number): void {
    this.assertCurrent(session);
    if (this.liveWorkerCount(session) >= maxParallel)
      throw new Error(
        `All ${maxParallel} worker slots are in use. Finish or stop an idle worker first.`,
      );
  }

  deduplicate(
    session: ChatSession,
    requestId: string,
    key: string,
    start: () => Promise<unknown>,
  ): Promise<unknown> {
    const previous = session.dispatches.get(requestId);
    if (previous)
      return previous.key === key
        ? previous.result
        : Promise.reject(new Error("This requestId was already used with other arguments"));
    const result = start();
    session.dispatches.set(requestId, { key, result });
    void result.catch(() => {
      if (session.dispatches.get(requestId)?.result === result)
        session.dispatches.delete(requestId);
    });
    return result;
  }

  send(session: ChatSession, text: string, origin?: "automatic"): void {
    this.assertCurrent(session);
    const run = session.chat?.runs()[0];
    if (!run || !session.chat) throw new Error("No orchestration session is available");
    // The core retains the authoritative readiness checks and their existing errors.
    this.deps.deliver(session, text, origin);
    if (origin === undefined) session.updatesPaused = false;
  }

  pause(session: ChatSession): void {
    session.updatesPaused = true;
    session.activity.stop();
  }
  resume(session: ChatSession): void {
    session.updatesPaused = false;
    this.scheduleUpdates();
  }

  rotateScopes(): void {
    for (const session of this.sessions) {
      session.workerScope = randomUUID();
      session.activity.invalidate();
    }
  }

  revoke(session: ChatSession): void {
    session.revoked = true;
    session.activity.invalidate();
    session.workerScope = randomUUID();
    session.inbox = [];
    session.dispatches.clear();
  }

  stop(): void {
    if (this.updateTimer !== undefined) clearTimeout(this.updateTimer);
    this.updateTimer = undefined;
    for (const session of this.sessions) {
      session.inbox = [];
      session.activity.invalidate();
    }
  }

  /** Queues one update per ended or failed worker turn; streamed chunks never wake the chat. */
  trackWorker(event: RunEvent): void {
    const worker = this.registry.get(event.runId);
    if (!worker) return;
    if (event.type === "prompt") {
      worker.reply = "";
      return;
    }
    if (event.type === "message") {
      worker.reply = `${worker.reply}${event.text}`.slice(-MCP_CONTROL_LIMITS.excerpt);
      return;
    }
    const session = this.sessions.find((session) => session.chatGeneration === worker.generation);
    if (event.type !== "status" || !session) return;
    const view = this.deps.view(event.runId);
    const turn = view?.turns ?? worker.reportedTurn;
    const ended = !ACTIVE_STATUSES.has(event.status);
    const turnEnded = event.status === "idle" ? event.reason?.startsWith("turn ") === true : ended;
    const exited = ended && event.reason === "the agent exited while idle";
    if (!(turnEnded && turn > worker.reportedTurn) && !exited) return;
    worker.reportedTurn = turn;
    session.inbox.push({
      runId: event.runId,
      provider: worker.provider,
      status: event.status,
      turn,
      ...(view?.lastStopReason === undefined ? {} : { stopReason: view.lastStopReason }),
      ...(ended && event.reason !== undefined ? { reason: event.reason } : {}),
      excerpt: worker.reply,
    });
    this.scheduleUpdates();
  }

  scheduleUpdates(): void {
    if (this.updateTimer !== undefined || this.deps.closing()) return;
    // A short delay coalesces several workers ending together into one prompt.
    this.updateTimer = setTimeout(() => {
      this.updateTimer = undefined;
      for (const session of this.sessions) this.deliverUpdates(session);
    }, 50);
  }

  /** Sends queued worker updates only between the chat's turns, never overlapping a prompt. */
  private deliverUpdates(session: ChatSession): void {
    if (this.deps.hasPendingFeedback?.(session)) return;
    if (this.deps.closing() || session.updatesPaused || session.inbox.length === 0) return;
    const chat = session.chat;
    const run = chat?.runs()[0];
    if (!chat || !run || run.status !== "idle" || run.stopping || run.modeChanging) return;
    const updates = session.inbox.slice(0, UPDATE_BATCH);
    try {
      this.send(session, this.deps.formatUpdates(updates), "automatic");
      session.activity.received();
      session.inbox.splice(0, updates.length);
    } catch (error) {
      session.chatError = `Could not send worker updates: ${message(error)}`;
    }
    this.deps.changed();
  }
}
