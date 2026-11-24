#!/usr/local/bin/node
import { appendFileSync } from "node:fs";
import { basename } from "node:path";

const name = basename(process.argv[1]);
const args = process.argv.slice(2);
appendFileSync("/work/supervisor.jsonl", `${JSON.stringify({ name, args })}\n`, { mode: 0o600 });
if (
  name === "systemctl" &&
  args[0] === "--user" &&
  args[1] === "show" &&
  ["code60-gateway.service", "code60-scheduler.service"].includes(args[2])
) {
  process.stdout.write("LoadState=not-found\nActiveState=inactive\nMainPID=0\n");
} else {
  process.stderr.write("Acceptance refuses native supervisor/opener mutations.\n");
  process.exitCode = 2;
}
