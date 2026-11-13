import { useEffect, useRef, useState } from "react";
import type { PageId, SettingsSectionId } from "./tabs.js";

/** A page the user visited, or a specific chat on the Chat page. */
export interface Destination {
  page: PageId;
  /** The Settings page shown, when `page` is `settings`. */
  section?: SettingsSectionId;
  /** The orchestrator or worker run shown, when `page` is `chat`. */
  chat?: string;
}

export interface NavigationHistory {
  entries: readonly Destination[];
  index: number;
}

export type Direction = -1 | 1;
/** Reports whether a navigation request succeeded; `onFailure` runs before recovery. */
export type Settle = (ok: boolean, onFailure?: () => void) => void;
/** Whether a restore is still the latest navigation, checked after each await. */
export type Current = () => boolean;

/** Entries kept per window; older ones are dropped first. */
const limit = 100;
/** How long a navigation may take to appear before wherever the user is gets recorded. */
const settleMs = 2000;

export function destination(
  page: PageId,
  section: SettingsSectionId,
  chat: string | undefined,
): Destination {
  if (page === "settings") return { page, section };
  if (page === "chat" && chat) return { page, chat };
  return { page };
}

const sameDestination = (a: Destination, b: Destination) =>
  a.page === b.page && a.section === b.section && a.chat === b.chat;

/** Chat without a conversation is a placeholder that any conversation fulfils. */
const fulfils = (actual: Destination, target: Destination) =>
  sameDestination(actual, target) ||
  (target.page === "chat" && !target.chat && actual.page === "chat");

/**
 * Visiting a new destination drops forward history; revisiting the current one does nothing.
 * Chat without a conversation becomes that conversation once one appears, rather than a step.
 */
export function recordDestination(
  history: NavigationHistory,
  next: Destination,
): NavigationHistory {
  const current = history.entries[history.index];
  if (current && sameDestination(current, next)) return history;
  const kept = current && fulfils(next, current) ? 0 : 1;
  const entries = [...history.entries.slice(0, history.index + kept), next].slice(-limit);
  return { entries, index: entries.length - 1 };
}

/** Arriving at a history entry updates it where it is, keeping forward history. */
function resolveEntry(history: NavigationHistory, actual: Destination): NavigationHistory {
  const current = history.entries[history.index];
  if (!current || sameDestination(current, actual)) return history;
  const entries = [...history.entries];
  entries[history.index] = actual;
  return { entries, index: history.index };
}

/**
 * The nearest entry in `direction` that is still available and differs from where the user is,
 * so removed chats, and duplicates they leave behind, are skipped.
 */
function stepHistory(
  history: NavigationHistory,
  direction: Direction,
  available: (entry: Destination) => boolean,
  current: Destination,
): NavigationHistory | undefined {
  for (
    let index = history.index + direction;
    index >= 0 && index < history.entries.length;
    index += direction
  ) {
    const entry = history.entries[index];
    if (entry && available(entry) && !fulfils(current, entry))
      return { entries: history.entries, index };
  }
  return undefined;
}

interface Pending {
  matches(entry: Destination): boolean;
  /** Destinations the request passes through on its way; anything else is the user moving on. */
  passing: readonly Destination[];
  /** Traversal resolves its history entry in place instead of recording a visit. */
  traversal: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

interface Timers {
  set(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clear(timer: ReturnType<typeof setTimeout> | undefined): void;
}

const systemTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (timer) => clearTimeout(timer),
};

/**
 * Records every change of the current destination, whatever caused it, so the sidebar, palette
 * and other entry points share one history. Selecting an orchestrator completes in the main
 * process, passing through known intermediate destinations; `expect` ignores only those until
 * the target appears. Any other destination means the user moved on: it is recorded at once and
 * the earlier request no longer counts as current.
 */
export class NavigationRecorder {
  history: NavigationHistory;
  private current: Destination;
  private pending: Pending | undefined;

  constructor(
    current: Destination,
    private readonly onChange: () => void = () => {},
    private readonly timers: Timers = systemTimers,
  ) {
    this.current = current;
    this.history = { entries: [current], index: 0 };
  }

