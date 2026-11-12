import type { DesktopRun, OrchestrationChat } from "../bridge/index.js";

export interface Conversation {
  id: string;
  label: string;
  role: "orchestrator" | "worker";
  parentId?: string;
}

const fallbackLabel = ({ record }: DesktopRun) => `${record.agent} / ${record.id.slice(-6)}`;

export function conversationTitle(
  chats: readonly OrchestrationChat[],
  chat: OrchestrationChat,
): string {
  if (chat.title) return chat.title;
  if (chat.kind === "relay") return "Relay";
  const peers = chats.filter(
    (other) => other.kind === chat.kind && other.projectId === chat.projectId,
  );
  return `Chat ${Math.max(0, peers.indexOf(chat)) + 1}`;
}

/** The orchestrator's role name for a worker, or its provider and short run ID. */
export function workerLabel(chats: readonly OrchestrationChat[], run: DesktopRun): string {
  for (const chat of chats) {
    const label = chat.workerLabels?.[run.record.id];
    if (label) return label;
  }
  return fallbackLabel(run);
}

/**
 * Ownership comes only from the current chat snapshots, never agent names or liveness. Finished
 * workers outside a current orchestrator are hidden unless selected; other unowned runs stay at
 * the root.
 */
export function conversations(
  chats: readonly OrchestrationChat[],
  runs: readonly DesktopRun[],
  selectedId?: string,
): Conversation[] {
  const result: Conversation[] = [];
  const owned = new Set<string>();
  const available = new Map(runs.map((run) => [run.record.id, run]));
  for (const chat of chats) {
    if (!chat.run || chat.archived) continue;
    result.push({
      id: chat.run.id,
      label: conversationTitle(chats, chat),
      role: "orchestrator",
    });
    for (const id of chat.workers ?? []) {
      if (!available.has(id) || owned.has(id)) continue;
      const run = available.get(id);
      if (!run) continue;
      owned.add(id);
      result.push({
        id,
        label: chat.workerLabels?.[id] || fallbackLabel(run),
        role: "worker",
        parentId: chat.run.id,
      });
    }
  }
  for (const run of runs) {
    if (
      owned.has(run.record.id) ||
      (run.record.id !== selectedId && (run.view?.status ?? run.record.status) === "finished")
    )
      continue;
    result.push({ id: run.record.id, label: workerLabel(chats, run), role: "worker" });
  }
  return result;
}

export interface OpenChat {
  id: string;
  serial: number;
  compose?: boolean;
  eventIndex?: number;
}

/** Preserve manual collapse until the owner gains a new child. */
export function reconcileDisclosure(
  previous: Readonly<Record<string, readonly string[]>>,
  next: readonly Conversation[],
  collapsed: ReadonlySet<string>,
): Set<string> {
  const result = new Set(collapsed);
  const parents = new Set(
    next.filter((entry) => entry.role === "orchestrator").map(({ id }) => id),
  );
  for (const id of result) if (!parents.has(id)) result.delete(id);
  for (const entry of next) {
    if (entry.parentId && !previous[entry.parentId]?.includes(entry.id))
      result.delete(entry.parentId);
  }
  return result;
}
