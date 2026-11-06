import { describe, expect, it } from "vitest";
import { defaultView, matchesColumn, orderedColumns, parseView, viewKey } from "./table-view.js";

const defaults = {
  lines: { horizontal: true, vertical: true, heading: false },
  density: "medium" as const,
  fit: true,
  charts: false,
};
describe("table preferences", () => {
  it("copies only preference fields from component defaults", () => {
    const supplied = {
      ...defaults,
      actions: { type: Symbol("react.element") },
      rows: ["private event"],
    };
    const view = defaultView(supplied);
    expect(Object.keys(view).sort()).toEqual([
      "charts",
      "density",
      "fit",
      "hidden",
      "lines",
      "order",
      "widths",
    ]);
    expect(() => structuredClone(view)).not.toThrow();
    expect(view.lines).not.toBe(defaults.lines);
  });
  it("uses existing preferences as defaults, with independent table keys", () => {
    expect(parseView(null, defaults)).toEqual(defaultView(defaults));
    expect(viewKey("sessions")).not.toBe(viewKey("messages"));
    expect(parseView("{", defaults)).toEqual(defaultView(defaults));
    expect(parseView("[]", defaults)).toEqual(defaultView(defaults));
  });
  it("validates stored data and ignores invalid widths", () => {
    expect(
      parseView(
        JSON.stringify({
          density: "tiny",
          fit: false,
          charts: true,
          lines: { horizontal: false },
          hidden: ["agent", 1],
          order: ["branch", "branch", null],
          widths: { agent: 140, branch: -1, status: 9000, id: "70" },
        }),
        defaults,
      ),
    ).toEqual({
      ...defaultView(defaults),
      fit: false,
      charts: true,
      lines: { ...defaults.lines, horizontal: false },
      hidden: ["agent"],
      order: ["branch"],
      widths: { agent: 140 },
    });
  });
  it("keeps column identity through visibility/order changes and restores absent columns", () => {
    const columns = [{ key: "agent" }, { key: "branch" }, { key: "chart" }];
    const view = { hidden: ["branch"], order: ["chart", "agent", "branch"] };
    expect(orderedColumns(columns, view).map((column) => column.key)).toEqual(["chart", "agent"]);
    expect(orderedColumns(columns.slice(0, 2), view)).toEqual([{ key: "agent" }]);
    expect(
      orderedColumns(columns, { ...view, hidden: columns.map((column) => column.key) }),
    ).toEqual([{ key: "agent" }]);
    expect(columns).toEqual([{ key: "agent" }, { key: "branch" }, { key: "chart" }]);
  });
});
describe("column filters", () => {
  it("matches text and categories without changing stored values", () => {
    expect(matchesColumn("a", "Alpha", "text", { op: "contains", value: "LP" })).toBe(true);
    expect(matchesColumn("running", "Working", "category", { op: "eq", value: "Working" })).toBe(
      true,
    );
    expect(matchesColumn("running", "Working", "category", { op: "ne", value: "Ready" })).toBe(
      true,
    );
  });
  it("compares numeric data rather than formatted text and supports zero", () => {
    expect(matchesColumn(2048, "2 KiB", "number", { op: "ge", value: "2000" })).toBe(true);
    expect(matchesColumn(0, "", "number", { op: "eq", value: "0" })).toBe(true);
    expect(matchesColumn(12, "12", "number", { op: "le", value: "9" })).toBe(false);
    expect(matchesColumn(12, "12", "number", { op: "eq", value: "bad" })).toBe(false);
  });
  it("compares date values and handles null cells explicitly", () => {
    expect(
      matchesColumn("2026-11-05T12:00:00Z", "Today", "date", {
        op: "ge",
        value: "2026-11-04T12:00:00Z",
      }),
    ).toBe(true);
    expect(
      matchesColumn(Date.parse("2026-11-05T12:00:00Z"), "Today", "date", {
        op: "eq",
        value: "2026-11-05T12:00:00Z",
      }),
    ).toBe(true);
    expect(matchesColumn(null, "Unknown", "date", { op: "empty", value: "" })).toBe(true);
    expect(matchesColumn(null, "", "number", { op: "eq", value: "0" })).toBe(false);
    expect(matchesColumn(null, "", "text", { op: "present", value: "" })).toBe(false);
    expect(matchesColumn("", "Never", "date", { op: "empty", value: "" })).toBe(true);
  });
});
