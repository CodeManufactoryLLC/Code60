import { describe, expect, it } from "vitest";
import {
  type SearchResult,
  searchContext,
  sourceResult,
  summaryParts,
  summarySources,
} from "./search.js";

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
  it("retrieves saved context for natural-language questions without literal all-word matches", () => {
    expect(
      searchContext(
        [row(0, "An accessible palette editor.")],
        "What is this project about?",
        "all",
      ),
    ).toHaveLength(1);
    expect(searchContext([row(0)], "What is this project about?", "thought")).toEqual([]);
    const file = {
      id: "file:README.md",
      kind: "file" as const,
      path: "README.md",
      title: "README.md",
      text: "Project description",
    };
    expect(sourceResult(file)).toMatchObject({ kind: "file", path: "README.md", at: "" });
    expect(summarySources([sourceResult(file)], "project")).toEqual([]);
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
