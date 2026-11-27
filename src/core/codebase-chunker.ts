import type { PermissionRequest } from "../agents/index.js";
import { CODEBASE_SEARCH_SERVER_NAME, isCodebaseSearchTool } from "../contracts/index.js";
import { chunkText } from "./rag.js";

/** Bump the version whenever code chunk boundaries or embedded header format change. */
export const CODEBASE_CHUNKER = {
  id: "code-lines",
  version: 1,
  maxTokens: 512,
  overlapTokens: 64,
} as const;

export const CODEBASE_LIMITS = {
  maxFileBytes: 256 * 1024,
  maxFilesPerRepo: 10_000,
  maxChunksPerRepo: 50_000,
  maxRepositories: 64,
  maxQueryTokens: 512,
  embedBatchSize: 8,
} as const;

export interface CodeChunk {
  index: number;
  startLine: number;
  endLine: number;
  /** Raw source excerpt without synthetic header, returned to callers. */
  text: string;
  /** Header-prefixed text passed to the embedding model (<= 512 tokens). */
  embeddingText: string;
}

const EXCLUDED_FILENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "cargo.lock",
  "go.sum",
  "poetry.lock",
  "pipfile.lock",
  "composer.lock",
  "gemfile.lock",
  "flake.lock",
  "shrinkwrap.yaml",
]);

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  "target",
]);

const EXCLUDED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".icns",
  ".svg",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".wasm",
  ".onnx",
  ".bin",
  ".dat",
  ".sqlite",
  ".sqlite3",
  ".db",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".wav",
  ".ogg",
  ".mp4",
  ".mov",
  ".avi",
  ".webm",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".a",
  ".o",
  ".obj",
  ".pyc",
  ".pyo",
  ".class",
  ".jar",
  ".war",
  ".map",
]);

const LANGUAGE_BY_EXT: Readonly<Record<string, string>> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "jsx",
  ".py": "python",
  ".pyi": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".fish": "shell",
  ".sql": "sql",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".json": "json",
  ".jsonc": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".md": "markdown",
  ".mdx": "markdown",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".proto": "protobuf",
  ".tf": "hcl",
  ".hcl": "hcl",
  ".lua": "lua",
  ".r": "r",
  ".scala": "scala",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hs": "haskell",
  ".dart": "dart",
  ".vue": "vue",
  ".svelte": "svelte",
  ".txt": "text",
};

const LANGUAGE_BY_FILENAME: Readonly<Record<string, string>> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  cmakelists: "cmake",
  "cmakelists.txt": "cmake",
  justfile: "just",
  gemfile: "ruby",
  rakefile: "ruby",
  podfile: "ruby",
  vagrantfile: "ruby",
  ".gitignore": "gitignore",
  ".dockerignore": "dockerignore",
};

/** Returns true when a tracked Git blob should be indexed for vector codebase search. */
export function isIndexableCodeFile(path: string, size: number): boolean {
  if (!path || size <= 0 || size > CODEBASE_LIMITS.maxFileBytes) return false;
  const segments = path.split("/");
  for (let i = 0; i < segments.length - 1; i++) {
    const dir = segments[i]?.toLowerCase();
    if (dir && EXCLUDED_DIRS.has(dir)) return false;
  }
  const base = (segments.at(-1) ?? "").toLowerCase();
  if (!base || EXCLUDED_FILENAMES.has(base)) return false;
  if (base.endsWith(".min.js") || base.endsWith(".min.css") || base.endsWith(".bundle.js"))
    return false;
  const dot = base.lastIndexOf(".");
  if (dot > 0) {
    const ext = base.slice(dot);
    if (EXCLUDED_EXTENSIONS.has(ext)) return false;
  }
  return true;
}

/** Deterministic lowercase language label inferred from a repository-relative path. */
export function detectCodeLanguage(path: string): string {
  const base = (path.split("/").at(-1) ?? "").toLowerCase();
  const byName = LANGUAGE_BY_FILENAME[base];
  if (byName) return byName;
  const dot = base.lastIndexOf(".");
  if (dot > 0) {
    const ext = base.slice(dot);
    const byExt = LANGUAGE_BY_EXT[ext];
    if (byExt) return byExt;
  }
  return "text";
}

