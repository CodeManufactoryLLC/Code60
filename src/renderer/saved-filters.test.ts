import { describe, expect, it } from "vitest";
import {
  type FilterField,
  filterKey,
  filterProblem,
  matchesSavedFilter,
  parseFilterLibrary,
  type SavedFilter,
} from "./saved-filters.js";

const fields: FilterField[] = [
  { key: "agent", title: "Agent", kind: "text" },
  { key: "turns", title: "Turns", kind: "number" },
  { key: "at", title: "Date", kind: "date" },
];
const filter: SavedFilter = {
  version: 1,
  id: "a",
  name: "Busy",
  mode: "all",
  conditions: [
    { id: "a", column: "agent", kind: "text", op: "contains", value: "code" },
    { id: "b", column: "turns", kind: "number", op: "ge", value: "2" },
  ],
};
const cells = (row: Record<string, unknown>) => (column: string) => ({
  raw: row[column],
  text: String(row[column] ?? ""),
});
describe("named filters", () => {
  it("round trips definitions and active selection with independent table and project keys", () => {
    const library = { version: 1, definitions: [filter], active: "a" };
    expect(parseFilterLibrary(JSON.stringify(library))).toEqual({ library, error: "" });
    expect(filterKey("sessions", "/a")).not.toBe(filterKey("sessions", "/b"));
    expect(filterKey("sessions", "/a")).not.toBe(filterKey("messages", "/a"));
    expect(filterKey("polling", "db-a")).not.toBe(filterKey("polling", "db-b"));
  });
  it("combines typed conditions with all or any", () => {
    expect(filterProblem(filter, fields)).toBe("");
    expect(matchesSavedFilter(filter, cells({ agent: "Codex", turns: 3 }))).toBe(true);
    expect(matchesSavedFilter(filter, cells({ agent: "Codex", turns: 1 }))).toBe(false);
    expect(
      matchesSavedFilter({ ...filter, mode: "any" }, cells({ agent: "Codex", turns: 1 })),
    ).toBe(true);
  });
  it("evaluates relative dates at an injected clock and excludes future dates", () => {
    const now = Date.parse("2026-11-01T12:00:00Z");
    const recent: SavedFilter = {
      ...filter,
      conditions: [{ id: "c", column: "at", kind: "date", op: "recent", value: "10" }],
    };
    expect(matchesSavedFilter(recent, cells({ at: now - 5 * 60000 }), now)).toBe(true);
    expect(matchesSavedFilter(recent, cells({ at: now - 11 * 60000 }), now)).toBe(false);
    expect(matchesSavedFilter(recent, cells({ at: now + 60000 }), now)).toBe(false);
    expect(matchesSavedFilter(recent, cells({ at: null }), now)).toBe(false);
    expect(
      matchesSavedFilter(
        {
          ...recent,
          conditions: [{ id: "c", column: "at", kind: "date", op: "older", value: "10" }],
        },
        cells({ at: now - 11 * 60000 }),
        now,
      ),
    ).toBe(true);
  });
  it("explains incompatible columns, types, operators and versions without rewriting them", () => {
    expect(filterProblem(filter, fields.slice(0, 1))).toContain("no longer available");
    expect(
      filterProblem(
        filter,
        fields.map((field) => ({ ...field, kind: "date" })),
      ),
    ).toContain("changed type");
    expect(filterProblem({ ...filter, version: 9 }, fields)).toContain("version");
    expect(
      filterProblem({ ...filter, conditions: [{ ...filter.conditions[0], op: "recent" }] }, fields),
    ).toContain("Unsupported comparison");
    const raw = JSON.stringify({
      version: 1,
      active: "a",
      definitions: [{ ...filter, version: 9 }],
    });
    expect(parseFilterLibrary(raw).library.definitions).toEqual([{ ...filter, version: 9 }]);
  });
  it("keeps corrupt data out of evaluation and rejects ambiguous duplicate IDs", () => {
    expect(parseFilterLibrary("{").error).toContain("kept");
    expect(
      parseFilterLibrary(JSON.stringify({ version: 1, active: "a", definitions: [filter, filter] }))
        .error,
    ).toContain("kept");
    expect(filterProblem({ ...filter, conditions: [] }, fields)).toContain("at least one");
  });
});
