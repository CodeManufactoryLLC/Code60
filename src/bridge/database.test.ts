import { expect, it } from "vitest";
import { parseDatabaseWrite } from "./database.js";

it("validates the database epoch envelope without changing its separately validated request", () => {
  const request = { id: crypto.randomUUID(), prompt: "Unchanged" };
  for (const databaseEpoch of [0, 1, Number.MAX_SAFE_INTEGER]) {
    const value = { request, databaseEpoch };
    expect(parseDatabaseWrite(value)).toEqual(value);
  }
  expect(parseDatabaseWrite({ request })).toEqual({ request });
  for (const databaseEpoch of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, "1", null])
    expect(() => parseDatabaseWrite({ request, databaseEpoch })).toThrow();
  expect(() => parseDatabaseWrite({ request, databaseEpoch: 1, path: "/outside" })).toThrow();
  expect(() => parseDatabaseWrite(request)).toThrow();
});
