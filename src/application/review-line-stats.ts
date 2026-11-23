import { setImmediate } from "node:timers/promises";

export interface ReviewLineStats {
  additions: number;
  deletions: number;
}

export interface ReviewLineStatsBudget {
  remaining: number;
}

const YIELD_EVERY = 50_000;

function splitLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) {
      lines.push(text.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

/**
 * Counts the additions and deletions in a shortest line-level edit script.
 * The shared budget keeps an unusually large or dissimilar revision from
 * monopolizing Electron's main process.
 */
export async function reviewLineStats(
  original: string,
  modified: string,
  budget: ReviewLineStatsBudget,
): Promise<ReviewLineStats | undefined> {
  if (original === modified) return { additions: 0, deletions: 0 };

  const before = splitLines(original);
  const after = splitLines(modified);
  let operations = 0;
  const spend = () => --budget.remaining >= 0;
  const checkpoint = () => (++operations % YIELD_EVERY === 0 ? setImmediate() : undefined);

  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    if (!spend()) return undefined;
    prefix++;
    const pause = checkpoint();
    if (pause) await pause;
  }
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > prefix && afterEnd > prefix && before[beforeEnd - 1] === after[afterEnd - 1]) {
    if (!spend()) return undefined;
    beforeEnd--;
    afterEnd--;
    const pause = checkpoint();
    if (pause) await pause;
  }

  const beforeLength = beforeEnd - prefix;
  const afterLength = afterEnd - prefix;
  if (beforeLength === 0) return { additions: afterLength, deletions: 0 };
  if (afterLength === 0) return { additions: 0, deletions: beforeLength };

  const max = beforeLength + afterLength;
  const offset = max + 1;
  const frontier = new Int32Array(2 * max + 3);
  frontier[offset + 1] = 0;

  for (let depth = 0; depth <= max; depth++) {
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      if (!spend()) return undefined;
      const down =
        diagonal === -depth ||
        (diagonal !== depth &&
          (frontier[offset + diagonal - 1] ?? 0) < (frontier[offset + diagonal + 1] ?? 0));
      let x = down
        ? (frontier[offset + diagonal + 1] ?? 0)
        : (frontier[offset + diagonal - 1] ?? 0) + 1;
      let y = x - diagonal;
      while (x < beforeLength && y < afterLength && before[prefix + x] === after[prefix + y]) {
        if (!spend()) return undefined;
        x++;
        y++;
        const pause = checkpoint();
        if (pause) await pause;
      }
      frontier[offset + diagonal] = x;
      if (x >= beforeLength && y >= afterLength) {
        return {
          additions: (depth + afterLength - beforeLength) / 2,
          deletions: (depth + beforeLength - afterLength) / 2,
        };
      }
      const pause = checkpoint();
      if (pause) await pause;
    }
  }
  return undefined;
}
