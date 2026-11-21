#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
// Runs the scriptable fake agent over stdio. Set FAKE_AGENT_AUTH=1 to require authentication.
import { Readable, Writable } from "node:stream";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import { createFakeAgent } from "./fake-agent-app.mjs";

const pidFileIndex = process.argv.indexOf("--pid-file");
if (pidFileIndex >= 0) writeFileSync(process.argv[pidFileIndex + 1], String(process.pid));
// Per-process evidence avoids losing earlier probe/helper PIDs in a shared pid file.
// Windows reuses PIDs of exited providers quickly, so each entry also has its own instance ID.
const instance = randomUUID();
const processLogIndex = process.argv.indexOf("--process-log");
if (processLogIndex >= 0)
  writeFileSync(
    join(process.argv[processLogIndex + 1], `${process.pid}-${instance}.json`),
    JSON.stringify({ pid: process.pid, parent: process.ppid, cwd: process.cwd() }),
    { flag: "wx" },
  );
if (process.env.FAKE_AGENT_STDERR) process.stderr.write(process.env.FAKE_AGENT_STDERR);
const promptLogIndex = process.argv.indexOf("--prompt-log");
const chatTitleIndex = process.argv.indexOf("--chat-title");
let promptSequence = 0;
createFakeAgent({
  chatTitle: chatTitleIndex >= 0 ? process.argv[chatTitleIndex + 1] : undefined,
  onPrompt: () => {
    if (promptLogIndex >= 0)
      writeFileSync(
        join(
          process.argv[promptLogIndex + 1],
          `${process.pid}-${instance}-${++promptSequence}.json`,
        ),
        JSON.stringify({ pid: process.pid, cwd: process.cwd() }),
        { flag: "wx" },
      );
  },
  sessionInfo: process.argv.includes("--session-info"),
  planWorkflow: process.argv.includes("--plan"),
  reviewWorkflow: process.argv.includes("--review"),
  relayWorkflow: process.argv.includes("--relay"),
  memoryExtraction: process.argv.includes("--memory"),
  browserWorkflow: process.argv.includes("--browser"),
  authRequired: process.env.FAKE_AGENT_AUTH === "1" || process.argv.includes("--auth"),
}).connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
