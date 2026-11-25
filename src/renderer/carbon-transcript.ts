import {
  type ChatInstance,
  type MessageResponse,
  MessageResponseTypes,
  MessageState,
  UserType,
} from "@carbon/ai-chat";

type Messaging = Pick<
  ChatInstance["messaging"],
  "insertHistory" | "upsertMessage" | "removeMessages"
>;
type Turn = [id: string, author: "user" | "assistant" | null, at: string | null];

function response([id, author, at]: Turn, slot: number): MessageResponse {
  const timestamp = at ? Date.parse(at) : Number.NaN;
  return {
    id,
    ...(Number.isFinite(timestamp) ? { history: { timestamp } } : {}),
    message_options: {
      response_user_profile:
        author === "user"
          ? { id: "user", nickname: "You", user_type: UserType.HUMAN }
          : { id: "code60", nickname: "Code60", user_type: UserType.BOT },
    },
    output: {
      generic: [
        {
          response_type: MessageResponseTypes.USER_DEFINED,
          full_width: true,
          user_defined: { slot },
        },
      ],
    },
  };
}

/** A presentation cache for one mounted SDK instance. Only the backend supplies turns. */
export class CarbonTranscript {
  private displayed: Turn[] = [];
  private serial = 0;
  private slots = new Map<string, number>();

  isCurrent(id: string, slot: unknown) {
    return typeof slot === "number" && this.slots.get(id) === slot;
  }

  private mount(turn: Turn) {
    const slot = ++this.serial;
    this.slots.set(turn[0], slot);
    return response(turn, slot);
  }

  async reconcile(messaging: Messaging, turns: Turn[], current: () => boolean) {
    const wanted = new Set(turns.map(([id]) => id));
    const retired = this.displayed.filter(([id]) => !wanted.has(id));
    const remove = async (items: Turn[]) => {
      if (!items.length) return;
      await messaging.removeMessages(items.map(([id]) => id));
      // Carbon retains old light-DOM portal hosts until the instance is destroyed.
      // A removed host must never render a rebound ID or a second approval control.
      for (const [id] of items) this.slots.delete(id);
    };
    await remove(retired);
    this.displayed = this.displayed.filter(([id]) => wanted.has(id));
    if (!current()) return;
    const existing = new Set(this.displayed.map(([id]) => id));
    const firstRetained = turns.findIndex(([id]) => existing.has(id));
    const earlier = turns.slice(0, firstRetained < 0 ? turns.length : firstRetained);
    if (earlier.length) {
      // Hydration prepends without dispatching input, replaying welcome, or moving
      // the existing message slots. The SDK preserves the relative scroll offset.
      await messaging.insertHistory(
        earlier.map((turn) => ({
          message: this.mount(turn),
          time: turn[2] ?? new Date().toISOString(),
        })),
      );
      this.displayed = [...earlier, ...this.displayed];
      if (!current()) return;
    }
    let start = 0;
    while (
      start < turns.length &&
      turns[start]?.every((value, i) => value === this.displayed[start]?.[i])
    )
      start++;
    await remove(this.displayed.slice(start));
    this.displayed.length = start;
    for (const turn of turns.slice(start)) {
      if (!current()) return;
      const message = this.mount(turn);
      await messaging.upsertMessage(turn[0], MessageState.COMPLETE, () => message);
      this.displayed.push(turn);
    }
  }
}
