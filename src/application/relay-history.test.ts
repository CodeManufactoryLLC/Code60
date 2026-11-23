import { describe, expect, it } from "vitest";
import { type RelayMessage, relayHistoryWindow } from "./relay-history.js";

const message = (text: string): RelayMessage => ({
  id: "one",
  role: "human",
  at: "2026-11-12T00:00:00.000Z",
  text,
});
describe("Relay's shared history window", () => {
  it("counts the actual historical serialization, including labels and warnings", () => {
    const window = relayHistoryWindow([message("a".repeat(64_000))]);
    expect(window.characters).toBe(64_000);
    expect([...window.serialized]).toHaveLength(64_000);
    expect(window.messages[0]?.partial).toBe(true);
    expect(window.serialized).toContain("partial excerpt");
    expect(window.older).toBe(true);
  });
  it("does not split Unicode and retains the most recent complete messages", () => {
    const window = relayHistoryWindow([message("old".repeat(30_000)), message("😀🐕é文")]);
    expect(window.messages).toHaveLength(1);
    expect(window.messages[0]?.text).toBe("😀🐕é文");
    const oversized = relayHistoryWindow([message("😀".repeat(80_000))]);
    expect(oversized.characters).toBe(64_000);
    expect(oversized.serialized).not.toMatch(/[\ud800-\udfff]/u);
    expect(oversized.messages[0]?.text).toMatch(/^😀+$/u);
  });
  it("handles empty, exact-fit, one-over and too-small windows", () => {
    expect(relayHistoryWindow([]).serialized).toBe("");
    const full = relayHistoryWindow([message("abc")]);
    expect(relayHistoryWindow([message("abc")], false, false, full.characters).serialized).toBe(
      full.serialized,
    );
    expect(
      relayHistoryWindow([message("abc")], false, false, full.characters - 1).characters,
    ).toBeLessThan(full.characters);
    expect(relayHistoryWindow([message("abc")], false, true, 0)).toMatchObject({
      messages: [],
      characters: 0,
      incomplete: true,
      older: true,
    });
    expect(() => relayHistoryWindow([], false, false, 64_001)).toThrow("budget");
  });
});
