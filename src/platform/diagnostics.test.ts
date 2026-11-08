import { describe, expect, it } from "vitest";
import { DiagnosticTail, diagnosticMessage, diagnosticText } from "./diagnostics.js";

// Assemble PEM markers at runtime so repository secret scanning does not flag synthetic fixtures.
const pem = (edge: "BEGIN" | "END", kind = "") => `-----${edge} ${kind}PRIVATE KEY-----`;

describe("diagnostic redaction", () => {
  const secret = ["synthetic", "credential", "value"].join("-");
  it.each([
    (s: string) => `Authorization: Bearer ${s}`,
    (s: string) => `proxy-authorization=Basic ${s}`,
    (s: string) => `{"api_key":"${s}","password":"${s}"}`,
    (s: string) => `ACCESS_TOKEN=${s}&refresh_token=${s}`,
    (s: string) => `https://user:${s}@example.invalid/path`,
    (s: string) => `launch --api-key "${s}" --password=${s}`,
    (s: string) => `${pem("BEGIN")}\n${s}\n${pem("END")}`,
    (s: string) => `${pem("BEGIN", "OPENSSH ")}\n${s}`,
  ])("redacts recognized credentials before clipping", (format) => {
    const input = format(secret);
    expect(diagnosticText(input)).not.toContain(secret);
    expect(diagnosticMessage(new Error(input))).toBe(diagnosticText(input));
    expect(diagnosticText(input, 30)).not.toContain(secret.slice(0, 8));
    expect(diagnosticText(diagnosticText(input))).toBe(diagnosticText(input));
  });

  it("redacts provider token formats without assignment labels", () => {
    for (const prefix of ["ghp_", "github_pat_", "sk-proj-", "xoxb-"]) {
      const token = prefix + "Ab9x".repeat(10);
      expect(diagnosticText(`failed with ${token}`)).toBe("failed with [REDACTED]");
    }
  });

  it("retains useful non-sensitive context", () => {
    expect(diagnosticText("agent exited with code 1")).toBe("agent exited with code 1");
    expect(diagnosticText("log in through claude's own CLI")).toBe(
      "log in through claude's own CLI",
    );
  });
});

describe("bounded diagnostic stderr", () => {
  const secret = ["not", "for", "diagnostics"].join("-");
  it("handles every byte boundary and reads between chunks without losing the prefix", () => {
    const bytes = Buffer.from(`界 api_key="${secret}"\nfinished\n`);
    for (let split = 1; split < bytes.length; split++) {
      const tail = new DiagnosticTail(1024);
      tail.push(bytes.subarray(0, split));
      tail.toString();
      tail.push(bytes.subarray(split));
      expect(tail.toString()).not.toContain(secret);
      expect(tail.toString()).toContain("界");
      expect(tail.toString()).not.toContain("\uFFFD");
      expect(tail.toString()).toContain("finished");
    }
  });

  it("keeps multiline key state across chunks and subsequent diagnostics", () => {
    const tail = new DiagnosticTail(128);
    const input = `before\n${pem("BEGIN", "RSA ")}\n${secret}\n${pem("END", "RSA ")}\nafter\n`;
    for (const byte of Buffer.from(input)) tail.push(Buffer.from([byte]));
    expect(tail.toString()).not.toContain(secret);
    expect(tail.toString()).toContain("before");
    expect(tail.toString()).toContain("after");
  });

  it("drops oversized lines instead of retaining a secret after its label was clipped", () => {
    const tail = new DiagnosticTail(128);
    tail.push(Buffer.from(`api_key=${"x".repeat(512)}${secret}`));
    expect(tail.toString()).not.toContain(secret);
    tail.push(Buffer.from("\nnext\n"));
    expect(tail.toString()).toContain("omitted");
    expect(tail.toString()).toContain("next");
    expect(Buffer.byteLength(tail.toString())).toBeLessThanOrEqual(128);
  });

  it("matches a continuous byte tail and stays linear for many short lines", () => {
    const tail = new DiagnosticTail(64);
    let all = "";
    for (let i = 0; i < 500; i++) {
      const line = `${i % 7 ? "界" : "x"}${i}`;
      tail.push(Buffer.from(`${line}\n`));
      all += `${line}\n`;
      let start = Math.max(0, Buffer.byteLength(all) - 64);
      const bytes = Buffer.from(all);
      while (((bytes[start] ?? 0) & 0xc0) === 0x80) start++;
      expect(tail.toString()).toBe(bytes.subarray(start).toString("utf8"));
    }
    const large = new DiagnosticTail(64 * 1024);
    const chunk = Buffer.from("x\n".repeat(1000));
    const started = performance.now();
    for (let i = 0; i < 200; i++) large.push(chunk);
    expect(Buffer.byteLength(large.toString())).toBe(64 * 1024);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("bounds multibyte output without corrupting code points", () => {
    const tail = new DiagnosticTail(128);
    for (let i = 0; i < 50; i++) tail.push(Buffer.from("😀界\n"));
    expect(Buffer.byteLength(tail.toString())).toBeLessThanOrEqual(128);
    expect(tail.toString()).not.toContain("\uFFFD");
  });
});
