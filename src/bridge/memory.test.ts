import { describe, expect, it } from "vitest";
import { DEFAULT_MEMORY_SETTINGS } from "../contracts/index.js";
import { parseMemoryAction, parseMemoryBrowse, parseMemoryDetail } from "./memory.js";

describe("narrow application memory bridge", () => {
  it("accepts only opaque identities, strict settings and bounded edits", () => {
    const id = crypto.randomUUID();
    expect(parseMemoryDetail({ id })).toEqual({ id });
    expect(parseMemoryBrowse({ projectId: id, type: "lesson", state: "disputed" })).toMatchObject({
      type: "lesson",
    });
    expect(parseMemoryAction({ type: "configure", settings: DEFAULT_MEMORY_SETTINGS }).type).toBe(
      "configure",
    );
    expect(
      parseMemoryAction({ type: "edit", id, revision: 1, text: "Correction", pinned: true }).type,
    ).toBe("edit");
    for (const value of [
      { type: "promote", id, revision: 1, path: "/private" },
      { type: "edit", id, revision: 0, text: "text", pinned: true },
      { type: "edit", id, revision: 1, text: "x".repeat(2001), pinned: true },
      { type: "generate", conversationId: "/path" },
      { type: "configure", settings: { ...DEFAULT_MEMORY_SETTINGS, capacity: "32000" } },
      { type: "configure", settings: { ...DEFAULT_MEMORY_SETTINGS, rolloverPercent: 99 } },
      { type: "execute", command: "rm" },
    ])
      expect(() => parseMemoryAction(value)).toThrow();
    expect(() => parseMemoryBrowse({ path: "/private" })).toThrow();
    expect(() => parseMemoryDetail({ id, offset: 0 })).toThrow();
  });
});
