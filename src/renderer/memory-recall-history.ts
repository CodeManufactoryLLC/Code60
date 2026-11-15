import { memoryRecordSchema } from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";

export interface RecallTurn {
  key: string;
  turn: number;
  ids: { id: string; at: string }[];
  malformed: boolean;
  current: boolean;
}

/** Notes are evidence of recall, not a request to retrieve or browse memories. */
export function recallHistory(events: readonly RunEvent[], runId: string) {
  const groups: RecallTurn[] = [];
  let current: RecallTurn | undefined;
  for (const event of events) {
    if (event.runId !== runId) continue;
    if (event.type === "prompt") {
      current = {
        key: `${runId}:${event.turn}`,
        turn: event.turn,
        ids: [],
        malformed: false,
        current: false,
      };
      groups.push(current);
    } else if (event.type === "note" && event.text.startsWith("Memory used")) {
      if (!current) continue;
      try {
        // Current dispatch records at most 32 IDs. Never resolve arbitrary note text.
        const match = /^Memory used \((\d+)\)\. Inspect Data Viewer → Memories for sources\.$/.exec(
          event.text,
        );
        if (!match || !event.detail || event.detail.length > 2048) throw new Error();
        const ids: unknown = JSON.parse(event.detail);
        if (
          !Array.isArray(ids) ||
          ids.length > 32 ||
          ids.length !== Number(match[1]) ||
          !ids.every((id) => memoryRecordSchema.shape.id.safeParse(id).success)
        )
          throw new Error();
        for (const id of ids as string[])
          if (!current.ids.some((item) => item.id === id)) current.ids.push({ id, at: event.at });
        if (current.ids.length > 32) {
          current.ids = current.ids.slice(0, 32);
          current.malformed = true;
        }
      } catch {
        current.malformed = true;
      }
    }
  }
  const last = groups.at(-1);
  // Run turn counts advance during preparation, before dispatch. Only prompts
  // establish a dispatched turn, including after an unsent/cancelled preparation.
  if (last) last.current = true;
  // Preserve every recorded recall, plus the latest dispatched zero-hit turn.
  return {
    turns: groups.filter((group) => group.ids.length || group.malformed || group.current).reverse(),
  };
}
