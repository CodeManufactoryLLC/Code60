import type { DesktopRun, OrchestrationChat } from "../bridge/index.js";

export interface Conversation {
  id: string;
  label: string;
  role: "orchestrator" | "worker";
  parentId?: string;
}

/** Ownership comes only from the current chat snapshots, never agent names or liveness. */
export function conversations(
  chats: readonly OrchestrationChat[],
  runs: readonly DesktopRun[],
): Conversation[] {
  const result: Conversation[] = [];
  const owned = new Set<string>();
  const available = new Map(runs.map((run) => [run.record.id, run]));
  for (const [index, chat] of chats.entries()) {
    if (!chat.run || chat.archived) continue;
    result.push({
      id: chat.run.id,
      label: chat.title ?? `Chat ${index + 1}`,
      role: "orchestrator",
    });
    for (const id of chat.workers ?? []) {
      if (!available.has(id) || owned.has(id)) continue;
      const run = available.get(id);
      if (!run) continue;
      owned.add(id);
      result.push({
        id,
        label: `${run.record.agent} / ${id.slice(-6)}`,
        role: "worker",
        parentId: chat.run.id,
      });
    }
  }
  for (const { record } of runs) {
    if (owned.has(record.id)) continue;
    result.push({
      id: record.id,
      label: `${record.agent} / ${record.id.slice(-6)}`,
      role: "worker",
    });
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
