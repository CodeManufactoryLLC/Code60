#!/usr/bin/env node
import { writeFileSync } from "node:fs";
// Runs the scriptable fake agent over stdio. Set FAKE_AGENT_AUTH=1 to require authentication.
import { Readable, Writable } from "node:stream";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import { createFakeAgent } from "./fake-agent-app.mjs";

const pidFileIndex = process.argv.indexOf("--pid-file");
if (pidFileIndex >= 0) writeFileSync(process.argv[pidFileIndex + 1], String(process.pid));
if (process.env.FAKE_AGENT_STDERR) process.stderr.write(process.env.FAKE_AGENT_STDERR);
createFakeAgent({
  sessionInfo: process.argv.includes("--session-info"),
  planWorkflow: process.argv.includes("--plan"),
  reviewWorkflow: process.argv.includes("--review"),
  relayWorkflow: process.argv.includes("--relay"),
  memoryExtraction: process.argv.includes("--memory"),
  authRequired: process.env.FAKE_AGENT_AUTH === "1" || process.argv.includes("--auth"),
}).connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
