import type { DesktopRun, Snapshot } from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";
export interface DesktopState {
  /** Renderer-only epochs retain replacement boundaries even when React batches renders. */
  databaseGeneration: number;
  projectGeneration: number;
  snapshot: Snapshot;
  events: Record<string, RunEvent[]>;
  chatEvents: RunEvent[];
  chatEventsByRun: Record<string, RunEvent[]>;
  /** Actual conversation event fences, independent of unrelated app revisions. */
  chatEventRevisions?: Record<string, number>;
  projectViews?: Record<
    string,
    { runs: DesktopRun[]; events: Record<string, RunEvent[]>; revision: number }
  >;
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
  const sameDatabase =
    state?.snapshot.database === update.database &&
    state?.snapshot.databaseEpoch === update.databaseEpoch;
  const sameWorkspace =
    sameDatabase &&
    state?.snapshot.directory === update.directory &&
    state?.snapshot.projectInstanceId === update.projectInstanceId;
  const projectViews = sameDatabase ? { ...state?.projectViews } : {};
  const retained = update.projectInstanceId ? projectViews[update.projectInstanceId] : undefined;
  const events = sameWorkspace ? { ...state.events } : { ...retained?.events };
  const after = sameWorkspace ? state.snapshot.revision : (retained?.revision ?? -1);
  const relayWorkers = new Set(update.runs.filter((run) => run.relay).map((run) => run.record.id));
  for (const id of relayWorkers) events[id] = update.summaryOnly ? (state?.events[id] ?? []) : [];
  for (const run of state?.snapshot.runs ?? [])
    if (run.relay && !relayWorkers.has(run.record.id)) delete events[run.record.id];
  for (const entry of update.events) {
    const id = entry.event.runId;
    if (!relayWorkers.has(id) && entry.revision <= after) continue;
    events[id] = [...(events[id] ?? []), entry.event];
  }
  const previousChats = sameDatabase ? state?.chatEventsByRun : {};
  const chatEventsByRun: Record<string, RunEvent[]> = {};
  const chatEventRevisions: Record<string, number> = {};
  for (const chat of update.chats.length ? update.chats : [update.chat]) {
    const id = chat.run?.id;
    if (!id) continue;
    chatEventRevisions[id] = chat.events.reduce(
      (revision, entry) => Math.max(revision, entry.revision),
      (sameDatabase ? state?.chatEventRevisions?.[id] : undefined) ?? -1,
    );
    if (chat.kind === "relay") {
      // Relay snapshots carry one bounded replacement window, never an append-only UI lifetime.
      const previous = state?.snapshot.chats.find((item) => item.run?.id === id);
      chatEventsByRun[id] =
        update.summaryOnly && previous?.generation === chat.generation
          ? (state?.chatEventsByRun[id] ?? [])
          : chat.events.map((entry) => entry.event);
      continue;
    }
    const previous = previousChats?.[id];
    const merged = [...(previous ?? [])];
    const after = previous ? (state?.snapshot.revision ?? -1) : -1;
    for (const entry of chat.events) {
      if (entry.revision > after && entry.event.runId === id) merged.push(entry.event);
    }
    chatEventsByRun[id] = merged;
  }
  const chatEvents = chatEventsByRun[update.chat.run?.id ?? ""] ?? [];
  if (update.projectInstanceId)
    projectViews[update.projectInstanceId] = {
      runs: update.runs.filter((run) => !run.relay),
      events: Object.fromEntries(Object.entries(events).filter(([id]) => !relayWorkers.has(id))),
      revision: update.summaryOnly ? (retained?.revision ?? -1) : update.revision,
    };
  if (update.openProjects) {
    const open = new Set(update.openProjects.map((project) => project.id));
    for (const id of Object.keys(projectViews)) if (!open.has(id)) delete projectViews[id];
    for (const project of update.openProjects) {
      if (project.id === update.projectInstanceId || !project.workerSummaries) continue;
      const previous = projectViews[project.id];
      const byId = new Map(previous?.runs.map((run) => [run.record.id, run]));
      projectViews[project.id] = {
        runs: project.workerSummaries.map((run) => ({
          ...run,
          record: {
            ...run.record,
            firstPrompt: byId.get(run.record.id)?.record.firstPrompt ?? run.record.firstPrompt,
          },
        })),
        events: previous?.events ?? {},
        revision: previous?.revision ?? -1,
      };
    }
  }
  return {
    projectViews,
    databaseGeneration: (state?.databaseGeneration ?? 0) + (state && !sameDatabase ? 1 : 0),
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
    chatEventRevisions,
  };
}
