import { expect, it } from "vitest";
import type { RunEvent } from "../core/index.js";
import { recallHistory } from "./memory-recall-history.js";

const a = "66ac0785-44b0-4cbd-9f5e-d85048c1ba11";
const b = "66ac0785-44b0-4cbd-9f5e-d85048c1ba12";
const at = "2026-11-15T12:00:00.000Z";
const prompt = (turn: number): RunEvent => ({
  type: "prompt",
  runId: "run",
  at,
  turn,
  text: "task",
});
const note = (ids: unknown[], detail = JSON.stringify(ids)): RunEvent => ({
  type: "note",
  runId: "run",
  at,
  text: `Memory used (${ids.length}). Inspect Data Viewer → Memories for sources.`,
  detail,
});

it("groups every recorded recall newest first and preserves repeated IDs in distinct turns", () => {
  const history = recallHistory(
    [prompt(1), note([a, a]), note([a, b]), prompt(2), note([a])],
    "run",
  );
  expect(
    history.turns.map((turn) => [turn.turn, turn.current, turn.ids.map((item) => item.id)]),
  ).toEqual([
    [2, true, [a]],
    [1, false, [a, b]],
  ]);
});

it("moves the current indicator on a zero-hit dispatched turn, including automatic turns", () => {
  const result = recallHistory(
    [prompt(1), note([a]), { ...prompt(2), origin: "automatic" } as RunEvent],
    "run",
  );
  expect(result.turns.map((turn) => [turn.turn, turn.current, turn.ids.length])).toEqual([
    [2, true, 0],
    [1, false, 1],
  ]);
  expect(recallHistory([prompt(1)], "run").turns[0]?.ids).toEqual([]);
  expect(recallHistory([], "run")).toEqual({ turns: [] });
});

it("does not invent earlier turns or attribute orphan notes to a later prompt", () => {
  const result = recallHistory([note([a]), prompt(7), note([b])], "run");
  expect(result.turns).toHaveLength(1);
  expect(result.turns[0]).toMatchObject({ turn: 7, ids: [{ id: b, at }] });
  expect(
    recallHistory([prompt(1), note([a]), prompt(3)], "run").turns.map((turn) => turn.turn),
  ).toEqual([3, 1]);
});

it("does not advance the current dispatched turn for unsent or cancelled preparation", () => {
  const result = recallHistory(
    [
      prompt(1),
      note([a]),
      { type: "status", runId: "run", at, status: "running" },
      {
        type: "note",
        runId: "run",
        at,
        text: "Memory preparation failed. This message was not sent.",
      },
      { type: "status", runId: "run", at, status: "idle" },
    ],
    "run",
  );
  expect(result.turns.map((turn) => [turn.turn, turn.current])).toEqual([[1, true]]);
});

it.each([
  note([a], "not JSON"),
  note(["../../secret"]),
  note([a], "{}"),
  note([a], JSON.stringify([a, b])),
  note(Array.from({ length: 33 }, () => a)),
  note([a], " ".repeat(2049)),
  { ...note([a]), text: "Memory used (1). arbitrary text" },
])("labels malformed recall notes and never resolves their contents: %j", (event) => {
  const turn = recallHistory([prompt(1), event], "run").turns[0];
  expect(turn?.malformed).toBe(true);
  expect(turn?.ids).toEqual([]);
});

it("ignores unrelated notes and events from another run", () => {
  const result = recallHistory(
    [
      prompt(1),
      { ...note([a]), runId: "other" },
      { type: "note", runId: "run", at, text: "An ordinary note", detail: JSON.stringify([b]) },
    ],
    "run",
  );
  expect(result.turns[0]).toMatchObject({ malformed: false, ids: [] });
});

it("retains more recall turns than one rendered page without a latest-only history cap", () => {
  const events = Array.from({ length: 1200 }, (_, index) => [prompt(index + 1), note([a])]).flat();
  const result = recallHistory(events, "run");
  expect(result.turns).toHaveLength(1200);
  expect(result.turns[0]?.turn).toBe(1200);
  expect(result.turns.at(-1)?.turn).toBe(1);
});
