import {
  collectHeartbeatAttentionItems,
  formatHeartbeatDuration,
  HEARTBEAT_ACTION_STATUS_LABELS,
  HEARTBEAT_RUN_STATUS_LABELS,
  HEARTBEAT_SOURCE_LABELS,
  type HeartbeatSnapshot,
} from "../contracts/index.js";
import { managementRequest } from "../gateway/index.js";

const HEARTBEAT_HELP = [
  "Usage: code60 heartbeat [status|run] [options]",
  "",
  "Inspect or initiate a Core Heartbeat maintenance sweep in Code60 Gateway.",
  "",
  "Commands:",
  "  status            Show the latest Heartbeat timing, attention items, and audit log (default)",
  "  run               Initiate a manual Heartbeat sweep now",
  "",
  "Options:",
  "  --inspect         Run in read-only dry-run mode (with `run`)",
  "  --json            Print the full Heartbeat snapshot as JSON",
  "  --help            Show this help message",
  "",
].join("\n");

export interface HeartbeatCliOptions {
  help: boolean;
  subcommand: "status" | "run";
  inspect: boolean;
  json: boolean;
}

export function parseHeartbeatCliArgs(args: readonly string[]): HeartbeatCliOptions {
  let subcommand: "status" | "run" | undefined;
  let inspect = false;
  let json = false;
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      return { help: true, subcommand: "status", inspect: false, json: false };
    }
    if (arg === "--inspect") {
      inspect = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if ((arg === "status" || arg === "run") && subcommand === undefined) {
      subcommand = arg;
      continue;
    }
    throw new Error(`Unknown heartbeat argument: ${arg}. Use code60 heartbeat --help.`);
  }
  if (inspect && (subcommand ?? "status") !== "run") {
    throw new Error("--inspect can only be used with `code60 heartbeat run`.");
  }
  return { help: false, subcommand: subcommand ?? "status", inspect, json };
}

export function formatHeartbeatCliSummary(snapshot: HeartbeatSnapshot): string {
  const latest = snapshot.currentRun ?? snapshot.lastCompletedRun;
  const lines = [
    `Heartbeat: ${snapshot.policy.enabled ? `enabled (every ${snapshot.policy.intervalMinutes}m)` : "paused"}`,
    `Next scheduled: ${snapshot.nextRunAt ?? "None"}`,
  ];
  if (!latest) {
    lines.push("Last heartbeat: Not yet run");
    return `${lines.join("\n")}\n`;
  }
  const attention = collectHeartbeatAttentionItems(latest);
  lines.push(
    `Last heartbeat: ${HEARTBEAT_RUN_STATUS_LABELS[latest.status]} (${latest.mode})`,
    `Source:     ${HEARTBEAT_SOURCE_LABELS[latest.trigger]}`,
    `Initiated:  ${latest.startedAt}`,
    `Terminated: ${latest.endedAt ?? "In progress"}`,
    `Duration:   ${formatHeartbeatDuration(latest.durationMs)}`,
  );
  if (attention.length > 0) {
    lines.push("", `Needs attention (${attention.length}):`);
    for (const item of attention) {
      lines.push(`  - ${item.finding.title}: ${item.finding.summary}`);
      if (item.finding.howToFix) {
        lines.push(`    Fix: ${item.finding.howToFix}`);
      }
    }
  }
  lines.push("", "What ran:");
  for (const action of latest.actions) {
    lines.push(
      `  - [${HEARTBEAT_ACTION_STATUS_LABELS[action.status]}] ${action.title} (${formatHeartbeatDuration(action.durationMs)}): ${action.summary}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export async function runHeartbeatCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  request = managementRequest,
): Promise<void> {
  const options = parseHeartbeatCliArgs(args);
  if (options.help) {
    process.stdout.write(HEARTBEAT_HELP);
    return;
  }
  const payload =
    options.subcommand === "run"
      ? { action: "run", mode: options.inspect ? "inspect" : "maintain" }
      : { action: "snapshot" };
  const snapshot = (await request(env, "heartbeat", payload)) as unknown as HeartbeatSnapshot;
  if (options.json) {
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    return;
  }
  process.stdout.write(formatHeartbeatCliSummary(snapshot));
}
