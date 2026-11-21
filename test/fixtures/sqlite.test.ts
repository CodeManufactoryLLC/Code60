import { expect, it, vi } from "vitest";
import { sqliteFtsAvailable } from "./sqlite.js";

it("keeps ordinary SQLite availability separate from full-text search support", () => {
  const close = vi.fn();
  const exec = vi.fn(() => {
    throw new Error("no such module: fts5");
  });
  expect(sqliteFtsAvailable(() => ({ exec, close }))).toBe(false);
  expect(close).toHaveBeenCalledOnce();
});

it("closes the private in-memory probe after detecting FTS5", () => {
  const close = vi.fn();
  expect(sqliteFtsAvailable(() => ({ exec: vi.fn(), close }))).toBe(true);
  expect(close).toHaveBeenCalledOnce();
});

it("treats a missing SQLite module or failed probe open as unavailable", () => {
  expect(sqliteFtsAvailable(() => undefined)).toBe(false);
  expect(
    sqliteFtsAvailable(() => {
      throw new Error("SQLite unavailable");
    }),
  ).toBe(false);
});
