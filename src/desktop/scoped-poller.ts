import {
  type Polling,
  type PollKey,
  type PollResult,
  type PollScope,
  type PollSettingsPatch,
  type PollVisibility,
  pollKeys,
} from "../bridge/index.js";
import { type PollClock, Poller } from "./poller.js";

export interface PollOwner {
  scope: PollScope;
  keys: readonly PollKey[];
  alive(): boolean;
  active(): boolean;
  visible(): boolean;
  available(key: PollKey): boolean;
  read(key: PollKey, current: () => boolean): Promise<void>;
}

interface Entry {
  owner: PollOwner;
  poller: Poller;
}

/** The resolver captures an owner now, never when the scheduler's deferred read runs. */
export class ScopedPoller {
  private readonly entries = new Map<string, Entry>();
  private overrides: PollSettingsPatch = {};
  private paused = false;
  private stopped = false;
  private finalSnapshot: Polling | undefined;
  private visibility: PollVisibility = { visible: false, worktrees: false, files: false };

  constructor(
    private readonly resolve: (key: PollKey) => PollOwner,
    private readonly changed: (scope?: PollScope) => void,
    private readonly clock?: PollClock,
  ) {}

  private prune(): void {
    for (const [key, entry] of this.entries) {
      if (entry.owner.alive()) continue;
      entry.poller.stop();
      this.entries.delete(key);
    }
  }

  private entry(owner: PollOwner): Entry {
    this.prune();
    if (this.stopped) throw new Error("The poller is stopped");
    if (!owner.alive()) throw new Error("The polling scope is no longer open");
    const key = JSON.stringify([owner.scope.kind, owner.scope.id]);
    const existing = this.entries.get(key);
    if (existing) return existing;
    if (this.entries.size >= 512) throw new Error("Too many polling scopes");
    const poller = new Poller(
      (source, current) => {
        const valid = () => current() && owner.alive();
        if (!valid()) return Promise.resolve();
        return owner.read(source, valid);
      },
      (source) => owner.alive() && owner.keys.includes(source) && owner.available(source),
      () => this.changed(owner.scope),
      this.clock,
    );
    const entry = { owner, poller };
    this.entries.set(key, entry);
    poller.configure(this.overrides);
    poller.pause(this.paused);
    this.refresh(entry);
    return entry;
  }

  private refresh({ owner, poller }: Entry): void {
    poller.context(
      owner.active(),
      owner.visible() ? this.visibility : { visible: false, worktrees: false, files: false },
    );
  }

  snapshot(): Polling {
    if (this.finalSnapshot) return structuredClone(this.finalSnapshot);
    this.prune();
    const empty = this.stopped
      ? new Poller(
          async () => {},
          () => false,
          () => {},
        )
      : undefined;
    empty?.configure(this.overrides);
    const unavailable = empty?.snapshot().sources;
    const sources = pollKeys.map((key) => {
      const owner = this.resolve(key);
      const entry = this.stopped
        ? this.entries.get(JSON.stringify([owner.scope.kind, owner.scope.id]))
        : this.entry(owner);
      const source = (entry?.poller.snapshot().sources ?? unavailable)?.find(
        (source) => source.key === key,
      );
      if (!source) throw new Error("The polling scope is unavailable");
      return { ...source, scope: { ...owner.scope } };
    });
    return { paused: this.paused, sources };
  }

  configure(patch: PollSettingsPatch): void {
    this.overrides = { ...this.overrides, ...patch };
    this.prune();
    for (const entry of this.entries.values()) entry.poller.configure(patch);
  }

  context(_active: boolean, visibility = this.visibility): void {
    if (this.stopped) return;
    this.visibility = visibility;
    this.prune();
    for (const key of pollKeys) {
      const owner = this.resolve(key);
      if (owner.alive()) this.entry(owner);
    }
    for (const entry of this.entries.values()) this.refresh(entry);
  }

  pause(paused: boolean): void {
    this.paused = paused;
    this.prune();
    for (const entry of this.entries.values()) entry.poller.pause(paused);
    this.changed();
  }

  invalidate(keys: readonly PollKey[]): void {
    if (this.stopped) return;
    this.prune();
    const groups = new Map<Entry, PollKey[]>();
    for (const key of keys) {
      const owner = this.resolve(key);
      if (!owner.alive()) continue;
      const entry = this.entry(owner);
      const sources = groups.get(entry) ?? [];
      sources.push(key);
      groups.set(entry, sources);
    }
    for (const [entry, sources] of groups) entry.poller.invalidate(sources);
  }

  poll(key: PollKey, trigger: PollResult["trigger"] = "manual"): Promise<void> {
    try {
      return this.entry(this.resolve(key)).poller.poll(key, trigger);
    } catch (cause) {
      return Promise.reject(cause);
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const entry of this.entries.values()) entry.poller.stop();
    this.finalSnapshot = this.snapshot();
    for (const source of this.finalSnapshot.sources) source.nextAt = null;
  }
}
