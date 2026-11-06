import type { ListedRun } from "../core/index.js";
import { oneLine, table } from "./text.js";

export function formatList(runs: readonly ListedRun[]): string {
  if (runs.length === 0) return "No runs in this repository.\n";
  const rows = runs.map(({ record: r }) => [
    r.id,
    r.agent,
    r.discardedAt === undefined ? r.status : `${r.status} (discarded)`,
    String(r.turns),
    r.startedAt.slice(0, 19).replace("T", " "),
    r.firstPrompt === "" ? "(no prompt)" : oneLine(r.firstPrompt, 50),
  ]);
  let out = table(["RUN", "AGENT", "STATUS", "TURNS", "STARTED (UTC)", "PROMPT"], rows);
  for (const { record: r, agentAlive, agentCommandLine } of runs) {
    if (r.status === "interrupted" && r.reason !== undefined) {
      const label = r.branch === null ? "directory" : "worktree";
      out += `\n${r.id}: interrupted: ${oneLine(r.reason)}\n  ${label}: ${oneLine(r.worktree)}\n`;
    }
    if (agentAlive) {
      out += `${r.id}: the agent may still be running: process group ${r.agentPid}: ${oneLine(agentCommandLine ?? "(command line unavailable)", 200)}\n`;
      out += `  stop it with: code60 stop ${r.id}\n`;
    }
  }
  return out;
}
