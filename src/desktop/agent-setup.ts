import { randomUUID } from "node:crypto";
import type {
  AgentSetupRecord,
  AgentSetupSession,
  AgentSetupSnapshot,
  SetupAttempt,
  SetupBegin,
  SetupIdentity,
} from "../bridge/index.js";
import {
  parseAgentSetupRecord,
  parseSetupAttempt,
  parseSetupBegin,
  parseSetupSession,
} from "../bridge/index.js";
import { commandIdentity, PROVIDERS } from "./provider-catalog.js";

type Command = readonly [string, ...string[]];
export interface SetupDependencies {
  command(id: string): Command | undefined;
  detect(id: string, command: Command, signal: AbortSignal): Promise<void>;
  probe(id: string, command: Command, signal: AbortSignal): Promise<void>;
  save(record: AgentSetupRecord): Promise<void>;
  changed(): void;
  canChangePrimary(): boolean;
}
/** In-memory transaction; only finish writes durable membership. */
export class AgentSetup {
  record: AgentSetupRecord | null = null;
  private session: AgentSetupSession | null = null;
  private commands: Record<string, string> = {};
  private running: { abort: AbortController; done: Promise<void> } | undefined;
  constructor(private readonly deps: SetupDependencies) {}
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
  begin(value: SetupBegin): void {
    const { mode } = parseSetupBegin(value);
    if (this.running) throw new Error("Cancel the current attempt first");
    if (this.session) throw new Error("Finish or cancel the current setup first");
    if (mode === "primary" && !this.deps.canChangePrimary())
      throw new Error("Finish or stop active orchestration work before changing the primary");
    if (mode === "add" && !this.complete) throw new Error("Set up the primary first");
    this.commands =
      mode === "add"
        ? Object.fromEntries(this.enabled.map((id) => [id, this.record?.commands[id] as string]))
        : {};
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
  async attempt(value: SetupAttempt): Promise<void> {
    const { sessionId, provider } = parseSetupAttempt(value);
    const session = this.current({ sessionId });
    if (this.running) throw new Error("An agent connection is already in progress");
    if (!PROVIDERS.some((p) => p.id === provider)) throw new Error("Unknown agent");
    if (session.verified.includes(provider)) throw new Error("This agent is already selected");
    const configured = this.deps.command(provider);
    if (!configured) throw new Error("Agent command unavailable");
    const command = [...configured] as Command;
    const abort = new AbortController();
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
      } catch (error) {
        if (current()) {
          session.phase = "failed";
          session.error = error instanceof Error ? error.message : String(error);
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
    const attempt = this.running;
    attempt?.abort.abort();
    await attempt?.done;
    if ((attempt || value) && this.session) {
      this.session.phase = "select";
      this.session.candidate = null;
      this.session.detected = false;
      this.session.error = null;
      this.deps.changed();
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
    const session = this.current(value);
    if (
      this.running ||
      !session.primary ||
      session.phase === "failed" ||
      session.phase === "detecting" ||
      session.phase === "connecting"
    )
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
