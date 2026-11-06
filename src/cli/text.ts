// biome-ignore lint/suspicious/noControlCharactersInRegex: matching escape sequences is the point.
const ANSI_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point.
const CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

/** Removes escape sequences and control characters from untrusted text, keeping newlines. */
export function clean(text: string): string {
  return text.replace(ANSI_RE, "").replaceAll("\t", "  ").replace(CONTROL_RE, "");
}

/** Like `clean`, but also folds newlines so the text fits on one line. */
export function oneLine(text: string, max = Number.POSITIVE_INFINITY): string {
  const flat = clean(text)
    .replace(/\s*\n\s*/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, Math.max(0, max - 1))}…` : flat;
}

/** Wraps text to `width` columns, splitting long words. */
export function wrap(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    const chars = [...paragraph];
    if (chars.length === 0) {
      out.push("");
      continue;
    }
    for (let i = 0; i < chars.length; i += w) out.push(chars.slice(i, i + w).join(""));
  }
  return out;
}

/** Wraps at spaces where possible; words longer than `width` are split. */
export function wrapWords(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if ([...candidate].length <= w) {
      line = candidate;
      continue;
    }
    if (line !== "") out.push(line.trimEnd());
    const pieces = wrap(word, w);
    line = pieces.pop() ?? "";
    out.push(...pieces);
  }
  if (line !== "") out.push(line.trimEnd());
  return out;
}
/** Formats rows as left-aligned columns separated by two spaces. */
export function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: readonly string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i] ?? 0)))
      .join("  ")
      .trimEnd();
  return `${[line(header), ...rows.map(line)].join("\n")}\n`;
}
