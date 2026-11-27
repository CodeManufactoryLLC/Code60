import { describe, expect, it } from "vitest";
import {
  buildFtsQuery,
  chunkCodeFile,
  detectCodeLanguage,
  isBuiltinCodebaseSearchPermission,
  isIndexableCodeFile,
  rankCodebaseHits,
} from "./codebase-chunker.js";

const wordTokens = (text: string) => 2 + (text.trim() ? text.trim().split(/\s+/).length : 0);

describe("codebase-chunker", () => {
  it("filters out lockfiles, binaries, generated dirs, and oversized files", () => {
    expect(isIndexableCodeFile("src/core/rag.ts", 1024)).toBe(true);
    expect(isIndexableCodeFile("Dockerfile", 512)).toBe(true);
    expect(isIndexableCodeFile("package-lock.json", 5000)).toBe(false);
    expect(isIndexableCodeFile("pnpm-lock.yaml", 5000)).toBe(false);
    expect(isIndexableCodeFile("node_modules/pkg/index.js", 200)).toBe(false);
    expect(isIndexableCodeFile("dist/app.js", 200)).toBe(false);
    expect(isIndexableCodeFile("assets/logo.png", 200)).toBe(false);
    expect(isIndexableCodeFile("models/model.onnx", 200)).toBe(false);
    expect(isIndexableCodeFile("web/app.min.js", 200)).toBe(false);
    expect(isIndexableCodeFile("src/huge.ts", 300 * 1024)).toBe(false);
    expect(isIndexableCodeFile("src/empty.ts", 0)).toBe(false);
  });

  it("detects languages deterministically", () => {
    expect(detectCodeLanguage("src/core/rag.ts")).toBe("typescript");
    expect(detectCodeLanguage("src/ui/App.tsx")).toBe("tsx");
    expect(detectCodeLanguage("scripts/run.py")).toBe("python");
    expect(detectCodeLanguage("Dockerfile")).toBe("dockerfile");
    expect(detectCodeLanguage("Makefile")).toBe("makefile");
    expect(detectCodeLanguage("README.md")).toBe("markdown");
    expect(detectCodeLanguage("NOTES")).toBe("text");
  });

  it("chunks code into line-accurate spans within the token budget with overlap", () => {
    const lines = Array.from({ length: 40 }, (_, i) =>
      i % 10 === 0
        ? `export function fn${i}(arg: string) {`
        : `  const value${i} = compute(arg, ${i});`,
    );
    const content = `${lines.join("\n")}\n`;
    const chunks = chunkCodeFile("src/sample.ts", content, wordTokens, 60, 12);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(wordTokens(chunk.embeddingText)).toBeLessThanOrEqual(60);
      expect(chunk.startLine).toBeGreaterThanOrEqual(1);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
      expect(chunk.embeddingText.startsWith("// path: src/sample.ts\n")).toBe(true);
    }
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks.at(-1)?.endLine).toBe(40);
    // Adjacent chunks overlap on line boundaries.
    expect((chunks[1]?.startLine ?? 999) <= (chunks[0]?.endLine ?? 0)).toBe(true);
  });

  it("splits an oversized single line without exceeding maxTokens", () => {
    const singleLine = Array.from({ length: 120 }, (_, i) => `tok${i}`).join(" ");
    const chunks = chunkCodeFile("src/long.ts", singleLine, wordTokens, 40, 8);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(wordTokens(chunk.embeddingText)).toBeLessThanOrEqual(40);
      expect(chunk.startLine).toBe(1);
      expect(chunk.endLine).toBe(1);
    }
  });

  it("sanitizes FTS5 queries and expands camelCase/snake_case tokens", () => {
    expect(buildFtsQuery("   !!! ")).toBeNull();
    const fts = buildFtsQuery('syncMainBranch("origin/main") OR foo_bar');
    expect(fts).toContain('"syncmainbranch"');
    expect(fts).toContain('"sync"');
    expect(fts).toContain('"branch"');
    expect(fts).toContain('"foo_bar"');
    expect(fts).toContain('"foo"');
    expect(fts).toContain('"bar"');
  });

  it("fuses vector and lexical candidates via RRF with deterministic tie-breaking", () => {
    const vector = [
      {
        id: 1,
        path: "src/a.ts",
        startLine: 1,
        endLine: 10,
        language: "typescript",
        text: "a",
        vectorScore: 0.9,
      },
      {
        id: 2,
        path: "src/b.ts",
        startLine: 1,
        endLine: 10,
        language: "typescript",
        text: "b",
        vectorScore: 0.85,
      },
    ];
    const lexical = [
      {
        id: 2,
        path: "src/b.ts",
        startLine: 1,
        endLine: 10,
        language: "typescript",
        text: "b",
        lexicalRank: -1.5,
      },
      {
        id: 3,
        path: "src/c.ts",
        startLine: 5,
        endLine: 12,
        language: "typescript",
        text: "c",
        lexicalRank: -0.5,
      },
    ];
    const ranked = rankCodebaseHits(vector, lexical, 5);
    // id=2 appears in both vector and lexical lists, so it wins via RRF.
    expect(ranked[0]?.id).toBe(2);
    expect(ranked[0]?.lexicalMatch).toBe(true);
    expect(ranked[1]?.id).toBe(1);
    expect(ranked[1]?.lexicalMatch).toBe(false);
    expect(ranked[2]?.id).toBe(3);
    expect(ranked[2]?.vectorScore).toBe(0);
  });

  it("identifies built-in codebase search permissions strictly from structured MCP metadata", () => {
    expect(
      isBuiltinCodebaseSearchPermission({
        mcp: { server: "code60-code", tool: "code60_search_codebase" },
      }),
    ).toBe(true);
    expect(
      isBuiltinCodebaseSearchPermission({
        mcp: { server: "code60_code", tool: "code60_codebase_index_status" },
      }),
    ).toBe(true);
    expect(
      isBuiltinCodebaseSearchPermission({
        mcp: { server: "other-server", tool: "code60_search_codebase" },
      }),
    ).toBe(false);
    expect(
      isBuiltinCodebaseSearchPermission({
        mcp: { server: "code60-code", tool: "execute_shell" },
      }),
    ).toBe(false);
    expect(isBuiltinCodebaseSearchPermission({})).toBe(false);
  });
});
