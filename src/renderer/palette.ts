/** Command palette ranking: every query word must match; label matches outrank context ones. */
export interface Rankable {
  label: string;
  hint?: string | undefined;
  group: string;
}
export interface Ranked<T> {
  command: T;
  /** Matched [start, end) ranges in the label, for highlighting. */
  marks: [number, number][];
}

export function rankCommands<T extends Rankable>(
  commands: readonly T[],
  query: string,
): Ranked<T>[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return commands.map((command) => ({ command, marks: [] }));
  const ranked: (Ranked<T> & { score: number; index: number })[] = [];
  commands.forEach((command, index) => {
    const label = command.label.toLocaleLowerCase();
    const context = `${command.hint ?? ""} ${command.group}`.toLocaleLowerCase();
    let score = 0;
    const marks: [number, number][] = [];
    for (const word of words) {
      const at = label.indexOf(word);
      const wordStart = label.search(new RegExp(`(^|[^a-z0-9])${escapeRegExp(word)}`));
      if (at === 0) score += 0;
      else if (wordStart >= 0) score += 1;
      else if (at > 0) score += 2;
      else if (context.includes(word)) {
        score += 4;
        continue;
      } else return;
      const start = at === 0 || wordStart < 0 ? at : label.indexOf(word, wordStart);
      marks.push([start, start + word.length]);
    }
    ranked.push({ command, marks: merge(marks), score, index });
  });
  return ranked
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ command, marks }) => ({ command, marks }));
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function merge(marks: [number, number][]): [number, number][] {
  const sorted = [...marks].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const mark of sorted) {
    const last = merged.at(-1);
    if (last && mark[0] <= last[1]) last[1] = Math.max(last[1], mark[1]);
    else merged.push([...mark]);
  }
  return merged;
}

/** Splits a label into plain and marked parts. */
export function markParts(label: string, marks: readonly [number, number][]) {
  const parts: { text: string; marked: boolean; start: number }[] = [];
  let at = 0;
  for (const [start, end] of marks) {
    if (start > at) parts.push({ text: label.slice(at, start), marked: false, start: at });
    parts.push({ text: label.slice(start, end), marked: true, start });
    at = end;
  }
  if (at < label.length) parts.push({ text: label.slice(at), marked: false, start: at });
  return parts;
}
