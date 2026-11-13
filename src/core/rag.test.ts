import { describe, expect, it } from "vitest";
import {
  checkedVector,
  chunkText,
  conversationMessages,
  embedMessages,
  topMatches,
} from "./rag.js";
import type { RunEvent } from "./types.js";

describe("conversation retrieval", () => {
  it("merges streamed replies and omits automatic prompts and internal events", () => {
    const at = "2026-01-01T00:00:00Z";
    const events = [
      { type: "prompt", turn: 1, text: "hello" },
      { type: "message", text: "one " },
      { type: "sessionState", state: {} },
      { type: "message", text: "two" },
      { type: "thought", text: "private" },
      { type: "message", text: "three" },
      { type: "prompt", turn: 2, text: "internal", origin: "automatic" },
      { type: "note", text: "note" },
    ].map((event) => ({ ...event, runId: "run", at })) as RunEvent[];
    expect(conversationMessages(events)).toEqual([
      { role: "user", at, text: "hello" },
      { role: "assistant", at, text: "one two" },
      { role: "assistant", at, text: "three" },
    ]);
  });

  it("covers exact source spans, special tokens and overlapping words", () => {
    const text = `${"alpha beta gamma delta ".repeat(200)}  `;
    const count = (s: string) => s.trim().split(/\s+/).filter(Boolean).length + 2;
    const spans = chunkText(text, count, 32, 4);
    const covered = new Set<number>();
    for (const span of spans) {
      expect(count(text.slice(span.start, span.end))).toBeLessThanOrEqual(32);
      for (let n = span.start; n < span.end; n++) covered.add(n);
    }
    expect(covered.size).toBe(text.length);
    expect(spans[1]?.start).toBeLessThan(spans[0]?.end ?? 0);
    expect(chunkText(" \n ", count)).toEqual([]);
    expect(chunkText("hi", count)).toEqual([{ start: 0, end: 2 }]);
  });

  it("splits long Unicode runs without truncation or broken surrogate pairs", () => {
    const text = "😀".repeat(2000);
    const count = (s: string) => [...s].length + 2;
    const spans = chunkText(text, count, 32, 4);
    expect(spans[0]?.start).toBe(0);
    expect(spans.at(-1)?.end).toBe(text.length);
    expect(spans[1]?.start).toBeLessThan(spans[0]?.end ?? 0);
    for (let i = 1; i < spans.length; i++)
      expect(spans[i]?.start).toBeLessThanOrEqual(spans[i - 1]?.end ?? 0);
    for (const span of spans)
      expect(count(text.slice(span.start, span.end))).toBeLessThanOrEqual(32);
    expect(() => chunkText("long", count, 2)).toThrow();
    expect(() => chunkText("😀😀", count, 2.5)).toThrow();
  });

  it("embeds documents separately from queries and restores batch order", async () => {
    const embedded: string[] = [];
    const result = await embedMessages(
      {
        countTokens: (s) => s.length + 2,
        embedDocuments: async (texts) => {
          embedded.push(...texts);
          return texts.map(() => new Float32Array([1, 0]));
        },
        embedQuery: async () => {
          throw new Error("not a document operation");
        },
      },
      [{ text: "longer" }, { text: "a" }],
      2,
      1,
    );
    expect(embedded).toEqual(["a", "longer"]);
    expect(result.chunks.map((c) => c.text)).toEqual(["longer", "a"]);
    expect([...result.vectors]).toEqual([1, 0, 1, 0]);
  });

  it("ranks cosine similarities with stable ties and rejects invalid vectors", () => {
    expect(
      topMatches(new Float32Array([1, 0]), new Float32Array([1, 0, 0, 1, 1, 0]), 2, 2),
    ).toEqual([
      { index: 0, score: 1 },
      { index: 2, score: 1 },
    ]);
    for (const vector of [
      undefined,
      new Float32Array([NaN, 0]),
      new Float32Array([0, 0]),
      new Float32Array([1]),
    ])
      expect(() => checkedVector(vector, 2)).toThrow();
    expect(() => topMatches(new Float32Array([1]), new Float32Array(), 2, 1)).toThrow();
  });
  it("bounds chunk creation before embedding and reports completed batches", async () => {
    let calls = 0;
    const progress: number[] = [];
    const embedder = {
      countTokens: (s: string) => s.length + 2,
      embedDocuments: async (texts: readonly string[]) => {
        calls++;
        return texts.map(() => new Float32Array([1, 0]));
      },
      embedQuery: async () => new Float32Array([1, 0]),
    };
    const messages = [{ text: "a" }, { text: "b" }, { text: "c" }];
    await expect(embedMessages(embedder, messages, 2, 8, { maxChunks: 2 })).rejects.toThrow(
      "10,000",
    );
    expect(calls).toBe(0);
    await embedMessages(embedder, messages, 2, 2, {
      progress: (done) => {
        progress.push(done);
      },
    });
    expect(progress).toEqual([2, 3]);
    await expect(embedMessages(embedder, messages, 2, 0)).rejects.toThrow("batch");
    await expect(embedMessages(embedder, [{ text: "a".repeat(1_048_577) }], 2)).rejects.toThrow(
      "1 MiB",
    );
    await expect(embedMessages(embedder, [{ text: "😀".repeat(262_145) }], 2)).rejects.toThrow(
      "1 MiB",
    );
  });
});
