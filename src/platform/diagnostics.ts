import { StringDecoder } from "node:string_decoder";

const REDACTED = "[REDACTED]";
const KEY_START = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const KEY_END = /-----END [A-Z0-9 ]*PRIVATE KEY-----/;

function byteTail(text: string, limit: number): string {
  const bytes = Buffer.from(text);
  if (bytes.length <= limit) return text;
  let start = bytes.length - limit;
  while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString("utf8");
}

/** Best-effort credential protection for diagnostics, never a transcript anonymizer. */
export function diagnosticText(text: string, limit = 4096): string {
  const redacted = text
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
      REDACTED,
    )
    .replace(/(\b[a-z][a-z\d+.-]{0,30}:\/\/)[^\s/@]+@/gi, `$1${REDACTED}@`)
    .replace(/(\b(?:proxy-)?authorization["']?\s*[:=]\s*)[^\r\n]+/gi, `$1${REDACTED}`)
    .replace(
      /(\b[\w.-]{0,80}(?:password|passwd|secret|token|api[_-]?key|credential)[\w.-]{0,80}["']?\s*[:=]\s*)(?:\[REDACTED\]|"[^"]*"|'[^']*'|[^\s"'&,;}\]]+)/gi,
      `$1${REDACTED}`,
    )
    .replace(
      /(--[\w-]{0,80}(?:password|passwd|secret|token|api-key|credential)[\w-]{0,80}\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
      `$1${REDACTED}`,
    )
    .replace(/\b(?:Bearer|Basic)\s+[a-z\d+/_=.-]+/gi, REDACTED)
    .replace(
      /\b(?:gh[pousr]_[a-z\d]{20,}|github_pat_[a-z\d_]{20,}|sk-(?:proj-)?[a-z\d_-]{20,}|xox[baprs]-[a-z\d-]{10,}|AKIA[A-Z\d]{16})\b/gi,
      REDACTED,
    );
  return redacted.length <= limit ? redacted : `${redacted.slice(0, Math.max(0, limit - 1))}…`;
}

export function diagnosticMessage(error: unknown, limit = 4096): string {
  return diagnosticText(error instanceof Error ? error.message : String(error), limit);
}

/** Retains bounded stderr without clipping away a credential's identifying prefix. */
export class DiagnosticTail {
  private readonly decoder = new StringDecoder("utf8");
  private pending = "";
  // Scrubbed lines with their byte sizes; re-encoding one joined tail per line would be quadratic.
  private lines: { text: string; bytes: number }[] = [];
  private head = 0;
  private bytes = 0;
  private dropping = false;
  private inKey = false;

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    const lines = this.decoder.write(chunk).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const ended = i < lines.length - 1;
      if (!this.dropping) {
        this.pending += line;
        if (Buffer.byteLength(this.pending) > this.limit) {
          this.inKey ||= KEY_START.test(this.pending) && !KEY_END.test(this.pending);
          this.pending = "";
          this.dropping = true;
        }
      }
      if (this.dropping && KEY_END.test(line)) this.inKey = false;
      if (!ended) continue;
      this.append(this.dropping ? "[oversized stderr line omitted]" : this.scrub(this.pending));
      this.pending = "";
      this.dropping = false;
    }
  }

  private scrub(text: string): string {
    if (this.inKey) {
      const end = KEY_END.exec(text);
      if (!end) return REDACTED;
      text = `${REDACTED}${text.slice(end.index + end[0].length)}`;
      this.inKey = false;
    }
    if (KEY_START.test(text) && !KEY_END.test(text)) this.inKey = true;
    return diagnosticText(text, this.limit);
  }

  private append(text: string): void {
    const line = { text: `${text}\n`, bytes: Buffer.byteLength(text) + 1 };
    this.lines.push(line);
    this.bytes += line.bytes;
    // Keep at least `limit` bytes so toString clips exactly like a continuous byte tail.
    for (let first = this.lines[this.head]; first && this.bytes - first.bytes >= this.limit; ) {
      this.bytes -= first.bytes;
      first = this.lines[++this.head];
    }
    if (this.head > 1024 && this.head * 2 > this.lines.length) {
      this.lines = this.lines.slice(this.head);
      this.head = 0;
    }
  }

  toString(): string {
    const pending = this.dropping
      ? "[oversized stderr line omitted]"
      : this.inKey
        ? REDACTED
        : diagnosticText(this.pending, this.limit);
    let tail = "";
    for (let i = this.head; i < this.lines.length; i++) tail += this.lines[i]?.text ?? "";
    return byteTail(tail + pending, this.limit);
  }
}
