#!/usr/bin/env node
// Synthetic external harnesses for isolated tests. Never uses provider accounts or networks.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";

const home = process.env.HOME;
const repo = process.env.CODE60_QA_REPO;
const log = process.env.CODE60_QA_PROCESS_LOG;
if (!home || !repo || !log) process.exit(90);
const args = process.argv.slice(2);
const provider = /\/providers\/([^/]+)\//.exec(process.argv[1])?.[1] ?? basename(process.argv[1]);
writeFileSync(
  join(log, `${process.pid}-${randomUUID()}.json`),
  JSON.stringify({ pid: process.pid, kind: provider }),
);
const versions = {
  claude: "2.1.331",
  antigravity: "1.5.15",
  copilot: "1.0.114",
  droid: "1.18.0",
  kiro: "3.5.0",
  opencode: "1.19.6",
};
if (provider === "copilot" && process.env.COPILOT_AUTO_UPDATE !== "false") process.exit(96);
const credentials = {
  claude: ".claude/.credentials.json",
  antigravity: ".gemini/antigravity-cli/credentials.json",
  copilot: ".copilot/config.json",
  droid: ".factory/auth.json",
  kiro: ".local/share/kiro-cli/data.sqlite3",
  opencode: ".local/share/opencode/auth.json",
};
const auth = join(home, credentials[provider] ?? ".invalid");
const save = () => {
  mkdirSync(dirname(auth), { recursive: true, mode: 0o700 });
  writeFileSync(auth, '{"synthetic":true}\n', { mode: 0o600 });
};
const approved = () => existsSync(join(home, `authorize-${provider}`));
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
if (provider === "npm") {
  if (
    !args.includes("--ignore-scripts") ||
    !args.includes("https://registry.npmjs.org") ||
    !args.at(-1)?.endsWith("adapter.tgz")
  )
    process.exit(91);
  if (existsSync(join(home, "fail-npm"))) process.exit(92);
  const prefix = args[args.indexOf("--prefix") + 1];
  const file = join(prefix, "node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js");
  await mkdir(dirname(file), { recursive: true });
  await copyFile(process.argv[1], file);
  await chmod(file, 0o700);
  await writeFile(
    join(dirname(dirname(file)), "package.json"),
    JSON.stringify({ type: "module", version: "0.110.1" }),
  );
} else if (args[0] === "--version") {
  process.stdout.write(`${versions[provider]}\n`);
} else if (
  (provider === "claude" && args[0] === "auth") ||
  (provider === "antigravity" && args.includes("--login"))
) {
  const url =
    provider === "claude"
      ? "https://claude.ai/oauth/authorize?state=QA-PRIVATE-STATE"
      : "https://accounts.google.com/o/oauth2/v2/auth?state=QA-PRIVATE-STATE";
  process.stdout.write(`${url}\nPaste code here: `);
  createInterface({ input: process.stdin }).once("line", (code) => {
    if (code !== "QA60-PASTE" || existsSync(join(home, "disabled-login"))) process.exit(3);
    save();
    process.stdout.write("Signed in\n");
    process.exit(0);
  });
} else if ((provider === "copilot" || provider === "kiro") && args[0] === "login") {
  const url =
    provider === "copilot" ? "https://github.com/login/device" : "https://app.kiro.dev/device";
  process.stdout.write(
    `To authenticate, visit ${url} and enter code QA60-1234\nWaiting for authorization...\n`,
  );
  const timer = setInterval(() => {
    if (!approved()) return;
    clearInterval(timer);
    if (existsSync(join(home, "disabled-login"))) process.exit(3);
    if (provider === "copilot" && existsSync(join(home, "no-keychain"))) {
      process.stdout.write("Store token in plaintext configuration file? [y/n]\n");
      createInterface({ input: process.stdin }).once("line", (answer) => {
        if (answer !== "y") process.exit(4);
        save();
        process.exit(0);
      });
    } else {
      save();
      process.exit(0);
    }
  }, 25);
} else if (provider === "droid" && !existsSync(auth)) {
  let pending;
  const timer = setInterval(() => {
    if (pending && approved()) {
      save();
      send({ jsonrpc: "2.0", id: pending, result: {} });
      pending = undefined;
    }
  }, 25);
  createInterface({ input: process.stdin }).on("line", (line) => {
    const request = JSON.parse(line);
    if (request.method === "initialize")
      send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: {},
          authMethods: [{ id: "device-pairing" }],
        },
      });
    else if (["authenticate", "session/new"].includes(request.method)) {
      pending = request.id;
      send({
        jsonrpc: "2.0",
        id: "device-login",
        method: "elicitation/create",
        params: {
          mode: "url",
          message: "Enter code QA60-1234",
          url: "https://app.factory.ai/cli-auth?code=QA60-1234",
          requestId: request.id,
          elicitationId: "device-login",
        },
      });
    } else if (request.id === "device-login" && request.result?.action === "decline") {
      send({
        jsonrpc: "2.0",
        id: pending,
        error: { code: -32000, message: "Authentication required" },
      });
      pending = undefined;
    }
  });
  process.on("SIGTERM", () => {
    clearInterval(timer);
    process.exit(0);
  });
} else if (provider === "opencode" && args[0] === "serve") {
  const requests = [];
  const server = createServer(async (request, response) => {
    if (
      request.headers.authorization !==
      `Basic ${Buffer.from(`code60:${process.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`
    ) {
      response.writeHead(401).end();
      return;
    }
    const body = [];
    for await (const bytes of request) body.push(bytes);
    const value = body.length ? JSON.parse(Buffer.concat(body).toString()) : undefined;
    requests.push(request.url);
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/provider/auth")
      response.end(
        JSON.stringify({
          openai: [{ type: "oauth", label: "ChatGPT Pro/Plus (headless)" }],
          "github-copilot": [{ type: "oauth", label: "Login with GitHub Copilot" }],
        }),
      );
    else if (/^\/provider\/(openai|github-copilot)\/oauth\/authorize$/.test(request.url)) {
      if (value.method !== 0) {
        response.writeHead(400).end();
        return;
      }
      response.end(
        JSON.stringify({
          method: "auto",
          url: request.url.includes("openai")
            ? "https://auth.openai.com/codex/device"
            : "https://github.com/login/device",
          instructions: "Enter code: QA60-1234",
        }),
      );
    } else if (/^\/provider\/(openai|github-copilot)\/oauth\/callback$/.test(request.url)) {
      const timer = setInterval(() => {
        if (approved()) {
          clearInterval(timer);
          save();
          response.end("true");
        }
      }, 25);
      response.on("close", () => clearInterval(timer));
    } else response.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1", () =>
    process.stdout.write(
      `opencode server listening on http://127.0.0.1:${server.address().port}\n`,
    ),
  );
} else {
  const child = spawn(
    process.execPath,
    [join(repo, "test/fixtures/fake-agent.mjs"), "--relay", "--session-info", "--process-log", log],
    { stdio: "inherit", env: { ...process.env, FAKE_AGENT_AUTH: existsSync(auth) ? "0" : "1" } },
  );
  child.on("error", () => process.exit(94));
  child.on("exit", (code) => process.exit(code ?? 1));
}
