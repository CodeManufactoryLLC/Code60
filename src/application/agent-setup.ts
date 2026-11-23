import { randomUUID } from "node:crypto";
import type {
  AgentSetupRecord,
  AgentSetupSession,
  AgentSetupSnapshot,
  CodexChallenge,
  CodexSetupIdentity,
  CodexSetupProgress,
  CodexSetupStarted,
  ProviderAction,
  SetupAttempt,
  SetupBegin,
  SetupIdentity,
} from "../bridge/index.js";
import {
  parseAgentSetupRecord,
  parseCodexSetupIdentity,
  parseProviderAction,
  parseSetupAttempt,
  parseSetupBegin,
  parseSetupSession,
} from "../bridge/index.js";
import { diagnosticMessage } from "../platform/index.js";
import { CodexSetupError } from "./codex-login.js";
import { commandIdentity, PROVIDERS, ProviderMissingError } from "./provider-catalog.js";

type Command = readonly [string, ...string[]];
export interface SetupDependencies {
  command(id: string): Command | undefined;
  detect(id: string, command: Command, signal: AbortSignal): Promise<void>;
  probe(id: string, command: Command, signal: AbortSignal): Promise<void>;
  save(record: AgentSetupRecord): Promise<void>;
  changed(): void;
  canChangePrimary(): boolean;
  codex?: {
    supported?: boolean;
    install(signal: AbortSignal): Promise<void>;
    login(signal: AbortSignal, challenge: (value: CodexChallenge) => void): Promise<void>;
    cleanup(): Promise<void>;
  };
}
/** Setup attempts are transactional; finish and explicit management save membership atomically. */
export class AgentSetup {
  record: AgentSetupRecord | null = null;
  private managing = false;
  private session: AgentSetupSession | null = null;
  private commands: Record<string, string> = {};
  private running: { abort: AbortController; done: Promise<void> } | undefined;
  private cancellation: Promise<void> | undefined;
  private codexAttempt: { id: string; owner: string; challenge: CodexChallenge | null } | undefined;
  constructor(private readonly deps: SetupDependencies) {}
  private ready(): void {
    if (this.cancellation) throw new Error("Wait for provider setup cleanup to finish");
  }
  get complete(): boolean {
    return this.record !== null && this.enabled.includes(this.record.primary);
  }
  get enabled(): string[] {
    return (
      this.record?.enabled.filter((id) => {
        const command = this.deps.command(id);
        return command && commandIdentity(command) === this.record?.commands[id];
      }) ?? []
    );
  }
  snapshot(): AgentSetupSnapshot {
    return {
      complete: this.complete,
      primary: this.record?.primary ?? null,
      enabled: this.enabled,
      providers: PROVIDERS.map(({ id, name, logo, guidance }) => ({ id, name, logo, guidance })),
      session: structuredClone(this.session),
    };
  }
  restore(value: unknown): void {
    this.record = value == null ? null : parseAgentSetupRecord(value);
  }
  async manage(value: ProviderAction): Promise<AgentSetupRecord> {
    this.ready();
    const action = parseProviderAction(value);
    if (this.managing) throw new Error("Wait for the provider change to finish");
    if (this.session) throw new Error("Finish or cancel provider setup first");
    if (!this.deps.canChangePrimary())
      throw new Error("Finish or stop active agent work before changing providers");
    if (
      !PROVIDERS.some((provider) => provider.id === action.provider) ||
      !this.enabled.includes(action.provider)
    )
      throw new Error("Connect and verify this provider first");
    const previous = this.record;
    if (!previous) throw new Error("Complete provider setup first");
    if (action.provider === previous.primary)
      throw new Error(
        action.type === "disconnect"
          ? "Set another provider as primary first"
          : "This is already the primary provider",
      );
    const record = parseAgentSetupRecord(
      action.type === "set-primary"
        ? {
            ...previous,
            primary: action.provider,
          }
        : {
            ...previous,
            enabled: previous.enabled.filter((id) => id !== action.provider),
            commands: Object.fromEntries(
              Object.entries(previous.commands).filter(([id]) => id !== action.provider),
            ),
          },
    );
    this.managing = true;
    try {
      await this.deps.save(record);
      this.record = record;
      this.deps.changed();
      return record;
    } finally {
      this.managing = false;
    }
  }
  begin(value: SetupBegin): void {
    this.ready();
    const { mode } = parseSetupBegin(value);
    if (this.managing) throw new Error("Wait for the provider change to finish");
    if (this.running) throw new Error("Cancel the current attempt first");
    if (this.session) throw new Error("Finish or cancel the current setup first");
    if (mode === "primary" && !this.deps.canChangePrimary())
      throw new Error("Finish or stop active orchestration work before changing the primary");
    if (mode === "add" && !this.complete) throw new Error("Set up the primary first");
    this.commands = Object.fromEntries(
      this.enabled.map((id) => [id, this.record?.commands[id] as string]),
    );
    this.session = {
      id: randomUUID(),
      mode,
      role: mode === "primary" ? "primary" : "additional",
      candidate: null,
      phase: "select",
      detected: false,
      error: null,
      primary: mode === "add" ? (this.record?.primary ?? null) : null,
      verified: Object.keys(this.commands),
    };
    this.deps.changed();
  }
  private current(value: SetupIdentity): AgentSetupSession {
    const { sessionId } = parseSetupSession(value);
    if (!this.session || this.session.id !== sessionId)
      throw new Error("This setup session is no longer current");
    return this.session;
  }
  private supportsCodex(command: Command): boolean {
    return (
      Boolean(this.deps.codex) &&
      this.deps.codex?.supported !== false &&
      commandIdentity(command) ===
        commandIdentity(PROVIDERS.find((provider) => provider.id === "codex")?.command ?? [])
    );
  }
  private failed(session: AgentSetupSession, error: unknown, codex: boolean): void {
    session.phase = "failed";
    delete session.codexAction;
    delete session.failureReason;
    if (!codex) {
      session.error = diagnosticMessage(error);
      return;
    }
    const authRequired =
      error instanceof Error && "authRequired" in error && error.authRequired === true;
    if (error instanceof ProviderMissingError) {
      session.failureReason = "missing";
      session.codexAction = "install";
      session.error = "Codex is not installed. Install it here to continue.";
    } else if (authRequired) {
      session.failureReason = "authentication";
      session.codexAction = "login";
      session.error = "Sign in to Codex to continue.";
    } else if (error instanceof CodexSetupError) {
      session.failureReason = error.reason;
      session.error = error.message;
      session.codexAction = ["missing", "unsupported", "install"].includes(error.reason)
        ? "install"
        : "login";
    } else {
      session.failureReason = "connection";
      session.codexAction = "install";
      session.error =
        "Could not connect to Codex. Retry or install the compatible version for Code60.";
    }
  }
  private async verify(
    session: AgentSetupSession,
    provider: string,
    command: Command,
    abort: AbortController,
    current: () => boolean,
  ): Promise<void> {
    await this.deps.detect(provider, command, abort.signal);
    if (!current()) return;
    session.detected = true;
    session.phase = "connecting";
    this.deps.changed();
    await this.deps.probe(provider, command, abort.signal);
    if (!current()) return;
    this.commands[provider] = commandIdentity(command);
    session.verified.push(provider);
    session.primary ??= provider;
    session.role = "additional";
    session.phase = "success";
    delete session.codexAction;
    delete session.failureReason;
  }
  startCodex(value: SetupIdentity, owner: string, install: boolean): CodexSetupStarted {
    this.ready();
    const session = this.current(value);
    const codex = this.deps.codex;
    const command = this.deps.command("codex");
    if (
      !codex ||
      !owner ||
      !command ||
      !this.supportsCodex(command) ||
      session.candidate !== "codex" ||
      session.phase !== "failed" ||
      session.codexAction !== (install ? "install" : "login")
    )
      throw new Error("This Codex setup action is unavailable.");
    if (this.running) throw new Error("An agent connection is already in progress");
    if (!this.deps.canChangePrimary())
      throw new Error("Finish or stop active agent work before signing in.");
    const abort = new AbortController();
    const identity = { id: randomUUID(), owner, challenge: null as CodexChallenge | null };
    this.codexAttempt = identity;
    session.phase = install ? "installing" : "authenticating";
    session.error = null;
    delete session.codexAction;
    delete session.failureReason;
    const current = () =>
      !abort.signal.aborted &&
      this.session === session &&
      this.codexAttempt === identity &&
      commandIdentity(this.deps.command("codex") ?? []) === commandIdentity(command);
    const done = Promise.resolve().then(async () => {
      try {
        if (install) {
          await codex.install(abort.signal);
          if (!current()) return;
          // A retained login may already work after reinstalling a missing CLI.
          try {
            await this.verify(session, "codex", command, abort, current);
            return;
          } catch (error) {
            if (!(error instanceof Error && "authRequired" in error && error.authRequired === true))
              throw error;
          }
        }
        if (!current()) return;
        session.phase = "authenticating";
        this.deps.changed();
        await codex.login(abort.signal, (challenge) => {
          if (current()) identity.challenge = structuredClone(challenge);
        });
        identity.challenge = null;
        if (current()) await this.verify(session, "codex", command, abort, current);
      } catch (error) {
        if (current()) {
          const installation = session.phase === "installing";
          this.failed(session, error, true);
          if (installation && error instanceof CodexSetupError && error.reason === "timeout")
            session.codexAction = "install";
        }
      } finally {
        identity.challenge = null;
        this.running = undefined;
        this.deps.changed();
      }
    });
    this.running = { abort, done };
    this.deps.changed();
    return { attemptId: identity.id };
  }
  readCodex(value: CodexSetupIdentity, owner: string): CodexSetupProgress {
    const { sessionId, attemptId } = parseCodexSetupIdentity(value);
    const session = this.current({ sessionId });
    const attempt = this.codexAttempt;
    if (
      !attempt ||
      attempt.id !== attemptId ||
      attempt.owner !== owner ||
      session.candidate !== "codex" ||
      !["installing", "authenticating", "connecting", "success", "failed"].includes(session.phase)
    )
      throw new Error("Codex setup is no longer current.");
    return {
      attemptId,
      phase: session.phase as CodexSetupProgress["phase"],
      challenge: session.phase === "authenticating" ? structuredClone(attempt.challenge) : null,
    };
  }
  async cancelCodex(value: CodexSetupIdentity, owner: string): Promise<void> {
    this.readCodex(value, owner);
    await this.cancel({ sessionId: value.sessionId });
  }
  async attempt(value: SetupAttempt): Promise<void> {
    const { sessionId, provider } = parseSetupAttempt(value);
    const session = this.current({ sessionId });
    if (this.running) throw new Error("An agent connection is already in progress");
    this.ready();
    if (!PROVIDERS.some((p) => p.id === provider)) throw new Error("Unknown agent");
    if (session.verified.includes(provider)) throw new Error("This agent is already selected");
    const configured = this.deps.command(provider);
    if (!configured) throw new Error("Agent command unavailable");
    const command = [...configured] as Command;
    const abort = new AbortController();
    this.codexAttempt = undefined;
    delete session.codexAction;
    delete session.failureReason;
    Object.assign(session, {
      candidate: provider,
      phase: "detecting",
      detected: false,
      error: null,
    });
    this.deps.changed();
    const current = () =>
      !abort.signal.aborted &&
      this.session === session &&
      commandIdentity(this.deps.command(provider) ?? []) === commandIdentity(command);
    const done = (async () => {
      try {
        await this.verify(session, provider, command, abort, current);
      } catch (error) {
        if (current()) {
          this.failed(session, error, provider === "codex" && this.supportsCodex(command));
        }
      } finally {
        this.running = undefined;
        this.deps.changed();
      }
    })();
    this.running = { abort, done };
    await done;
  }
  async cancel(value?: SetupIdentity): Promise<void> {
    if (value) this.current(value);
    if (this.cancellation) return this.cancellation;
    const attempt = this.running;
    attempt?.abort.abort();
    if (this.codexAttempt) this.codexAttempt.challenge = null;
    const done = Promise.resolve().then(async () => {
      await attempt?.done;
      await this.deps.codex?.cleanup();
      this.codexAttempt = undefined;
      if ((attempt || value) && this.session) {
        this.session.phase = "select";
        this.session.candidate = null;
        this.session.detected = false;
        this.session.error = null;
        delete this.session.codexAction;
        delete this.session.failureReason;
        this.deps.changed();
      }
    });
    this.cancellation = done;
    try {
      await done;
    } finally {
      this.cancellation = undefined;
    }
  }
  async abandon(value: SetupIdentity): Promise<void> {
    this.current(value);
    await this.cancel(value);
    this.session = null;
    this.commands = {};
    this.deps.changed();
  }
  async finish(value: SetupIdentity): Promise<AgentSetupRecord> {
    this.ready();
    const session = this.current(value);
    if (this.running || !session.primary || session.phase !== "success")
      throw new Error("Connect every selected agent before finishing setup");
    if (session.mode === "primary" && !this.deps.canChangePrimary())
      throw new Error("Finish or stop active orchestration work before changing the primary");
    for (const id of session.verified)
      if (this.commands[id] !== commandIdentity(this.deps.command(id) ?? []))
        throw new Error("Agent commands changed. Cancel setup and try again.");
    const record = parseAgentSetupRecord({
      version: 1,
      primary: session.primary,
      enabled: session.verified,
      commands: this.commands,
    });
    await this.deps.save(record);
    this.record = record;
    this.session = null;
    this.commands = {};
    this.deps.changed();
    return record;
  }
}
