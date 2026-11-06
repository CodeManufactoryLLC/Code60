import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { RunResult } from "../core/index.js";
import { formatResultsJson, formatResultsTable } from "./headless.js";
import { type SignalName, watchSignals } from "./signals.js";
import { clean, oneLine, table, wrap, wrapWords } from "./text.js";

describe("text helpers", () => {
  it("strips escape sequences and control characters from untrusted text", () => {
    expect(clean("a\x1b[31mred\x1b[0m\x07b\nc")).toBe("aredb\nc");
    expect(oneLine("one\n  two\tthree", 9)).toBe("one two …");
  });

  it("wraps and tabulates", () => {
    expect(wrap("abcdef\n\nxy", 4)).toEqual(["abcd", "ef", "", "xy"]);
    expect(wrapWords("a b  quit  abcdefgh", 6)).toEqual(["a b", "quit", "abcdef", "gh"]);
    expect(table(["A", "BB"], [["xyz", "1"]])).toBe("A    BB\nxyz  1\n");
  });
});

describe("results", () => {
  const results: RunResult[] = [
    {
      id: "r1",
      agent: "claude",
      status: "finished",
      reason: null,
      branch: "code60/r1",
      worktree: "/w/r1",
      changedFiles: 2,
    },
    {
      id: "r2",
      agent: "codex",
      status: "failed",
      reason: "boom",
      branch: "code60/r2",
      worktree: "/w/r2",
      changedFiles: null,
    },
  ];

  it("writes one JSON object with every run", () => {
    expect(JSON.parse(formatResultsJson(results))).toEqual({ runs: results });
  });

  it("writes a table that says finished runs were not verified", () => {
    const out = formatResultsTable(results);
    expect(out).toMatch(/^r1 +claude +finished +2 +code60\/r1$/m);
    expect(out).toMatch(/reason: +boom/);
    expect(out).toMatch(/not verified/);
  });
});

describe("watchSignals", () => {
  it("runs the first handler once, then the second, and unsubscribes", () => {
    const source = new EventEmitter();
    const calls: string[] = [];
    const watch = watchSignals(
      {
        on: (s: SignalName, l: () => void) => source.on(s, l),
        off: (s: SignalName, l: () => void) => source.off(s, l),
      },
      { first: () => calls.push("first"), second: () => calls.push("second") },
    );
    expect(watch.received).toBe(false);
    source.emit("SIGTERM");
    watch.trigger();
    source.emit("SIGINT");
    expect(calls).toEqual(["first", "second"]);
    expect(watch.received).toBe(true);
    watch.dispose();
    expect(source.listenerCount("SIGINT")).toBe(0);
  });
});
