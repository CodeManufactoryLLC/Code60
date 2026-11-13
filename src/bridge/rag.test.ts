import { describe, expect, it } from "vitest";
import { parseRagCancel, parseRagIdentity, parseRagQuery, RAG_QUERY_LIMIT } from "./index.js";

describe("RAG bridge", () => {
  const identity = { databaseKey: "a".repeat(64), requestId: crypto.randomUUID() };
  it("accepts only database and operation identities plus bounded query text", () => {
    expect(parseRagIdentity(identity)).toEqual(identity);
    expect(parseRagCancel(identity.requestId)).toBe(identity.requestId);
    expect(parseRagQuery({ ...identity, text: "message" }).text).toBe("message");
    for (const value of [
      { ...identity, path: "/private" },
      { ...identity, databaseKey: "../x" },
      { ...identity, requestId: "x" },
      { ...identity, databaseEpoch: -1 },
    ])
      expect(() => parseRagIdentity(value)).toThrow();
    expect(parseRagIdentity({ ...identity, databaseEpoch: 2 }).databaseEpoch).toBe(2);
    for (const text of ["", " \n ", "x".repeat(RAG_QUERY_LIMIT + 1)])
      expect(() => parseRagQuery({ ...identity, text })).toThrow();
    expect(() => parseRagQuery({ ...identity, text: "ok", model: "remote" })).toThrow();
  });
});
