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
  ProviderLoginAnswer,
  ProviderLoginChallenge,
  ProviderSetupIdentity,
  ProviderSetupProgress,
  ProviderSetupStart,
  ProviderSetupSubmission,
  SetupAttempt,
  SetupBegin,
  SetupIdentity,
  SetupProviderId,
} from "../bridge/index.js";
import {
  parseAgentSetupRecord,
  parseCodexSetupIdentity,
  parseProviderAction,
  parseProviderSetupIdentity,
  parseProviderSetupStart,
  parseProviderSetupSubmission,
  parseSetupAttempt,
  parseSetupBegin,
  parseSetupSession,
} from "../bridge/index.js";
import { diagnosticMessage } from "../platform/index.js";
import { CodexSetupError } from "./codex-login.js";
import { commandIdentity, PROVIDERS, ProviderMissingError } from "./provider-catalog.js";
import {
  loginMethods,
  ProviderSetupError,
  type ProviderSetupPolicy,
  validateLoginChallenge,
} from "./provider-setup-policy.js";

type Command = readonly [string, ...string[]];
export interface SetupDependencies {
  command(id: string): Command | undefined;
  detect(id: string, command: Command, signal: AbortSignal): Promise<void>;
  probe(id: string, command: Command, signal: AbortSignal): Promise<void>;
  save(record: AgentSetupRecord): Promise<void>;
  changed(): void;
  canChangePrimary(): boolean;
  providers?: Partial<Record<SetupProviderId, ProviderSetupPolicy>>;
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
  private cleanupRequired = false;
  private session: AgentSetupSession | null = null;
  private commands: Record<string, string> = {};
  private running: { abort: AbortController; done: Promise<void> } | undefined;
  private cancellation: Promise<void> | undefined;
  private providerAttempt:
    | {
        id: string;
        owner: string;
        provider: SetupProviderId;
        challenge: ProviderLoginChallenge | null;
        pending?: {
          id: string;
          kind: ProviderLoginAnswer["kind"];
          resolve: (answer: ProviderLoginAnswer) => void;
        };
      }
    | undefined;
  constructor(private readonly deps: SetupDependencies) {}
  private ready(): void {
    if (this.cleanupRequired)
      throw new Error(
        "Provider cleanup is incomplete. Close setup to retry cleanup before continuing.",
      );
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
      providers: PROVIDERS.map(({ id, name, logo, guidance }) => ({
        id,
        name,
        logo,
        guidance,
        ...(this.policy(id) ? { loginMethods: loginMethods[id as SetupProviderId] } : {}),
      })),
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
  private policy(id: string): ProviderSetupPolicy | undefined {
    const policy = this.deps.providers?.[id as SetupProviderId];
    if (policy) return policy;
    const codex = this.deps.codex;
    return id === "codex" && codex
      ? {
          ...codex,
          login: (context) =>
            codex.login(context.signal, (value) =>
              context.challenge({ kind: "device", challengeId: randomUUID(), ...value }),
            ),
        }
      : undefined;
  }
  private supported(id: string, command: Command): boolean {
    const policy = this.policy(id);
    return (
      !!policy &&
      policy.supported !== false &&
      commandIdentity(command) ===
        commandIdentity(PROVIDERS.find((provider) => provider.id === id)?.command ?? [])
    );
  }
  private failed(session: AgentSetupSession, error: unknown, supported: boolean): void {
    session.phase = "failed";
    if (
      (error instanceof ProviderSetupError || error instanceof CodexSetupError) &&
      error.reason === "cleanup"
    )
      this.cleanupRequired = true;
    delete session.setupAction;
    delete session.codexAction;
    delete session.failureReason;
    if (!supported) {
      session.error = diagnosticMessage(error);
      return;
    }
    const name =
      PROVIDERS.find((provider) => provider.id === session.candidate)?.name ?? "Provider";
    const authRequired =
      error instanceof Error && "authRequired" in error && error.authRequired === true;
    if (error instanceof ProviderMissingError) {
      session.failureReason = "missing";
      session.setupAction = "install";
      session.error = `${name} is not installed. Install it here to continue.`;
    } else if (authRequired) {
      session.failureReason = "authentication";
      session.setupAction = "login";
      session.error = `Sign in to ${name} to continue.`;
    } else if (error instanceof CodexSetupError || error instanceof ProviderSetupError) {
      session.failureReason = error.reason;
      session.error = error.message;
      session.setupAction = ["missing", "unsupported", "install"].includes(error.reason)
        ? "install"
        : "login";
    } else {
      session.failureReason = "connection";
      session.setupAction = "install";
      session.error = `Could not connect to ${name}. Retry or install the compatible version for Code60.`;
    }
    if (session.candidate === "codex") session.codexAction = session.setupAction;
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
    delete session.setupAction;
    delete session.codexAction;
    delete session.failureReason;
  }
  startProvider(value: ProviderSetupStart, owner: string, install: boolean): CodexSetupStarted {
    this.ready();
    const request = parseProviderSetupStart(value);
    const { provider, method } = request;
    const session = this.current({ sessionId: request.sessionId });
    const policy = this.policy(provider);
    const command = this.deps.command(provider);
    if (
      !policy ||
      !owner ||
      !command ||
      !this.supported(provider, command) ||
      session.candidate !== provider ||
      session.phase !== "failed" ||
      session.setupAction !== (install ? "install" : "login") ||
      !loginMethods[provider].includes(method)
    )
      throw new Error("This provider setup action is unavailable.");
    if (this.running) throw new Error("An agent connection is already in progress");
    if (!this.deps.canChangePrimary())
      throw new Error("Finish or stop active agent work before signing in.");
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(25 * 60_000)]);
    const identity: NonNullable<AgentSetup["providerAttempt"]> = {
      id: randomUUID(),
      owner,
      provider,
      challenge: null,
    };
    this.providerAttempt = identity;
    session.phase = install ? "installing" : "authenticating";
    session.error = null;
    delete session.setupAction;
    delete session.codexAction;
    delete session.failureReason;
    const current = () =>
      !signal.aborted &&
      this.session === session &&
      this.providerAttempt === identity &&
      commandIdentity(this.deps.command(provider) ?? []) === commandIdentity(command);
    const publish = (value: ProviderLoginChallenge | null) => {
      if (current())
        identity.challenge = value
          ? structuredClone(validateLoginChallenge(provider, value))
          : null;
    };
    const input = async (value: ProviderLoginChallenge): Promise<ProviderLoginAnswer> => {
      if (!current() || identity.pending || value.kind === "device" || value.kind === "browser")
        throw new ProviderSetupError("login");
      publish(value);
      let stop = () => {};
      try {
        return await new Promise<ProviderLoginAnswer>((resolve, reject) => {
          stop = () => reject(new ProviderSetupError("login"));
          signal.addEventListener("abort", stop, { once: true });
          identity.pending = { id: value.challengeId, kind: value.kind, resolve };
          if (signal.aborted) stop();
        });
      } finally {
        signal.removeEventListener("abort", stop);
        delete identity.pending;
        publish(null);
      }
    };
    const done = Promise.resolve().then(async () => {
      try {
        await policy.cleanup().catch(() => {
          throw new ProviderSetupError("cleanup");
        });
        if (install) {
          await policy.install(signal);
          if (!current()) return;
          try {
            await this.verify(session, provider, command, abort, current);
            return;
          } catch (error) {
            if (!(error instanceof Error && "authRequired" in error && error.authRequired === true))
              throw error;
          }
        }
        if (!current()) return;
        session.phase = "authenticating";
        this.deps.changed();
        await policy.login({ signal, method, challenge: publish, input });
        await policy.cleanup().catch(() => {
          throw new ProviderSetupError("cleanup");
        });
        identity.challenge = null;
        if (current()) await this.verify(session, provider, command, abort, current);
      } catch (error) {
        if (
          !abort.signal.aborted &&
          this.session === session &&
          this.providerAttempt === identity
        ) {
          const installation = session.phase === "installing";
          this.failed(session, error, true);
          if (installation && session.failureReason === "timeout") {
            session.setupAction = "install";
            if (provider === "codex") session.codexAction = "install";
          }
        }
      } finally {
        abort.abort();
        identity.challenge = null;
        delete identity.pending;
        this.running = undefined;
        this.deps.changed();
      }
    });
    this.running = { abort, done };
    this.deps.changed();
    return { attemptId: identity.id };
  }
  readProvider(value: ProviderSetupIdentity, owner: string): ProviderSetupProgress {
    const { sessionId, attemptId, provider } = parseProviderSetupIdentity(value);
    const session = this.current({ sessionId });
    const attempt = this.providerAttempt;
    if (
      !attempt ||
      attempt.id !== attemptId ||
      attempt.owner !== owner ||
      attempt.provider !== provider ||
      session.candidate !== provider ||
      !["installing", "authenticating", "connecting", "success", "failed"].includes(session.phase)
    )
      throw new Error("Provider setup is no longer current.");
    return {
      attemptId,
      phase: session.phase as ProviderSetupProgress["phase"],
      challenge: session.phase === "authenticating" ? structuredClone(attempt.challenge) : null,
    };
  }
  submitProvider(value: ProviderSetupSubmission, owner: string): void {
    const request = parseProviderSetupSubmission(value);
    this.readProvider(
      { sessionId: request.sessionId, attemptId: request.attemptId, provider: request.provider },
      owner,
    );
    const attempt = this.providerAttempt;
    const pending = attempt?.pending;
    if (
      !attempt ||
      !pending ||
      pending.id !== request.challengeId ||
      pending.kind !== request.answer.kind
    )
      throw new Error("This sign-in step is no longer current.");
    delete attempt.pending;
    attempt.challenge = null;
    pending.resolve(request.answer);
  }
  async cancelProvider(value: ProviderSetupIdentity, owner: string): Promise<void> {
    this.readProvider(value, owner);
    await this.cancel({ sessionId: value.sessionId });
  }
  startCodex(value: SetupIdentity, owner: string, install: boolean): CodexSetupStarted {
    return this.startProvider(
      { ...parseSetupSession(value), provider: "codex", method: "default" },
      owner,
      install,
    );
  }
  readCodex(value: CodexSetupIdentity, owner: string): CodexSetupProgress {
    const progress = this.readProvider(
      { ...parseCodexSetupIdentity(value), provider: "codex" },
      owner,
    );
    return {
      ...progress,
      challenge:
        progress.challenge?.kind === "device"
          ? {
              verificationUrl: "https://auth.openai.com/codex/device",
              userCode: progress.challenge.userCode,
            }
          : null,
    };
  }
  async cancelCodex(value: CodexSetupIdentity, owner: string): Promise<void> {
    await this.cancelProvider({ ...parseCodexSetupIdentity(value), provider: "codex" }, owner);
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
    this.providerAttempt = undefined;
    delete session.setupAction;
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
          this.failed(session, error, this.supported(provider, command));
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
    if (this.providerAttempt) this.providerAttempt.challenge = null;
    const done = Promise.resolve().then(async () => {
      await attempt?.done;
      try {
        await this.deps.codex?.cleanup();
        for (const policy of Object.values(this.deps.providers ?? {})) await policy?.cleanup();
        this.cleanupRequired = false;
      } catch {
        this.cleanupRequired = true;
        if (this.session) this.failed(this.session, new ProviderSetupError("cleanup"), true);
        this.deps.changed();
        throw new ProviderSetupError("cleanup");
      }
      this.providerAttempt = undefined;
      if ((attempt || value) && this.session) {
        this.session.phase = "select";
        this.session.candidate = null;
        this.session.detected = false;
        this.session.error = null;
        delete this.session.setupAction;
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
