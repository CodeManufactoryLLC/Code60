import type { RunEvent } from "../core/index.js";

/** One reply per turn, even when tools/thoughts separate streamed text chunks. */
export function replyTurns(events: readonly RunEvent[]): number[] {
  const replies = new Set<number>();
  let turn = 1;
  for (const event of events) {
    if (event.type === "prompt") turn = event.turn;
    else if (event.type === "status" && event.turn !== undefined) turn = event.turn;
    else if (event.type === "turnEnd") turn = event.turn + 1;
    else if (event.type === "message" && event.text.trim()) replies.add(turn);
  }
  return [...replies];
}

export function unreadCount(turns: readonly number[], read: number): number {
  return turns.filter((turn) => turn > read).length;
}

export function readMarkerKey(database: string, runId: string, kind?: "reply-count"): string {
  return `code60.chatRead:${JSON.stringify(kind ? [database, runId, kind] : [database, runId])}`;
}

export function loadReadMarker(storage: Pick<Storage, "getItem">, key: string): number {
  try {
    const value = Number(storage.getItem(key));
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}
