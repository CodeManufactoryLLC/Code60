// Fake ACP provider that really launches and speaks MCP to the supplied stdio adapter.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Readable, Writable } from "node:stream";
import { agent, methods, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";

let adapter;
let sequence = 0;
let cancelled = false;
let callId;
const pending = new Map();
const notify = (method, params) =>
  adapter.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
const request = (method, params = {}) => {
  const id = ++sequence;
  if (method === "tools/call") callId = id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Fixture MCP timeout"));
    }, 8000);
    pending.set(id, { resolve, reject, timer });
    adapter.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
};
const setup = async (method, params) => {
  const server = params.mcpServers[0];
  adapter = spawn(server.command, server.args, {
    cwd: params.cwd,
    env: {
      ...process.env,
      ...Object.fromEntries(server.env.map(({ name, value }) => [name, value])),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  adapter.stderr.resume();
  const fail = () => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error("Fixture adapter stopped"));
    }
    pending.clear();
  };
  adapter.on("error", fail);
  adapter.on("exit", fail);
  const lines = createInterface({ input: adapter.stdout });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    const entry = pending.get(message.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error("MCP rejected"));
    else entry.resolve(message.result);
  });
  const initialized = await request("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "fixture", version: "1" },
  });
  notify("notifications/initialized", {});
  const catalog = await request("tools/list");
  writeFileSync(
    process.env.CONNECTOR_EVIDENCE,
    JSON.stringify({ method, params, adapterPid: adapter.pid, initialized, catalog }),
    { mode: 0o600 },
  );
  return { sessionId: params.sessionId ?? process.env.CONNECTOR_SESSION };
};
const app = agent({ name: "connector-fixture" })
  .onRequest(methods.agent.initialize, () => ({
    protocolVersion: PROTOCOL_VERSION,
    agentCapabilities:
      process.env.CONNECTOR_RESTORE === "resume"
        ? { sessionCapabilities: { resume: {} } }
        : { loadSession: true },
  }))
  .onRequest(methods.agent.session.new, ({ params }) => setup("new", params))
  .onRequest(methods.agent.session.load, ({ params }) => setup("load", params))
  .onRequest(methods.agent.session.resume, ({ params }) => setup("resume", params))
  .onNotification(methods.agent.session.cancel, () => {
    cancelled = true;
    if (callId !== undefined) notify("notifications/cancelled", { requestId: callId });
  })
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    cancelled = false;
    const action = JSON.parse(params.prompt.find((item) => item.type === "text").text);
    const message = (text) =>
      client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
      });
    const permission = await client.request(methods.client.session.requestPermission, {
      sessionId: params.sessionId,
      toolCall: { toolCallId: "connector-call", title: "Use connector tool", kind: "other" },
      options: [
        { optionId: "allow", name: "Allow once", kind: "allow_once" },
        { optionId: "deny", name: "Deny once", kind: "reject_once" },
      ],
    });
    if (permission.outcome.outcome !== "selected" || permission.outcome.optionId !== "allow") {
      await message("denied");
      return { stopReason: "end_turn" };
    }
    try {
      const result = await request(action.method ?? "tools/call", {
        name: "fixture_tool",
        arguments: { slow: action.slow === true },
      });
      await message(JSON.stringify(result));
    } catch {
      await message(cancelled ? "cancelled" : "rejected");
    }
    return { stopReason: cancelled ? "cancelled" : "end_turn" };
  });
process.stdin.once("end", () => adapter?.stdin.end());
app.connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
