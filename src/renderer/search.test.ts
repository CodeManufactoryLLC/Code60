import { describe, expect, it } from "vitest";
import { type SearchResult, summaryParts, summarySources } from "./search.js";

const row = (id: number, text = "The parser is fixed."): SearchResult => ({
  id: `run:${id}`,
  kind: "message",
  title: "Parser",
  text,
  at: "",
  runId: "run",
  eventIndex: id,
});
describe("overview evidence and references", () => {
  it("retains submitted order, source addresses and at most twenty excerpts", () => {
    const sources = summarySources(
      Array.from({ length: 25 }, (_, i) => row(i)),
      "parser",
    );
    expect(sources).toHaveLength(20);
    expect(sources[19]).toMatchObject({ id: "run:19", runId: "run", eventIndex: 19 });
  });
  it("bounds multiline excerpts around a match far into a large transcript", () => {
    const text = `${"before\n".repeat(3000)}MATCH\nEvidence after the match.\n${"after\n".repeat(3000)}`;
    const source = summarySources([row(0, text)], "match")[0];
    expect(source?.text.length).toBeLessThanOrEqual(4000);
    expect(source?.text).toContain("MATCH\nEvidence after the match.");
    expect(summarySources([row(1, "short")], "short")[0]?.text).toBe("short");
  });
  it("creates only local in-range references and leaves HTML, URLs and malformed references literal", () => {
    expect(summaryParts("A [1] and [2]. [0] [03] [21] <script> https://example.com", 2)).toEqual([
      { text: "A " },
      { text: "[1]", source: 0, start: 2 },
      { text: " and " },
      { text: "[2]", source: 1, start: 10 },
      { text: ". [0] [03] [21] <script> https://example.com" },
    ]);
    expect(summaryParts("[999999999999999999999]", 20)).toEqual([
      { text: "[999999999999999999999]" },
    ]);
  });
});
