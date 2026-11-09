import { describe, expect, it } from "vitest";
import { parseLogClear, parseLogDetail, parseLogQuery } from "./index.js";

describe("diagnostic bridge validation", () => {
  it("bounds pages, conditions, search and cursors without accepting paths", () => {
    expect(parseLogQuery({}).limit).toBe(100);
    for (const input of [
      { path: "/private" },
      { limit: 201 },
      { limit: 0 },
      { cursor: "../log" },
      { search: "a".repeat(201) },
      { projectId: "/project" },
      { conditions: Array(25).fill({ column: "event", op: "eq", value: "app.start" }) },
      { conditions: [{ column: "prompt", op: "eq", value: "secret" }] },
    ])
      expect(() => parseLogQuery(input)).toThrow();
    expect(
      parseLogQuery({
        scope: "current",
        conditions: [{ column: "severity", op: "eq", value: "error" }],
      }),
    ).toMatchObject({ scope: "current" });
  });
  it("requires exact detail identity and an explicit clear intent", () => {
    expect(() => parseLogDetail({ id: "no" })).toThrow();
    expect(() => parseLogDetail({ id: crypto.randomUUID(), path: "/tmp" })).toThrow();
    for (const input of [undefined, {}, { confirm: false }, { confirm: true, path: "/tmp" }])
      expect(() => parseLogClear(input)).toThrow();
    expect(parseLogClear({ confirm: true })).toEqual({ confirm: true });
  });
});