  /** Report where the user is now. */
  observe(current: Destination): void {
    this.current = current;
    const pending = this.pending;
    if (pending) {
      if (pending.matches(current)) {
        this.finish(pending);
        return;
      }
      if (pending.passing.some((entry) => sameDestination(entry, current))) return;
      this.release(pending);
    }
    this.update(recordDestination(this.history, current));
  }

  canGo(direction: Direction, available: (entry: Destination) => boolean): boolean {
    return stepHistory(this.history, direction, available, this.current) !== undefined;
  }

  /**
   * Wait for a destination that `matches`, ignoring the `passing` destinations a request shows
   * on its way there.
   * Call the result when the request finishes; a failure records wherever the user ended up.
   * The returned `current` reports whether a newer navigation has superseded this one.
   */
  expect(
    matches: (entry: Destination) => boolean,
    passing: readonly Destination[] = [],
  ): [Settle, Current] {
    return this.wait({ matches, passing, traversal: false });
  }

  /** Move through history, restoring the destination with `restore`. */
  go(
    direction: Direction,
    available: (entry: Destination) => boolean,
    restore: (entry: Destination, current: Current) => Promise<void> | void,
    passing: readonly Destination[] = [],
  ): void {
    const previous = this.history;
    const next = stepHistory(previous, direction, available, this.current);
    const target = next?.entries[next.index];
    if (!next || !target) return;
    const [settle, current] = this.wait({
      matches: (entry) => fulfils(entry, target),
      passing: [this.current, ...passing],
      traversal: true,
    });
    this.update(next);
    const revert = () => this.update(previous);
    let result: Promise<void> | void;
    try {
      result = restore(target, current);
    } catch (cause) {
      settle(false, revert);
      throw cause;
    }
    if (!result) {
      settle(true);
      return;
    }
    result.then(
      () => settle(true),
      () => settle(false, revert),
    );
  }

  dispose(): void {
    if (this.pending) this.timers.clear(this.pending.timer);
    this.pending = undefined;
  }

  private wait(pending: Pending): [Settle, Current] {
    if (this.pending) this.release(this.pending);
    const current = () => this.pending === pending;
    // A request that is already satisfied has nothing to wait for.
    if (pending.matches(this.current)) {
      if (pending.traversal) this.update(resolveEntry(this.history, this.current));
      return [() => {}, () => true];
    }
    this.pending = pending;
    const settle: Settle = (ok, onFailure) => {
      if (!current()) return;
      if (ok) {
        pending.timer = this.timers.set(() => this.finish(pending), settleMs);
        return;
      }
      onFailure?.();
      this.release(pending);
      this.update(recordDestination(this.history, this.current));
    };
    return [settle, current];
  }

  /** The request ended: account for wherever the user is now. */
  private finish(pending: Pending): void {
    if (!this.release(pending)) return;
    this.update(
      pending.traversal
        ? resolveEntry(this.history, this.current)
        : recordDestination(this.history, this.current),
    );
  }

  private release(pending: Pending): boolean {
    if (this.pending !== pending) return false;
    this.timers.clear(pending.timer);
    this.pending = undefined;
    return true;
  }

  private update(history: NavigationHistory): void {
    if (history === this.history) return;
    this.history = history;
    this.onChange();
  }
}

const destinationKey = ({ page, section, chat }: Destination) =>
  `${page}\u0000${section ?? ""}\u0000${chat ?? ""}`;

/** One history per window session; it starts fresh whenever the renderer starts. */
export function useNavigationHistory(current: Destination): NavigationRecorder {
  const [, rerender] = useState(0);
  const recorder = useRef<NavigationRecorder | undefined>(undefined);
  recorder.current ??= new NavigationRecorder(current, () => rerender((value) => value + 1));
  const latest = useRef(current);
  latest.current = current;
  const key = destinationKey(current);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key identifies `current`.
  useEffect(() => recorder.current?.observe(latest.current), [key]);
  useEffect(() => () => recorder.current?.dispose(), []);
  return recorder.current;
}
