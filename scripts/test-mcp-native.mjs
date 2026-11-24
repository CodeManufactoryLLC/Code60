import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

// Explicit native QA exception: install only into a disposable prefix, never the user's app.
assert.ok(["darwin", "linux"].includes(process.platform));
assert.match(process.version, /^v24\./);
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const archive = resolve(process.argv[2] ?? `release/build/code60-${manifest.version}.tgz`);
await stat(archive);
const root = await mkdtemp(join(tmpdir(), "code60-mcp-native-"));
const evidence = resolve(process.env.CODE60_NATIVE_EVIDENCE ?? "test-results/qa/mcp-native");
await mkdir(evidence, { recursive: true });
const env = {
  PATH: process.env.PATH ?? "",
  HOME: join(root, "home"),
  TMPDIR: root,
  LANG: "en_US.UTF-8",
  CI: "1",
  npm_config_userconfig: "/dev/null",
  npm_config_cache: join(evidence, "npm-cache"),
};
await mkdir(env.HOME);
let broker;
let child;
let passed = false;
let cleaned = false;
let port;
let pid;
try {
  const installation = execFileSync(
    "npm",
    [
      "install",
      "--prefix",
      root,
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      archive,
    ],
    { env, encoding: "utf8", timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
  );
  await writeFile(join(evidence, "install.log"), installation);
  const packageRoot = join(root, "node_modules/code60");
  const { createMcpBroker } = await import(
    pathToFileURL(join(packageRoot, "dist/gateway/mcp-broker.js")).href
  );
  const { spawnOwnedProcess } = await import(
    pathToFileURL(join(packageRoot, "dist/platform/index.js")).href
  );
  broker = await createMcpBroker();
  port = new URL(broker.origin).port;
  let calls = 0;
  const entry = await broker.expose({
    id: "synthetic",
    owner: randomUUID(),
    tools: [{ name: "synthetic_tool", inputSchema: { type: "object" } }],
    call: async () => {
      calls++;
      return { content: [{ type: "text", text: "synthetic result" }] };
    },
  });
  assert.ok("env" in entry.descriptor);
  child = await spawnOwnedProcess([entry.descriptor.command, ...entry.descriptor.args], root, {
    PATH: env.PATH,
    HOME: env.HOME,
    ...Object.fromEntries(entry.descriptor.env.map(({ name, value }) => [name, value])),
  });
  pid = child.pid;
  child.stderr.resume();
  const pending = new Map();
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (text) => {
    let response;
    try {
      response = JSON.parse(text);
    } catch {
      for (const operation of pending.values()) {
        clearTimeout(operation.timer);
        operation.reject(new Error("Invalid native adapter response"));
      }
      pending.clear();
      return;
    }
    const operation = pending.get(response.id);
    if (!operation) return;
    pending.delete(response.id);
    clearTimeout(operation.timer);
    if (response.error) operation.reject(new Error("Native adapter rejected request"));
    else operation.resolve(response.result);
  });
  let sequence = 0;
  const request = (method, params = {}) => {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Native adapter deadline exceeded"));
      }, 10_000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  };
  const initialized = await request("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "synthetic-native-check", version: "1" },
  });
  assert.deepEqual(initialized.capabilities, { tools: {} });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  assert.equal((await request("tools/list")).tools.length, 1);
  assert.deepEqual(await request("tools/call", { name: "synthetic_tool", arguments: {} }), {
    content: [{ type: "text", text: "synthetic result" }],
  });
  assert.equal(calls, 1);
  await entry.revoke();
  await child.stop(500);
  await child.exited;
  lines.close();
  assert.throws(() => process.kill(pid, 0));
  assert.throws(() => process.kill(-pid, 0));
  passed = true;
} finally {
  const cleanup = await Promise.allSettled([child?.stop(0), broker?.close()]);
  const clean = cleanup.every((result) => result.status === "fulfilled");
  cleaned = clean;
  await writeFile(
    join(evidence, "native-result.json"),
    `${JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, archive, root, port, pid, passed, cleanup: clean })}\n`,
  );
  if (clean) await rm(root, { recursive: true, force: true });
}
if (!cleaned) throw new Error("Native cleanup remains unresolved; retain QA ownership");
process.stdout.write(
  "Native packaged MCP adapter: initialization, discovery, call, revocation and owned process-group cleanup passed.\n",
);
