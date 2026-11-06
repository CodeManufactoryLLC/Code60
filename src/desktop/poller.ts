import {
  type PollKey,
  type PollResult,
  type PollSetting,
  type PollSettings,
  type PollSettingsPatch,
  type PollState,
  type PollVisibility,
  pollDefaults,
  pollKeys,
} from "../bridge/index.js";

interface Source {
  state: PollState;
  generation: number;
  flight?: Promise<void> | undefined;
  flightGeneration?: number;
  timer?: ReturnType<typeof setTimeout> | undefined;
  rerun?: boolean;
}

export interface PollClock {
  now(): number;
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

/** One scheduler for external reads. A stale flight must settle before its replacement starts. */
export class Poller {
  private sources = new Map<PollKey, Source>();
  private stopped = false;
  private paused = false;
  private active = false;
  private sequence = 0;
  private visibility: PollVisibility = { visible: false, worktrees: false };

  constructor(
    private readonly read: (key: PollKey, current: () => boolean) => Promise<void>,
    private readonly available: (key: PollKey) => boolean,
    private readonly changed: () => void,
    private readonly clock: PollClock = {
      now: Date.now,
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (timer) => clearTimeout(timer),
    },
  ) {
    for (const key of pollKeys) {
      this.sources.set(key, {
        generation: 0,
        state: {
          key,
          setting: { ...pollDefaults[key] },
          status: "unavailable",
          effectiveIntervalMs: null,
          polledAt: null,
          succeededAt: null,
          durationMs: null,
          nextAt: null,
          failures: 0,
          lastError: null,
          history: [],
        },
      });
    }
  }

  snapshot() {
    return {
      paused: this.paused,
      sources: structuredClone([...this.sources.values()].map((s) => s.state)),
    };
  }

  settings(): PollSettings {
    return Object.fromEntries(
      [...this.sources].map(([key, s]) => [key, { ...s.state.setting }]),
    ) as PollSettings;
  }

  configure(patch: PollSettingsPatch): void {
    for (const key of pollKeys) {
      if (Object.hasOwn(patch, key))
        this.source(key).state.setting = { ...(patch[key] ?? pollDefaults[key]) };
    }
    this.reschedule();
  }

  context(active: boolean, visibility = this.visibility): void {
    const entered =
      visibility.visible &&
      visibility.worktrees &&
      (!this.visibility.visible || !this.visibility.worktrees);
    this.active = active;
    this.visibility = visibility;
    this.reschedule();
    if (
      (entered || this.source("worktrees").state.polledAt === null) &&
      visibility.visible &&
      visibility.worktrees &&
      this.available("worktrees") &&
      !this.paused &&
      this.source("worktrees").state.setting.intervalMs !== null
    )
      void this.poll("worktrees", "change").catch(() => {});
  }

  pause(paused: boolean): void {
    this.paused = paused;
    this.reschedule();
  }

  /** Invalidate only sources whose underlying workspace/database has changed. */
  invalidate(keys: readonly PollKey[]): void {
    for (const key of keys) {
      const s = this.source(key);
      s.generation++;
      s.state = {
        ...s.state,
        polledAt: null,
        succeededAt: null,
        durationMs: null,
        nextAt: null,
        failures: 0,
        lastError: null,
        history: [],
      };
    }
    this.reschedule();
  }

