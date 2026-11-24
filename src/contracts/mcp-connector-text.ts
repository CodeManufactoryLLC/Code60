import { type McpConnectorDocument, mcpConnectorDocumentSchema } from "./mcp-connectors.js";

export const MCP_TEXT_LIMITS = { bytes: 1_048_576, depth: 32, nodes: 32_768, issues: 32 } as const;
type IssueCode =
  | "syntax"
  | "duplicate-key"
  | "too-large"
  | "too-deep"
  | "too-complex"
  | "schema"
  | "encoding";
export interface McpTextIssue {
  code: IssueCode;
  message: string;
  path: readonly (string | number)[];
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}
export type McpTextValidation =
  | { valid: true; document: McpConnectorDocument; issues: [] }
  | { valid: false; issues: McpTextIssue[] };

const messages: Record<IssueCode, string> = {
  syntax: "Use strict JSON syntax.",
  "duplicate-key": "JSON object keys must be unique.",
  "too-large": "Configuration exceeds the 1 MiB limit.",
  "too-deep": "JSON exceeds the nesting limit.",
  "too-complex": "JSON exceeds the node limit.",
  schema: "Value does not match the MCP configuration format.",
  encoding: "Configuration must use valid UTF-8.",
};
const fields = new Set([
  "version",
  "servers",
  "label",
  "enabled",
  "type",
  "command",
  "args",
  "env",
  "url",
  "headers",
  "auth",
  "scopes",
  "clientId",
  "clientSecretRef",
  "value",
  "credentialRef",
  "prefix",
]);
interface SourceNode {
  range: [number, number];
  children: Map<string | number, SourceNode>;
}

/** Strict scanner retains locations without exposing arbitrary keys or parser exceptions. */
export function validateMcpConnectorText(source: string): McpTextValidation {
  let position = 0;
  let nodes = 0;
  // Share prefixes: serializing full paths duplicates long unknown keys per array item.
  const ranges: SourceNode = { range: [0, 1], children: new Map() };
  const scalar = /(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/y;
  const issues: McpTextIssue[] = [];
  const location = (offset: number) => {
    const prefix = source.slice(0, offset);
    const lines = prefix.split(/\r\n|\r|\n/);
    return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
  };
  const issue = (
    code: IssueCode,
    path: readonly (string | number)[],
    start: number,
    end: number,
  ) => {
    if (issues.length >= MCP_TEXT_LIMITS.issues) return;
    const from = location(start);
    const to = location(Math.max(start + 1, end));
    issues.push({
      code,
      message: messages[code],
      path: path.map((part, index) =>
        typeof part === "number"
          ? part
          : index === 1 && path[0] === "servers"
            ? "*"
            : fields.has(part)
              ? part
              : "*",
      ),
      line: from.line,
      column: from.column,
      endLine: to.line,
      endColumn: to.column,
    });
  };
  const fail = (code: IssueCode, path: readonly (string | number)[] = []) => {
    issue(code, path, position, position + 1);
    throw code;
  };
  if (
    source.length > MCP_TEXT_LIMITS.bytes ||
    new TextEncoder().encode(source).length > MCP_TEXT_LIMITS.bytes
  ) {
    issue("too-large", [], 0, 1);
    return { valid: false, issues };
  }
  if (
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      new TextEncoder().encode(source),
    ) !== source
  ) {
    issue("encoding", [], 0, 1);
    return { valid: false, issues };
  }
  const whitespace = () => {
    while (/[\t\r\n ]/.test(source[position] ?? "!") && position < source.length) position++;
  };
  const string = (): string => {
    const start = position;
    if (source[position++] !== '"') fail("syntax");
    while (position < source.length) {
      const ch = source[position++];
      if (ch === '"') {
        try {
          return JSON.parse(source.slice(start, position));
        } catch {
          fail("syntax");
        }
      }
      if (ch === "\\") {
        const escaped = source[position++];
        if (escaped === "u") {
          if (!/^[0-9a-f]{4}$/i.test(source.slice(position, position + 4))) fail("syntax");
          position += 4;
        } else if (!escaped || !'"\\/bfnrt'.includes(escaped)) fail("syntax");
      } else if (ch && ch.charCodeAt(0) < 32) fail("syntax");
    }
    return fail("syntax");
  };
  const value = (path: (string | number)[], depth: number, range: SourceNode): void => {
    whitespace();
    if (++nodes > MCP_TEXT_LIMITS.nodes) fail("too-complex", path);
    const start = position;
    const ch = source[position];
    if (ch === "{" || ch === "[") {
      if (depth >= MCP_TEXT_LIMITS.depth) fail("too-deep", path);
      const object = ch === "{";
      const end = object ? "}" : "]";
      position++;
      whitespace();
      const keys = new Set<string>();
      let index = 0;
      if (source[position] !== end)
        for (;;) {
          let key: string | number = index++;
          if (object) {
            whitespace();
            const keyStart = position;
            key = string();
            if (keys.has(key)) issue("duplicate-key", [...path, key], keyStart, position);
            keys.add(key);
            whitespace();
            if (source[position++] !== ":") fail("syntax", path);
          }
          const child: SourceNode = { range: [position, position + 1], children: new Map() };
          range.children.set(key, child);
          value([...path, key], depth + 1, child);
          whitespace();
          if (source[position] === end) break;
          if (source[position++] !== ",") fail("syntax", path);
        }
      position++;
    } else if (ch === '"') string();
    else {
      scalar.lastIndex = position;
      const token = scalar.exec(source);
      if (!token) fail("syntax", path);
      position = scalar.lastIndex;
    }
    range.range = [start, position];
  };
  try {
    value([], 0, ranges);
    whitespace();
    if (position !== source.length) fail("syntax");
    if (issues.length) return { valid: false, issues };
    const result = mcpConnectorDocumentSchema.safeParse(JSON.parse(source), { jitless: true });
    if (result.success) return { valid: true, document: result.data, issues: [] };
    for (const error of result.error.issues.slice(0, MCP_TEXT_LIMITS.issues)) {
      const path = error.path.filter(
        (part): part is string | number => typeof part === "string" || typeof part === "number",
      );
      let located = ranges;
      for (const part of path) {
        const child = located.children.get(part);
        if (!child) break;
        located = child;
      }
      const [start, end] = located.range;
      issue("schema", path, start, end);
    }
  } catch {
    if (!issues.length) issue("syntax", [], position, position + 1);
  }
  return { valid: false, issues };
}
