import type { RunEvent, RunStatus } from "../core/index.js";
import { statusSpec } from "./state.js";

/** Inline chart data for a session row, derived only from its recorded events. */
export const turnSamples = 6;
export const bucketCount = 10;
export const bucketSeconds = 30;
export const historySeconds = 120;

export interface HistorySpan {
  status: RunStatus;
  /** Seconds from the start of the two-minute window. */
  start: number;
  seconds: number;
}
export interface Telemetry {
  /** Durations of the last completed turns in seconds, oldest first; null without any. */
  turns: number[] | null;
  /** Event counts per 30-second bucket, oldest first; null when the run has no events. */
  buckets: number[] | null;
  /** State spans in the last two minutes, oldest first; null without status events. */
  history: HistorySpan[] | null;
}

const inTurn = new Set<RunStatus>(["running", "waiting"]);

export interface CompletedTurn {
  ordinal: number;
  seconds: number;
}
/** Full turn history for comparisons; inline cells take their own final six samples. */
export function completedTurns(events: readonly RunEvent[]): CompletedTurn[] {
  const turns: CompletedTurn[] = [];
  let start: { at: number; ordinal: number } | undefined;
  for (const event of events) {
    const at = Date.parse(event.at);
    if (event.type === "prompt")
      start = Number.isFinite(at) ? { at, ordinal: event.turn } : undefined;
    else if (event.type === "status" && !inTurn.has(event.status) && start) {
      if (Number.isFinite(at) && at >= start.at)
        turns.push({ ordinal: start.ordinal, seconds: (at - start.at) / 1000 });
      start = undefined;
    }
  }
  return turns;
}

/** Raw ACP copies and turn-end records would double-count the activity they describe. */
const activity = (event: RunEvent) =>
  event.type !== "status" &&
  event.type !== "acp" &&
  event.type !== "sessionState" &&
  event.type !== "turnEnd";

export function telemetry(events: readonly RunEvent[] | undefined, now: number): Telemetry {
  if (!events?.length) return { turns: null, buckets: null, history: null };
  const turns = completedTurns(events).map((turn) => turn.seconds);
  const buckets = Array<number>(bucketCount).fill(0);
  const bucketStart = now - bucketCount * bucketSeconds * 1000;
  const statuses: { status: RunStatus; at: number }[] = [];
  for (const event of events) {
    const at = Date.parse(event.at);
    if (Number.isNaN(at)) continue;
    if (event.type === "status") {
      statuses.push({ status: event.status, at });
    } else if (activity(event) && at >= bucketStart && at < now) {
      const index = Math.floor((at - bucketStart) / (bucketSeconds * 1000));
      buckets[index] = (buckets[index] ?? 0) + 1;
    }
  }
  return {
    turns: turns.length ? turns.slice(-turnSamples) : null,
    buckets,
    history: statuses.length ? history(statuses, now) : null,
  };
}

function history(statuses: { status: RunStatus; at: number }[], now: number): HistorySpan[] {
  const windowStart = now - historySeconds * 1000;
  const spans: HistorySpan[] = [];
  statuses.forEach((entry, index) => {
    const end = Math.min(now, statuses[index + 1]?.at ?? now);
    const start = Math.max(windowStart, entry.at);
    if (end <= start) return;
    const span = {
      status: entry.status,
      start: (start - windowStart) / 1000,
      seconds: (end - start) / 1000,
    };
    const last = spans.at(-1);
    if (last?.status === span.status && last.start + last.seconds === span.start)
      last.seconds += span.seconds;
    else spans.push(span);
  });
  return spans;
}

const seconds = (value: number) => `${Math.round(value)} s`;
export const latestTurn = (data: Telemetry) =>
  data.turns ? seconds(data.turns.at(-1) ?? 0) : "Unavailable";
export const eventTotal = (data: Telemetry) =>
  data.buckets ? String(data.buckets.reduce((sum, count) => sum + count, 0)) : "Unavailable";

export function describeTurns(data: Telemetry): string {
  if (!data.turns) return "Turn time unavailable";
  const count = data.turns.length;
  return `Last ${count} completed ${count === 1 ? "turn" : "turns"} in seconds: ${data.turns
    .map((value) => Math.round(value))
    .join(", ")}`;
}
export function describeBuckets(data: Telemetry): string {
  if (!data.buckets) return "Events unavailable";
  return `Events in ten 30-second buckets, oldest first: ${data.buckets.join(", ")}`;
}
export function describeHistory(data: Telemetry): string {
  if (!data.history?.length) return "Unavailable";
  return data.history
    .map((span, index) => {
      const label = statusSpec[span.status].label;
      return `${index ? label.toLowerCase() : label} ${Math.round(span.seconds)}s`;
    })
    .join(", ");
}
