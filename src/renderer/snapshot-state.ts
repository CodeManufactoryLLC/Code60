import type { Snapshot } from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";
export interface DesktopState {
  /** Renderer-only epochs retain replacement boundaries even when React batches renders. */
  databaseGeneration: number;
  projectGeneration: number;
  snapshot: Snapshot;
  events: Record<string, RunEvent[]>;
  chatEvents: RunEvent[];
  chatEventsByRun: Record<string, RunEvent[]>;
}

export function hasOrchestrationProvider(
  snapshot: Pick<Snapshot, "agents" | "orchestration" | "agentSetup"> | undefined,
): boolean {
  const provider = snapshot?.orchestration.provider;
  return (
    snapshot?.agentSetup?.complete === true &&
    provider != null &&
    snapshot.agents.includes(provider)
  );
}

/** Snapshot revisions and event revisions avoid duplicates across initial load and reload. */
export function applyUpdate(state: DesktopState | undefined, update: Snapshot): DesktopState {
  if (state && update.revision <= state.snapshot.revision) return state;
  const sameWorkspace =
    state?.snapshot.directory === update.directory && state?.snapshot.database === update.database;
  const events = sameWorkspace ? { ...state.events } : {};
  const after = sameWorkspace ? state.snapshot.revision : -1;
  for (const entry of update.events) {
    if (entry.revision <= after) continue;
    const id = entry.event.runId;
    events[id] = [...(events[id] ?? []), entry.event];
  }
  const previousChats = state?.snapshot.database === update.database ? state.chatEventsByRun : {};
  const chatEventsByRun: Record<string, RunEvent[]> = {};
  for (const chat of update.chats.length ? update.chats : [update.chat]) {
    const id = chat.run?.id;
    if (!id) continue;
    const previous = previousChats?.[id];
    const merged = [...(previous ?? [])];
    const after = previous ? (state?.snapshot.revision ?? -1) : -1;
    for (const entry of chat.events) {
      if (entry.revision > after && entry.event.runId === id) merged.push(entry.event);
    }
    chatEventsByRun[id] = merged;
  }
  const chatEvents = chatEventsByRun[update.chat.run?.id ?? ""] ?? [];
  return {
    databaseGeneration:
      (state?.databaseGeneration ?? 0) +
      (state && state.snapshot.database !== update.database ? 1 : 0),
    projectGeneration: (state?.projectGeneration ?? 0) + (state && !sameWorkspace ? 1 : 0),
    snapshot: {
      ...update,
      events: [],
      chat: { ...update.chat, events: [] },
      chats: update.chats.map((chat) => ({ ...chat, events: [] })),
    },
    events,
    chatEvents,
    chatEventsByRun,
  };
}