const BOUNDARY_LINE =
  /^\s*(?:$|export\s+|(?:async\s+)?function\s+|class\s+|interface\s+|type\s+|enum\s+|def\s+|async\s+def\s+|fn\s+|pub\s+(?:fn|struct|enum|trait|mod)\s+|struct\s+|impl\b|func\s+|package\s+|#{1,6}\s+)/;

/**
 * Splits a source file into line-aligned chunks strictly within `maxTokens` (including the
 * synthetic `// path: ...` header and model special tokens), with line overlap between adjacent
 * chunks. Ultra-long single lines fall back to `chunkText`.
 */
export function chunkCodeFile(
  path: string,
  content: string,
  countTokens: (text: string) => number,
  maxTokens: number = CODEBASE_CHUNKER.maxTokens,
  overlapTokens: number = CODEBASE_CHUNKER.overlapTokens,
): CodeChunk[] {
  if (!content.trim()) return [];
  const header = `// path: ${path}\n`;
  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalized.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();

  const special = countTokens("");
  const headerCost = Math.max(0, countTokens(header) - special);
  const bodyBudget = maxTokens - special - headerCost;
  const effectiveHeader = bodyBudget >= 32 ? header : "";
  const effectiveHeaderCost = effectiveHeader ? headerCost : 0;
  const effectiveBudget = maxTokens - special - effectiveHeaderCost;
  if (effectiveBudget < 1) throw new Error("Code chunk token limit leaves no room for content");

  const lineCosts = lines.map((line) => Math.max(1, countTokens(`${line}\n`) - special));
  const chunks: CodeChunk[] = [];
  let start = 0;

  while (start < lines.length) {
    const firstLine = lines[start] ?? "";
    const firstCandidate = `${effectiveHeader}${firstLine}`;
    if (countTokens(firstCandidate) > maxTokens) {
      // Single oversized line: split with exact character spans via core `chunkText`.
      const subBudget = Math.max(1, maxTokens - effectiveHeaderCost);
      const subOverlap = Math.min(overlapTokens, Math.max(0, subBudget - 1));
      const spans = chunkText(firstLine, countTokens, subBudget, subOverlap);
      for (const span of spans) {
        const piece = firstLine.slice(span.start, span.end);
        const embed = `${effectiveHeader}${piece}`;
        const finalEmbed = countTokens(embed) <= maxTokens ? embed : piece;
        if (piece.trim()) {
          chunks.push({
            index: chunks.length,
            startLine: start + 1,
            endLine: start + 1,
            text: piece,
            embeddingText: finalEmbed,
          });
        }
      }
      start += 1;
      continue;
    }

    let end = start;
    let estimated = lineCosts[start] ?? 1;
    let preferredBreak = -1;
    const softTarget = Math.floor(effectiveBudget * 0.72);

    while (end + 1 < lines.length) {
      const nextCost = lineCosts[end + 1] ?? 1;
      if (estimated + nextCost > effectiveBudget) break;
      end += 1;
      estimated += nextCost;
      if (estimated >= softTarget && BOUNDARY_LINE.test(lines[end] ?? "")) {
        preferredBreak = end;
      }
    }

    if (preferredBreak > start && end + 1 < lines.length) {
      end = preferredBreak;
    }

    // Verify exact tokenization across joined lines; trim back if non-additive tokenization overflows.
    let body = lines.slice(start, end + 1).join("\n");
    while (end > start && countTokens(`${effectiveHeader}${body}`) > maxTokens) {
      end -= 1;
      body = lines.slice(start, end + 1).join("\n");
    }

    if (body.trim()) {
      chunks.push({
        index: chunks.length,
        startLine: start + 1,
        endLine: end + 1,
        text: body,
        embeddingText: `${effectiveHeader}${body}`,
      });
    }

    if (end + 1 >= lines.length) break;

    let nextStart = end + 1;
    let overlap = 0;
    while (nextStart - 1 > start) {
      const candidateCost = lineCosts[nextStart - 1] ?? 1;
      if (overlap + candidateCost > overlapTokens) break;
      nextStart -= 1;
      overlap += candidateCost;
    }
    start = nextStart > start ? nextStart : end + 1;
  }

  return chunks;
}

/**
 * Converts free-form user/agent query text into a safe SQLite FTS5 query string.
 * Returns null when no searchable tokens exist.
 */
export function buildFtsQuery(rawQuery: string): string | null {
  const tokens = rawQuery.match(/[A-Za-z0-9_]+/g);
  if (!tokens || tokens.length === 0) return null;
  const expanded: string[] = [];
  const seen = new Set<string>();
  const push = (token: string) => {
    const lower = token.toLowerCase();
    if (lower.length < 2 || seen.has(lower) || expanded.length >= 24) return;
    seen.add(lower);
    expanded.push(`"${lower.replaceAll('"', '""')}"`);
  };
  for (const token of tokens) {
    push(token);
    // Split camelCase and snake_case identifiers into sub-terms for broader lexical recall.
    for (const part of token.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[_\s]+/)) {
      if (part !== token) push(part);
    }
  }
  return expanded.length > 0 ? expanded.join(" OR ") : null;
}

