import {
  type WorkflowEvent,
  type WorkflowSnapshot,
  workflowVerdictSchema,
} from "../bridge/index.js";

/** Keep an inspectable window; complete activity remains in the external engine. */
export function retainWorkflowActivity(current: WorkflowEvent[], incoming: WorkflowEvent[]) {
  const seen = new Set(current.map((event) => event.sequence));
  const events = [...current];
  for (const event of incoming)
    if (!seen.has(event.sequence)) {
      seen.add(event.sequence);
      events.push(event);
    }
  let size = events.reduce((sum, event) => sum + JSON.stringify(event).length, 0);
  let first = 0;
  while (first < events.length && (size > 1_000_000 || events.length - first > 1000)) {
    size -= JSON.stringify(events[first]).length;
    first++;
  }
  return { events: events.slice(first), trimmed: first > 0 };
}

/** Combine adjacent tool updates without collapsing intervening workflow decisions. */
export function workflowActivityRows(events: WorkflowEvent[], expanded: boolean) {
  const rows: { event: WorkflowEvent; firstSequence: number; toolUpdates: number }[] = [];
  for (const event of events) {
    const folded = !expanded && event.kind === "tool";
    const previous = rows.at(-1);
    if (folded && previous?.toolUpdates) {
      previous.event = event;
      previous.toolUpdates++;
    } else {
      rows.push({ event, firstSequence: event.sequence, toolUpdates: folded ? 1 : 0 });
    }
  }
  return rows.reverse();
}

/** A compact fold of the entire event stream, independent of the visible log window. */
export const emptyWorkflowClock = {
  cursor: 0,
  elapsed: 0,
  lastTime: 0,
  since: null as number | null,
  paused: false,
  question: "" as "" | "scope" | "permission",
  valid: true,
  accepted: 0,
  ended: false,
  verdict: null as WorkflowSnapshot["accepted"][number]["verdict"] | null,
};

export function advanceWorkflowClock(
  previous: typeof emptyWorkflowClock,
  events: WorkflowEvent[],
  total: number,
) {
  const clock = { ...previous };
  for (const event of events) {
    if (event.sequence <= clock.cursor) continue;
    const time = Date.parse(event.time);
    if (
      (!clock.cursor && event.kind !== "started") ||
      !Number.isFinite(time) ||
      time < clock.lastTime
    )
      clock.valid = false;
    clock.cursor = event.sequence;
    clock.lastTime = time;
    switch (event.kind) {
      case "paused":
        clock.paused = true;
        break;
      case "pause_requested":
        if (clock.question === "permission") clock.question = "";
        break;
      case "resumed":
        clock.paused = false;
        break;
      case "needs_input":
        clock.question = Array.isArray(event.detail.options) ? "permission" : "scope";
        break;
      case "answered":
        clock.question = "";
        break;
      case "attempt_ended":
        clock.question = "";
        clock.ended = event.detail.next === "failed";
        break;
      case "verdict": {
        const parsed = workflowVerdictSchema.safeParse(event.detail);
        clock.verdict = parsed.success ? parsed.data : null;
        break;
      }
      case "task_accepted":
        clock.verdict = null;
        clock.ended = ++clock.accepted === total;
        break;
      case "cancelled":
        clock.ended = true;
        break;
    }
    if (clock.paused || clock.question || clock.ended) {
      if (clock.since !== null) clock.elapsed += time - clock.since;
      clock.since = null;
    } else {
      clock.since ??= time;
    }
  }
  return clock;
}

export function workflowTime(
  clock: typeof emptyWorkflowClock,
  cursor: number | undefined,
  now: number,
) {
  if (!clock.valid || !clock.cursor || clock.cursor !== cursor || !Number.isFinite(now))
    return "Unavailable";
  const seconds = Math.floor(
    (clock.elapsed + (clock.since === null ? 0 : Math.max(0, now - clock.since))) / 1000,
  );
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return (
    (hours ? `${hours}:${String(minutes).padStart(2, "0")}` : String(minutes)) +
    `:${String(seconds % 60).padStart(2, "0")}`
  );
}
