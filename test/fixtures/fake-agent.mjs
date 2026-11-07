#!/usr/bin/env node
// Runs the scriptable fake agent over stdio. Set FAKE_AGENT_AUTH=1 to require authentication.
import { Readable, Writable } from "node:stream";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import { createFakeAgent } from "./fake-agent-app.mjs";

if (process.env.FAKE_AGENT_STDERR) process.stderr.write(process.env.FAKE_AGENT_STDERR);
createFakeAgent({
  sessionInfo: process.argv.includes("--session-info"),
  memoryExtraction: process.argv.includes("--memory"),
  authRequired: process.env.FAKE_AGENT_AUTH === "1" || process.argv.includes("--auth"),
}).connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