export interface VectorCandidate {
  id: number;
  path: string;
  startLine: number;
  endLine: number;
  language: string;
  text: string;
  vectorScore: number;
}

export interface LexicalCandidate {
  id: number;
  path: string;
  startLine: number;
  endLine: number;
  language: string;
  text: string;
  lexicalRank: number;
}

export interface RankedCodebaseHit {
  id: number;
  path: string;
  startLine: number;
  endLine: number;
  language: string;
  text: string;
  score: number;
  vectorScore: number;
  lexicalMatch: boolean;
}

const RRF_K = 60;

/**
 * Reciprocal Rank Fusion combining ONNX vector similarity candidates and SQLite FTS5 lexical hits.
 * Ties break deterministically by vectorScore descending, path ascending, then startLine ascending.
 */
export function rankCodebaseHits(
  vectorCandidates: readonly VectorCandidate[],
  lexicalCandidates: readonly LexicalCandidate[],
  limit: number,
): RankedCodebaseHit[] {
  const vectorById = new Map<number, { item: VectorCandidate; rank: number }>();
  vectorCandidates.forEach((item, rank) => {
    if (!vectorById.has(item.id)) vectorById.set(item.id, { item, rank });
  });

  const lexicalById = new Map<number, { item: LexicalCandidate; rank: number }>();
  lexicalCandidates.forEach((item, rank) => {
    if (!lexicalById.has(item.id)) lexicalById.set(item.id, { item, rank });
  });

  const ids = new Set<number>([...vectorById.keys(), ...lexicalById.keys()]);
  const combined: RankedCodebaseHit[] = [];

  for (const id of ids) {
    const v = vectorById.get(id);
    const l = lexicalById.get(id);
    const base = v?.item ?? l?.item;
    if (!base) continue;
    const score =
      (v === undefined ? 0 : 1 / (RRF_K + v.rank)) + (l === undefined ? 0 : 1 / (RRF_K + l.rank));
    combined.push({
      id,
      path: base.path,
      startLine: base.startLine,
      endLine: base.endLine,
      language: base.language,
      text: base.text,
      score: Number(score.toFixed(6)),
      vectorScore: v ? Number(v.item.vectorScore.toFixed(6)) : 0,
      lexicalMatch: l !== undefined,
    });
  }

  combined.sort(
    (a, b) =>
      b.score - a.score ||
      b.vectorScore - a.vectorScore ||
      a.path.localeCompare(b.path) ||
      a.startLine - b.startLine,
  );
  return combined.slice(0, Math.max(0, limit));
}

/**
 * True only for structured ACP permission requests targeting Code60's built-in read-only
 * `code60-code` codebase search tools (never inferred from free-text titles).
 */
export function isBuiltinCodebaseSearchPermission(
  request: Pick<PermissionRequest, "mcp">,
): boolean {
  const server = request.mcp?.server;
  const tool = request.mcp?.tool;
  if (!server || !tool) return false;
  const normalizedServer = server.replaceAll("_", "-");
  return normalizedServer === CODEBASE_SEARCH_SERVER_NAME && isCodebaseSearchTool(tool);
}
