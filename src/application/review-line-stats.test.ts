import { describe, expect, it } from "vitest";
import { reviewLineStats } from "./review-line-stats.js";

describe("review line counts", () => {
  it("matches an independent LCS reference across short repeated-line inputs", async () => {
    const sequences: string[][] = [[]];
    for (let size = 1; size <= 4; size++) {
      for (let mask = 0; mask < 2 ** size; mask++)
        sequences.push(
          Array.from({ length: size }, (_, index) => ((mask >> index) & 1 ? "b" : "a")),
        );
    }
    for (const before of sequences) {
      for (const after of sequences) {
        const lcs = Array.from({ length: before.length + 1 }, () =>
          new Array<number>(after.length + 1).fill(0),
        );
        for (let i = 1; i <= before.length; i++)
          for (let j = 1; j <= after.length; j++) {
            const row = lcs[i];
            const above = lcs[i - 1];
            if (!row || !above) throw new Error("Missing LCS row");
            row[j] =
              before[i - 1] === after[j - 1]
                ? (above[j - 1] ?? 0) + 1
                : Math.max(above[j] ?? 0, row[j - 1] ?? 0);
          }
        const common = lcs[before.length]?.[after.length] ?? 0;
        expect(
          await reviewLineStats(
            before.map((line) => `${line}\n`).join(""),
            after.map((line) => `${line}\n`).join(""),
            { remaining: 10_000 },
          ),
        ).toEqual({
          additions: after.length - common,
          deletions: before.length - common,
        });
      }
    }
  });

  it("counts additions, deletions, and replacements while preserving matching lines", async () => {
    expect(await reviewLineStats("a\nb\nc\n", "a\nnew\nc\nd\n", { remaining: 10_000 })).toEqual({
      additions: 2,
      deletions: 1,
    });
    expect(await reviewLineStats("old\n", "new\n", { remaining: 10_000 })).toEqual({
      additions: 1,
      deletions: 1,
    });
  });

  it("handles empty files, final newlines, and identical snapshots", async () => {
    expect(await reviewLineStats("", "a\nb\n", { remaining: 10_000 })).toEqual({
      additions: 2,
      deletions: 0,
    });
    expect(await reviewLineStats("a\nb\n", "", { remaining: 10_000 })).toEqual({
      additions: 0,
      deletions: 2,
    });
    expect(await reviewLineStats("same\n", "same\n", { remaining: 0 })).toEqual({
      additions: 0,
      deletions: 0,
    });
    expect(await reviewLineStats("line", "line\n", { remaining: 10_000 })).toEqual({
      additions: 1,
      deletions: 1,
    });
  });

  it("returns unavailable when a dissimilar snapshot exhausts its shared work budget", async () => {
    expect(await reviewLineStats("a\nb\nc\n", "x\ny\nz\n", { remaining: 1 })).toBeUndefined();
  });
});
