import { expect, it } from "vitest";
import type { RunEvent } from "../core/index.js";
import { ConversationReplies } from "./conversation-replies.js";

const event = (value: object) =>
  ({ runId: "chat", at: "2026-11-12T00:00:00Z", ...value }) as RunEvent;
it("counts only the first substantive reply in each turn, including silent and failed turns", () => {
  const replies = new ConversationReplies();
  const events = [
    event({ type: "prompt", turn: 1, text: "First" }),
    event({ type: "message", text: " \n" }),
    event({ type: "thought", text: "Thinking" }),
    event({ type: "message", text: "First reply" }),
    event({ type: "message", text: "More" }),
    event({ type: "turnEnd", turn: 1, stopReason: "end_turn" }),
    event({ type: "prompt", turn: 2, text: "Silent" }),
    event({ type: "turnEnd", turn: 2, stopReason: "cancelled" }),
    event({ type: "status", status: "running", turn: 3 }),
    event({ type: "message", text: "Third reply" }),
  ];
  for (const entry of events) replies.event(entry);
  expect(replies.snapshot()).toEqual({ count: 2, lastTurn: 3 });
  replies.reset(events);
  expect(replies.snapshot()).toEqual({ count: 2, lastTurn: 3 });
  replies.reset();
  expect(replies.snapshot()).toEqual({ count: 0, lastTurn: 0 });
  replies.event(event({ type: "message", text: "Legacy reply without prompt" }));
  expect(replies.snapshot()).toEqual({ count: 1, lastTurn: 1 });
});

it("keeps the summary constant-size across a long conversation", () => {
  const replies = new ConversationReplies();
  for (let turn = 1; turn <= 100_000; turn++) {
    replies.event(event({ type: "prompt", turn, text: "Task" }));
    replies.event(event({ type: "message", text: "Reply" }));
    replies.event(event({ type: "message", text: "Chunk" }));
  }
  expect(replies.snapshot()).toEqual({ count: 100_000, lastTurn: 100_000 });
  expect(JSON.stringify(replies).length).toBeLessThan(64);
});
