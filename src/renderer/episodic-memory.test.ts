import { describe, expect, it } from "vitest";
import {
  formatExtractionDuration,
  limitMemoryEvents,
  parseMemoryEventLimit,
} from "./episodic-memory.js";

describe("maximum extraction events", () => {
  it("accepts only whole numbers within the supported limit", () => {
    expect(parseMemoryEventLimit("1")).toBe(1);
    expect(parseMemoryEventLimit("10000")).toBe(10000);
    for (const value of ["", "0", "-1", "1.5", "10001", "NaN", "Infinity", "1e2"]) {
      expect(parseMemoryEventLimit(value)).toBeUndefined();
    }
  });
  it("caps the total across sessions, keeping their current order", () => {
    const runs = [
      { id: "empty", count: 0 },
      { id: "first", count: 4 },
      { id: "second", count: 8 },
    ];
    expect(limitMemoryEvents(runs, 2)).toEqual([{ id: "first", count: 2 }]);
    expect(limitMemoryEvents(runs, 4)).toEqual([{ id: "first", count: 4 }]);
    expect(limitMemoryEvents(runs, 7)).toEqual([
      { id: "first", count: 4 },
      { id: "second", count: 3 },
    ]);
    expect(limitMemoryEvents(runs, 10000)).toEqual(runs.slice(1));
    expect(limitMemoryEvents(runs, 0)).toEqual([]);
    expect(limitMemoryEvents([], 10)).toEqual([]);
    expect(runs[2]?.count).toBe(8);
  });
  it("allows a bounded selection from a project exceeding the safety ceiling", () => {
    expect(
      limitMemoryEvents(
        [
          { id: "large", count: 20000 },
          { id: "later", count: 5 },
        ],
        10000,
      ),
    ).toEqual([{ id: "large", count: 10000 }]);
  });
});

describe("extraction duration", () => {
  it("formats short durations and minute boundaries", () => {
    expect(formatExtractionDuration(0)).toBe("0.0s");
    expect(formatExtractionDuration(1234)).toBe("1.2s");
    expect(formatExtractionDuration(59940)).toBe("59.9s");
    expect(formatExtractionDuration(59999)).toBe("1m 0s");
    expect(formatExtractionDuration(90400)).toBe("1m 30s");
    expect(formatExtractionDuration(300000)).toBe("5m 0s");
  });
});
