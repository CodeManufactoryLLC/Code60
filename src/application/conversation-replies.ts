import type { RunEvent } from "../core/index.js";

/** Constant-space presentation summary. Live and saved event order is per turn. */
export class ConversationReplies {
  private turn = 1;
  private count = 0;
  private lastTurn = 0;

  event(event: RunEvent): void {
    if (event.type === "prompt") this.turn = event.turn;
    else if (event.type === "status" && event.turn !== undefined) this.turn = event.turn;
    else if (event.type === "turnEnd") this.turn = event.turn + 1;
    else if (event.type === "message" && event.text.trim() && this.turn > this.lastTurn) {
      this.count++;
      this.lastTurn = this.turn;
    }
  }

  reset(events: readonly RunEvent[] = []): void {
    this.turn = 1;
    this.count = 0;
    this.lastTurn = 0;
    for (const event of events) this.event(event);
  }

  snapshot(): { count: number; lastTurn: number } {
    return { count: this.count, lastTurn: this.lastTurn };
  }
}
