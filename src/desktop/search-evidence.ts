import {
  type SearchSummarySource,
  searchEvidenceExcerpt,
  searchKeywords,
} from "../bridge/index.js";
import { readFiles } from "./files.js";

const excluded = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "target",
  "coverage",
  "test-results",
  "playwright-report",
  "media",
  "__pycache__",
  ".git",
  ".code60",
  ".code60_workspace",
]);
const textFile = /\.(md|txt|json|toml|ya?ml|[cm]?jsx?|tsx?|py|rs|go|html|css|svelte|vue|sh)$/i;
const secretFile = /(^|[._-])(secret|credentials|password|token|private[-_]?key)([._-]|$)/i;

function priority(path: string, terms: readonly string[]): number {
  const lower = path.toLocaleLowerCase();
  const name = lower.split("/").at(-1) ?? lower;
  return (
    terms.filter((term) => lower.includes(term)).length * 100 +
    (/^readme(?:\.|$)/.test(name) ? 80 : 0) +
    (/^(architecture|overview|about|design)\./.test(name) ? 60 : 0) +
    (/^(package.json|cargo.toml|pyproject.toml|go.mod)$/.test(name) ? 40 : 0) -
    path.split("/").length
  );
}

/** Bounded, read-only retrieval through the same path/encoding/link checks as Files. */
export async function projectSearchEvidence(
  root: string,
  query: string,
  signal: AbortSignal,
  read: typeof readFiles = readFiles,
): Promise<SearchSummarySource[]> {
  const folders = [""];
  const candidates: string[] = [];
  const terms = searchKeywords(query);
  for (let visited = 0; folders.length && visited < 32; visited++) {
    signal.throwIfAborted();
    const folder = folders.shift() as string;
    const snapshot = await read(
      { project: root, root, directories: folder ? ["", folder] : [""], preview: null },
      () => !signal.aborted,
    );
    const directory = snapshot.directories.find((entry) => entry.path === folder);
    if (!folder && directory?.error)
      throw new Error(`Project files unavailable: ${directory.error}`);
    for (const entry of directory?.entries ?? []) {
      if (entry.name.startsWith(".") || excluded.has(entry.name)) continue;
      if (entry.kind === "directory" && entry.path.split("/").length <= 4 && folders.length < 64)
        folders.push(entry.path);
      if (
        entry.kind === "file" &&
        !secretFile.test(entry.name) &&
        !/(lock|\.min\.[cm]?js|\.map)$/.test(entry.name) &&
        entry.name !== "package-lock.json" &&
        (textFile.test(entry.name) || entry.name === "go.mod") &&
        candidates.length < 2000
      )
        candidates.push(entry.path);
    }
    folders.sort((a, b) => priority(b, terms) - priority(a, terms) || a.localeCompare(b));
  }
  candidates.sort((a, b) => priority(b, terms) - priority(a, terms) || a.localeCompare(b));
  const sources: { source: SearchSummarySource; score: number }[] = [];
  for (const path of candidates.slice(0, 24)) {
    signal.throwIfAborted();
    const snapshot = await read(
      { project: root, root, directories: [""], preview: path },
      () => !signal.aborted,
    );
    const text = snapshot.preview?.text;
    if (text === undefined || text === null || !text.trim()) continue;
    const lower = text.toLocaleLowerCase();
    sources.push({
      score: priority(path, terms) + terms.filter((term) => lower.includes(term)).length * 10,
      source: {
        id: `file:${path}`,
        kind: "file",
        path,
        title: path,
        text: searchEvidenceExcerpt(text, query),
      },
    });
  }
  signal.throwIfAborted();
  return sources
    .sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id))
    .slice(0, 10)
    .map((entry) => entry.source);
}
