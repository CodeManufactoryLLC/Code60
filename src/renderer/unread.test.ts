import { describe, expect, it } from "vitest";
import type { RunEvent } from "../core/index.js";
import { loadReadMarker, readMarkerKey, replyTurns, unreadCount } from "./unread.js";

const event = (body: object) => ({ runId: "a", at: "2026-01-01", ...body }) as RunEvent;
const prompt = (turn: number) => event({ type: "prompt", turn, text: "private prompt" });
const message = (text: string) => event({ type: "message", text });

describe("unread replies", () => {
  it("keeps compact count markers distinct from legacy turn markers while storing identifiers only", () => {
    const counter = readMarkerKey("/db", "chat", "reply-count");
    expect(counter).not.toBe(readMarkerKey("/db", "chat"));
    expect(JSON.parse(counter.slice("code60.chatRead:".length))).toEqual([
      "/db",
      "chat",
      "reply-count",
    ]);
    expect(loadReadMarker({ getItem: () => "12" }, counter)).toBe(12);
  });
  it("starts at the first nonempty text and counts a turn once across chunks and activity", () => {
    const events = [
      prompt(1),
      message(""),
      message(" \n"),
      event({ type: "thought", text: "thought" }),
    ];
    expect(replyTurns(events)).toEqual([]);
    events.push(message("first"));
    expect(replyTurns(events)).toEqual([1]);
    events.push(
      event({
        type: "toolCall",
        toolCallId: "t",
        title: "tool",
        kind: "read",
        status: "completed",
      }),
      event({ type: "status", status: "running" }),
      message("second chunk"),
      event({ type: "thought", text: "more" }),
      message("last chunk"),
    );
    expect(replyTurns(events)).toEqual([1]);
    expect(unreadCount(replyTurns(events), 0)).toBe(1);
  });

  it("uses prompt turn boundaries including automatic turns, ignoring non-reply events", () => {
    const events = [
      prompt(1),
      message("one"),
      event({ type: "turnEnd", turn: 1, stopReason: "end_turn" }),
      prompt(2),
      event({ type: "status", status: "running", turn: 2 }),
      event({ type: "prompt", turn: 2, origin: "automatic", text: "update" }),
      message("two"),
      message("chunk"),
      event({ type: "turnEnd", turn: 2, stopReason: "cancelled" }),
      prompt(3),
    ];
    expect(replyTurns(events)).toEqual([1, 2]);
    expect(unreadCount(replyTurns(events), 1)).toBe(1);
    expect(unreadCount(replyTurns(events), 2)).toBe(0);
    expect(
      replyTurns([
        message("legacy"),
        event({ type: "turnEnd", turn: 1, stopReason: "end_turn" }),
        message("next"),
      ]),
    ).toEqual([1, 2]);
  });

  it("restores read markers after reload, isolated by database and conversation, without content", () => {
    const saved = new Map<string, string>();
    const storage = { getItem: (key: string) => saved.get(key) ?? null };
    const key = readMarkerKey("/db", "a");
    const events = [prompt(1), message("secret"), prompt(2), message("reply")];
    expect(unreadCount(replyTurns(events), loadReadMarker(storage, key))).toBe(2);
    saved.set(key, String(Math.max(0, ...replyTurns(events))));
    expect(unreadCount(replyTurns(events), loadReadMarker(storage, key))).toBe(0);
    events.push(message("streamed after opening"));
    expect(unreadCount(replyTurns(events), loadReadMarker(storage, key))).toBe(0);
    events.push(prompt(3), message("new background turn"));
    expect(unreadCount(replyTurns(events), loadReadMarker(storage, key))).toBe(1);
    expect(loadReadMarker(storage, readMarkerKey("/db", "b"))).toBe(0);
    expect(loadReadMarker(storage, readMarkerKey("/other-db", "a"))).toBe(0);
    expect([...saved.entries()]).toEqual([[key, "2"]]);
    for (const invalid of ["-1", "1.5", "NaN", "Infinity", "{}"]) {
      saved.set(key, invalid);
      expect(loadReadMarker(storage, key)).toBe(0);
    }
    expect(
      loadReadMarker(
        {
          getItem: () => {
            throw new Error("blocked");
          },
        },
        key,
      ),
    ).toBe(0);
  });
});
