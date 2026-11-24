import { describe, expect, it } from "vitest";
import { MCP_TEXT_LIMITS, validateMcpConnectorText } from "./index.js";

const empty = '{"version":1,"servers":{}}';
describe("strict MCP text validation", () => {
  it("shares very long unknown prefixes rather than copying them for every child location", () => {
    const source = `{"version":1,"servers":{},"${"a".repeat(200_000)}":[${Array(4000).fill("0").join(",")}]}`;
    const result = validateMcpConnectorText(source);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("schema");
    expect(JSON.stringify(result).length).toBeLessThan(500);
  });
  it("shares document validation/defaults and accepts formatted Unicode text without rewriting it", () => {
    const text =
      '\r\n{ "version":1, "servers": {"docs":{"type":"stdio","enabled":false,"label":"文😀","command":"node"}}}\n';
    const result = validateMcpConnectorText(text);
    expect(result.valid).toBe(true);
    if (result.valid)
      expect(result.document.servers.docs).toMatchObject({ label: "文😀", args: [], env: {} });
    expect(validateMcpConnectorText(empty)).toEqual({
      valid: true,
      document: { version: 1, servers: {} },
      issues: [],
    });
  });
  it.each([
    "",
    "// comment\n" + empty,
    '{"version":1,"servers":{},}',
    '{"version":01,"servers":{}}',
    '{"version":1.0.1,"servers":{}}',
    '{"version":NaN,"servers":{}}',
    "{'version':1}",
    empty + "false",
    "[1,]",
    '{"x" 1}',
    '{"x":"bad\\q"}',
    '{"x":"bad\\u000z"}',
    '{"x":"unterminated}',
    '{"x":"line\nbreak"}',
    "\ufeff" + empty,
  ])("rejects non-JSON grammar %#", (text) => {
    const result = validateMcpConnectorText(text);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe("syntax");
  });
  it("detects duplicates after decoding escapes at every object depth", () => {
    for (const text of [
      '{"version":1,"\\u0076ersion":1,"servers":{}}',
      '{"version":1,"servers":{"docs":{},"d\\u006fcs":{}}}',
      '{"version":1,"servers":{"docs":{"env":{"TOKEN":1,"TOKEN":2}}}}',
    ]) {
      expect(
        validateMcpConnectorText(text).issues.some((issue) => issue.code === "duplicate-key"),
      ).toBe(true);
    }
  });
  it("reports UTF-16 columns and CRLF/CR line positions with sanitized paths", () => {
    const text =
      '{\r\n"version":1,\r\n"servers":{"docs":{"label":"😀", "enabled":"wrong","type":"stdio","command":"node"}}}';
    const result = validateMcpConnectorText(text);
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toMatchObject({
      code: "schema",
      path: ["servers", "*", "enabled"],
      line: 3,
      column: (text.split("\r\n")[2]?.indexOf('"wrong"') as number) + 1,
    });
    expect(validateMcpConnectorText('{\r"version":2, "servers":{}}').issues[0]?.line).toBe(2);
  });
  it("never echoes unknown keys, values or parser error excerpts", () => {
    const secret = "synthetic-private-credential";
    for (const text of [
      `{"version":1,"servers":{},"${secret}":"${secret}"}`,
      `{"version":1,"servers":{"docs":{"env":{"${secret}":"${secret}"}}}}`,
      `{"${secret}":1,"${secret}":2}`,
    ]) {
      const result = validateMcpConnectorText(text);
      expect(result.valid).toBe(false);
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });
  it("enforces byte, depth, node and issue caps", () => {
    expect(validateMcpConnectorText('"\ud800"').issues[0]?.code).toBe("encoding");
    expect(validateMcpConnectorText(empty.padEnd(MCP_TEXT_LIMITS.bytes)).valid).toBe(true);
    expect(validateMcpConnectorText(empty.padEnd(MCP_TEXT_LIMITS.bytes + 1)).issues[0]?.code).toBe(
      "too-large",
    );
    expect(validateMcpConnectorText('"' + "😀".repeat(300_000) + '"').issues[0]?.code).toBe(
      "too-large",
    );
    expect(validateMcpConnectorText("[".repeat(33) + "0" + "]".repeat(33)).issues[0]?.code).toBe(
      "too-deep",
    );
    expect(
      validateMcpConnectorText("[" + Array(32_768).fill("0").join(",") + "]").issues[0]?.code,
    ).toBe("too-complex");
    const source = '{"version":1,"servers":{},' + Array(100).fill('"duplicate":0').join(",") + "}";
    expect(validateMcpConnectorText(source).issues).toHaveLength(32);
  });
});
