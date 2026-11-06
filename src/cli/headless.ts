import type { Orchestrator, RunEvent, RunResult } from "../core/index.js";
import { oneLine, table } from "./text.js";

interface Writer {
  write(chunk: string): unknown;
}

/** Writes one progress line per status change, new tool call, and permission decision. */
export function reportProgress(orchestrator: Orchestrator, stderr: Writer): () => void {
  const agents = new Map(orchestrator.runs().map((r) => [r.id, r.agent]));
  const seenTools = new Set<string>();
  const lastStatus = new Map<string, string>();
  const prefix = (e: RunEvent) => `[${e.runId} ${agents.get(e.runId) ?? "?"}]`;
  const offEvent = orchestrator.onEvent((e) => {
    switch (e.type) {
      case "status": {
        const line = e.reason === undefined ? e.status : `${e.status}: ${oneLine(e.reason, 200)}`;
        if (lastStatus.get(e.runId) === line) return;
        lastStatus.set(e.runId, line);
        stderr.write(`${prefix(e)} ${line}\n`);
        return;
      }
      case "toolCall": {
        const key = `${e.runId}\0${e.toolCallId}`;
        if (seenTools.has(key) && e.status !== "failed") return;
        seenTools.add(key);
        stderr.write(`${prefix(e)} tool: ${oneLine(e.title, 120)} (${e.kind}, ${e.status})\n`);
        return;
      }
      case "permission":
        stderr.write(
          `${prefix(e)} permission ${e.decision} by ${e.by}: ${oneLine(e.title, 120)} (${e.kind})\n`,
        );
        return;
      default:
        return;
    }
  });
  const offWarning = orchestrator.onWarning((message) => {
    stderr.write(`code60: warning: ${message}\n`);
  });
  return () => {
    offEvent();
    offWarning();
  };
}

export function formatResultsJson(results: readonly RunResult[]): string {
  return `${JSON.stringify({ runs: results }, null, 2)}\n`;
}

export function formatResultsTable(results: readonly RunResult[]): string {
  const rows = results.map((r) => [
    r.id,
    r.agent,
    r.status,
    r.changedFiles === null ? "-" : String(r.changedFiles),
    r.branch ?? "(no worktree)",
  ]);
  let out = table(["RUN", "AGENT", "STATUS", "FILES", "BRANCH"], rows);
  for (const r of results) {
    out +=
      r.branch === null
        ? `\n${r.id}\n  directory: ${oneLine(r.worktree)} (no worktree)\n`
        : `\n${r.id}\n  worktree: ${oneLine(r.worktree)}\n`;
    if (r.reason !== null) out += `  reason:   ${oneLine(r.reason, 300)}\n`;
  }
  out += '\n"finished" means the agent ended its turn normally. The changes were not verified.\n';
  if (results.some((r) => r.branch !== null)) out += "Review them with: code60 diff <run-id>\n";
  if (results.some((r) => r.branch === null)) {
    out += "Runs without a worktree changed files directly in their directory.\n";
  }
  return out;
}
