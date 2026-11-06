import { describe, expect, it, vi } from "vitest";
import type { DesktopRun } from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";
import { highlights, searchExcerpt, searchIndex, searchResults } from "./search.js";
import { completedTurns } from "./telemetry.js";
import { TranscriptCache } from "./transcripts.js";

const run = (id: string, agent = "codex", day = "01", turns = 1): DesktopRun => ({
  record: {
    id,
    agent,
    status: "finished",
    firstPrompt: "Build parser",
    turns,
    base: null,
    branch: null,
    worktree: "/project",
    ownerPid: 1,
    startedAt: `2026-11-${day}T12:00:00Z`,
  },
  agentAlive: false,
});
const events: RunEvent[] = [
  { runId: "parser", type: "prompt", turn: 4, text: "Fix syntax", at: "2026-11-01T12:00:00Z" },
  { runId: "parser", type: "message", text: "The parser ", at: "2026-11-01T12:00:01Z" },
  { runId: "parser", type: "message", text: "is fixed", at: "2026-11-01T12:00:02Z" },
  { runId: "parser", type: "status", status: "idle", at: "2026-11-01T12:00:06Z" },
];
describe("project search", () => {
  it("requires every term, joins streamed chunks and retains the first event's address", () => {
    const index = searchIndex("/project", [run("parser")], { parser: events });
    const found = searchResults(index, "PARSER Fixed");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ runId: "parser", eventIndex: 1, text: "The parser is fixed" });
    expect(searchResults(index, "parser absent")).toEqual([]);
    expect(searchResults(index, "fixed", "thought")).toEqual([]);
  });
  it("keeps result excerpts on the matching line", () => {
    expect(searchExcerpt("Review parser\nfinished\n/a/long/path", "parser")).toBe("Review parser");
    expect(searchExcerpt("Review parser\nfinished\n/a/long/path", "path")).toBe("/a/long/path");
  });
  it("ranks titles and exact identifiers before content; newest is independent of relevance", () => {
    const index = searchIndex("/project", [run("parser"), run("other", "claude", "02")], {
      parser: events,
    });
    expect(searchResults(index, "parser")[0]?.id).toBe("parser");
    expect(searchResults(index, "parser", "all", "newest")[0]?.id).toBe("other");
    expect(searchResults(index, "project", "project")[0]?.kind).toBe("project");
  });
  it("updates the index as messages stream and highlights overlapping terms without HTML", () => {
    expect(
      searchResults(
        searchIndex("/project", [run("parser")], { parser: events.slice(0, 2) }),
        "fixed",
      ),
    ).toEqual([]);
    expect(highlights("<script> Parser", "parse parser")).toEqual([
      { text: "<script> ", match: false, start: 0 },
      { text: "Parser", match: true, start: 9 },
    ]);
  });
});
describe("completed turn telemetry", () => {
  it("preserves turn ordinals", () => {
    expect(completedTurns(events)).toEqual([{ ordinal: 4, seconds: 6 }]);
  });
  it("does not invent duration data for incomplete or backwards timestamps", () => {
    expect(completedTurns(events.slice(0, 3))).toEqual([]);
    expect(
      completedTurns([
        ...events.slice(0, 3),
        { ...events[3], at: "2026-10-31T00:00:00Z" } as RunEvent,
      ]),
    ).toEqual([]);
  });
});
describe("shared transcript reads", () => {
  it("deduplicates concurrent reads and cached versions, reloads changed runs", async () => {
    const action = vi.fn(async () => events);
    const cache = new TranscriptCache({ action });
    const request = [{ id: "parser", version: "1" }];
    await Promise.all([cache.load(request), cache.load(request)]);
    await cache.load(request);
    expect(action).toHaveBeenCalledTimes(1);
    await cache.load([{ id: "parser", version: "2" }]);
    expect(action).toHaveBeenCalledTimes(2);
    expect(cache.snapshot().events.parser).toEqual(events);
  });
  it("bounds reads across simultaneous manifests", async () => {
    let active = 0;
    let maximum = 0;
    const cache = new TranscriptCache({
      action: async () => {
        active++;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active--;
        return [];
      },
    });
    await Promise.all([
      cache.load(Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, version: "1" }))),
      cache.load(Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, version: "1" }))),
    ]);
    expect(maximum).toBe(4);
    expect(Object.keys(cache.snapshot().events)).toHaveLength(12);
  });
  it("keeps successful reads when another fails and retries only failures", async () => {
    const action = vi
      .fn()
      .mockResolvedValueOnce(events)
      .mockRejectedValueOnce(new Error("corrupt"));
    const cache = new TranscriptCache({ action });
    const request = [
      { id: "good", version: "1" },
      { id: "bad", version: "1" },
    ];
    await cache.load(request);
    expect(cache.snapshot()).toMatchObject({ pending: 0, events: { good: events } });
    expect(cache.snapshot().errors.bad).toContain("missing or corrupt");
    action.mockResolvedValueOnce([]);
    await cache.load(request, true);
    expect(action).toHaveBeenCalledTimes(3);
    expect(cache.snapshot().errors).toEqual({});
  });
  it("discards stale responses and does not start queued reads after switching projects", async () => {
    let resolve: (value: RunEvent[]) => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<RunEvent[]>((done) => {
          resolve = done;
        }),
    );
    const cache = new TranscriptCache({ action });
    const read = cache.load([{ id: "old", version: "1" }]);
    await Promise.resolve();
    cache.dispose();
    resolve(events);
    await read;
    expect(cache.snapshot().events).toEqual({});
    const other = new TranscriptCache({ action: async () => [] });
    await other.load([{ id: "new", version: "1" }]);
    expect(other.snapshot().events).toEqual({ new: [] });
  });
});