  poll(key: PollKey, trigger: PollResult["trigger"] = "manual"): Promise<void> {
    if (this.stopped) return Promise.reject(new Error("The poller is stopped"));
    const s = this.source(key);
    const generation = s.generation;
    if (s.flight) {
      const flight = s.flight;
      const stale = s.flightGeneration !== generation;
      if (trigger === "change" && !stale) s.rerun = true;
      return flight
        .catch((error: unknown) => {
          if (!stale) throw error;
        })
        .then(() => {
          // A workspace switch may have invalidated the shared flight.
          if (!this.stopped && (stale || generation !== s.generation))
            return this.poll(key, trigger);
        });
    }
    if (!this.available(key)) return Promise.reject(new Error(`${key} is not available`));
    if (s.timer !== undefined) this.clock.clearTimeout(s.timer);
    s.timer = undefined;
    s.state.nextAt = null;
    s.state.status = "polling";
    const at = this.clock.now();
    s.state.polledAt = at;
    // Defer the read until flight is installed, including for synchronous test fakes.
    const current = () => !this.stopped && s.generation === generation;
    const flight = Promise.resolve()
      .then(() => this.read(key, current))
      .then(
        () => {
          if (!current()) return;
          s.state.failures = 0;
          s.state.lastError = null;
          s.state.succeededAt = this.clock.now();
          this.record(s, { at, trigger, durationMs: this.clock.now() - at, ok: true, error: null });
        },
        (error: unknown) => {
          if (!current()) return;
          const detail = (error instanceof Error ? error.message : String(error)).slice(0, 500);
          s.state.failures++;
          s.state.lastError = detail;
          this.record(s, {
            at,
            trigger,
            durationMs: this.clock.now() - at,
            ok: false,
            error: detail,
          });
          throw error;
        },
      )
      .finally(() => {
        s.flight = undefined;
        if (this.stopped) return;
        if (s.rerun && current()) {
          s.rerun = false;
          void this.poll(key, "change").catch(() => {});
          return;
        }
        s.rerun = false;
        this.schedule(s);
        this.changed();
      });
    s.flight = flight;
    s.flightGeneration = generation;
    this.changed();
    return flight;
  }

  stop(): void {
    this.stopped = true;
    for (const s of this.sources.values()) {
      s.generation++;
      if (s.timer !== undefined) this.clock.clearTimeout(s.timer);
      s.timer = undefined;
      s.state.nextAt = null;
    }
  }

  private source(key: PollKey): Source {
    const source = this.sources.get(key);
    if (!source) throw new Error("Unknown polling source");
    return source;
  }

  private record(s: Source, result: Omit<PollResult, "id">): void {
    s.state.durationMs = result.durationMs;
    s.state.history = [...s.state.history.slice(-49), { ...result, id: ++this.sequence }];
  }

  private interval(key: PollKey, setting: PollSetting): number | null {
    return key === "worktrees" || key === "files" || this.active
      ? setting.intervalMs
      : setting.idleIntervalMs;
  }

  private schedule(s: Source): void {
    if (s.timer !== undefined) this.clock.clearTimeout(s.timer);
    s.timer = undefined;
    const state = s.state;
    const interval = this.interval(state.key, state.setting);
    // Failures back off exponentially up to 60s, but never poll faster than configured.
    state.effectiveIntervalMs =
      interval === null || state.failures === 0
        ? interval
        : Math.min(Math.max(interval, 60000), interval * 2 ** Math.min(state.failures, 16));
    state.nextAt = null;
    if (s.flight) {
      state.status = "polling";
      return;
    }
    if (!this.available(state.key)) state.status = "unavailable";
    else if (this.paused) state.status = "paused";
    else if (
      !this.visibility.visible ||
      (state.key === "worktrees" && !this.visibility.worktrees) ||
      (state.key === "files" && !this.visibility.files)
    )
      state.status = "hidden";
    else if (interval === null)
      state.status = !this.active && state.setting.intervalMs !== null ? "idle" : "disabled";
    else {
      state.status = state.failures ? "failed" : state.succeededAt === null ? "idle" : "healthy";
      const last = state.history.at(-1);
      const due =
        (last ? last.at + last.durationMs : this.clock.now()) +
        (state.effectiveIntervalMs ?? interval);
      state.nextAt = Math.max(this.clock.now(), due);
      s.timer = this.clock.setTimeout(() => {
        s.timer = undefined;
        void this.poll(state.key, "timer").catch(() => {});
      }, state.nextAt - this.clock.now());
    }
  }

  private reschedule(): void {
    if (this.stopped) return;
    for (const s of this.sources.values()) this.schedule(s);
    this.changed();
  }
}
