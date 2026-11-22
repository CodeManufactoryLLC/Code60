import type { WorkflowEvent } from "../bridge/index.js";

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
