import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import {
  abbreviateTerminalPath,
  TERMINAL_LIMITS,
  type TerminalCloseRequest,
  type TerminalEvent,
  type TerminalResizeRequest,
  type TerminalSessionInfo,
  type TerminalSummary,
  type TerminalTarget,
  type TerminalWriteRequest,
} from "../bridge/index.js";
import { type OwnedPty, type SpawnPtyOptions, spawnOwnedPty, userHome } from "../platform/index.js";

export interface ResolvedTerminalTarget {
  cwd: string;
  label: string;
  project: string | null;
  projectId: string | null;
  targetKind: TerminalTarget["kind"];
  runId: string | null;
  databaseOwned: boolean;
}

interface ManagedTerminal {
  readonly id: string;
  readonly pty: OwnedPty;
  readonly cwd: string;
  readonly shell: string;
  readonly pid: number;
  readonly label: string;
  readonly project: string | null;
  readonly projectId: string | null;
  readonly targetKind: TerminalTarget["kind"];
  readonly runId: string | null;
  readonly databaseOwned: boolean;
  readonly startedAt: string;
  readonly disposeData: () => void;
  buffered: string;
  flushTimer: ReturnType<typeof setTimeout> | undefined;
  closed: boolean;
}

const FLUSH_INTERVAL_MS = 16;
const FLUSH_MAX_BYTES = 64 * 1024;

export class ApplicationTerminals {
  private readonly sessions = new Map<string, ManagedTerminal>();
  private readonly eventListeners = new Set<(event: TerminalEvent) => void>();
  private readonly changeListeners = new Set<() => void>();
  private closing = false;
  private openingCount = 0;

  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly spawnPty: (options: SpawnPtyOptions) => Promise<OwnedPty> = spawnOwnedPty,
  ) {}

  subscribe(listener: (event: TerminalEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  subscribeChanges(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  list(): TerminalSummary[] {
    const home = userHome(this.env);
    return [...this.sessions.values()].map((session) => ({
      id: session.id,
      cwd: session.cwd,
      displayCwd: abbreviateTerminalPath(session.cwd, home),
      shell: session.shell,
      pid: session.pid,
      label: session.label,
      project: session.project,
      displayProject: session.project ? abbreviateTerminalPath(session.project, home) : null,
      projectId: session.projectId,
      targetKind: session.targetKind,
      runId: session.runId,
      startedAt: session.startedAt,
    }));
  }

  async open(
    resolved: ResolvedTerminalTarget,
    cols: number,
    rows: number,
  ): Promise<TerminalSessionInfo> {
    if (this.closing) throw new Error("Terminals are closing");
    if (this.sessions.size + this.openingCount >= TERMINAL_LIMITS.maxSessions) {
      throw new Error(
        `Maximum of ${TERMINAL_LIMITS.maxSessions} concurrent terminals reached. Close an existing terminal first.`,
      );
    }
    this.openingCount++;
    try {
      const info = await stat(resolved.cwd).catch(() => null);
      if (!info?.isDirectory()) {
        throw new Error(`Target folder is no longer available: ${resolved.cwd}`);
      }
      const pty = await this.spawnPty({
        cwd: resolved.cwd,
        cols,
        rows,
        env: this.env,
      });
      if (this.closing) {
        await pty.stop().catch(() => {});
        throw new Error("Terminals are closing");
      }
      const id = randomUUID();
      const startedAt = new Date().toISOString();
      const session: ManagedTerminal = {
        id,
        pty,
        cwd: resolved.cwd,
        shell: pty.shell,
        pid: pty.pid,
        label: resolved.label,
        project: resolved.project,
        projectId: resolved.projectId,
        targetKind: resolved.targetKind,
        runId: resolved.runId,
        databaseOwned: resolved.databaseOwned,
        startedAt,
        disposeData: () => {},
        buffered: "",
        flushTimer: undefined,
        closed: false,
      };
      const flush = () => {
        if (session.flushTimer !== undefined) {
          clearTimeout(session.flushTimer);
          session.flushTimer = undefined;
        }
        if (!session.buffered) return;
        const data = session.buffered;
        session.buffered = "";
        this.emitEvent({ id, type: "data", data });
      };
      const disposeData = pty.onData((chunk) => {
        if (session.closed) return;
        session.buffered += chunk;
        if (Buffer.byteLength(session.buffered) >= FLUSH_MAX_BYTES) {
          flush();
          return;
        }
        if (session.flushTimer === undefined) {
          session.flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
        }
      });
      (session as { disposeData: () => void }).disposeData = disposeData;
      this.sessions.set(id, session);
      this.emitChanged();

      void pty.exited.then(({ code, signal }) => {
        if (session.closed) return;
        flush();
        session.closed = true;
        session.disposeData();
        if (this.sessions.delete(id)) {
          this.emitEvent({ id, type: "exit", code, signal });
          this.emitChanged();
        }
      });

      const home = userHome(this.env);
      return {
        id,
        cwd: session.cwd,
        displayCwd: abbreviateTerminalPath(session.cwd, home),
        shell: session.shell,
        pid: session.pid,
        label: session.label,
        project: session.project,
        displayProject: session.project ? abbreviateTerminalPath(session.project, home) : null,
        projectId: session.projectId,
        targetKind: session.targetKind,
        runId: session.runId,
        startedAt,
      };
    } finally {
      this.openingCount--;
    }
  }

  write(request: TerminalWriteRequest): void {
    const session = this.sessions.get(request.id);
    if (!session || session.closed) return;
    session.pty.write(request.data);
  }

  resize(request: TerminalResizeRequest): void {
    const session = this.sessions.get(request.id);
    if (!session || session.closed) return;
    session.pty.resize(request.cols, request.rows);
  }

  async close(request: TerminalCloseRequest): Promise<void> {
    const session = this.sessions.get(request.id);
    if (!session) return;
    await this.disposeSession(session);
  }

  async closeByRun(runId: string): Promise<void> {
    const matching = [...this.sessions.values()].filter((session) => session.runId === runId);
    await Promise.allSettled(matching.map((session) => this.disposeSession(session)));
  }

  async closeByProject(projectId: string): Promise<void> {
    const matching = [...this.sessions.values()].filter(
      (session) => session.projectId === projectId,
    );
    await Promise.allSettled(matching.map((session) => this.disposeSession(session)));
  }

  async closeDatabaseOwned(): Promise<void> {
    const matching = [...this.sessions.values()].filter((session) => session.databaseOwned);
    await Promise.allSettled(matching.map((session) => this.disposeSession(session)));
  }

  async closeAll(permanent = false): Promise<void> {
    if (permanent) this.closing = true;
    const active = [...this.sessions.values()];
    await Promise.allSettled(active.map((session) => this.disposeSession(session)));
  }

  private async disposeSession(session: ManagedTerminal): Promise<void> {
    const removed = this.sessions.delete(session.id);
    if (session.flushTimer !== undefined) {
      clearTimeout(session.flushTimer);
      session.flushTimer = undefined;
    }
    session.buffered = "";
    const wasOpen = !session.closed;
    session.closed = true;
    session.disposeData();
    if (removed) this.emitChanged();
    try {
      await session.pty.stop();
    } finally {
      if (wasOpen && removed)
        this.emitEvent({ id: session.id, type: "exit", code: null, signal: null });
    }
  }

  private emitEvent(event: TerminalEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // Isolate subscriber errors.
      }
    }
  }

  private emitChanged(): void {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch {
        // Isolate subscriber errors.
      }
    }
  }
}
