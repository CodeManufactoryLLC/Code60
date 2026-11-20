#!/usr/bin/env node
// External Playwright MCP boundary only. No real browser, network or credentials.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
if (args[0] !== "-y" || args[1] !== "@playwright/mcp@0.0.84") process.exit(2);
const mode = args.includes("--extension")
  ? "existing-browser"
  : args.includes("--headless")
    ? "headless"
    : "visible";
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
  detached: true,
});
let childExited = false;
child.once("exit", () => {
  childExited = true;
});
const log = (entry) =>
  appendFileSync(
    process.env.FAKE_BROWSER_LOG,
    `${JSON.stringify({ pid: process.pid, child: child.pid, mode, ...entry })}\n`,
  );
log({ event: "start", args, cwd: process.cwd() });
const send = (id, result) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    send(request.id, {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} },
    });
  } else if (request.method === "tools/list") {
    send(request.id, {
      tools: [
        {
          name: "browser_navigate",
          description: "Navigate a fixture page",
          inputSchema: {
            type: "object",
            properties: { url: { type: "string" } },
            required: ["url"],
            additionalProperties: false,
          },
        },
      ],
    });
  } else if (request.method === "tools/call") {
    if (request.params.name === "browser_close") {
      log({ event: "browser-close" });
      if (childExited) send(request.id, { content: [] });
      else {
        child.once("exit", () => send(request.id, { content: [] }));
        child.kill();
      }
      return;
    }
    log({ event: "call", name: request.params.name, arguments: request.params.arguments });
    if (request.params.arguments.url.includes("slow")) return;
    const extensionMissing =
      mode === "existing-browser" && !existsSync(process.env.FAKE_BROWSER_APPROVAL);
    send(request.id, {
      content: [
        {
          type: "text",
          text: extensionMissing
            ? "Playwright extension unavailable in this fixture"
            : `Fixture navigation in ${mode}`,
        },
      ],
      ...(extensionMissing ? { isError: true } : {}),
    });
  }
});
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  if (childExited) {
    process.exit(0);
    return;
  }
  child.once("exit", () => process.exit(0));
  child.kill();
};
input.on("close", stop);
process.on("SIGTERM", stop);
