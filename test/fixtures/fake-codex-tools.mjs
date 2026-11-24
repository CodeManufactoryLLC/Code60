#!/usr/bin/env node
// External npm, Codex authentication and ACP boundaries for isolated browser QA only.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, copyFile, mkdir, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";

const home = process.env.HOME;
const log = process.env.CODE60_QA_PROCESS_LOG;
const kind = basename(process.argv[1]);
if (!home || !log || !process.env.CODE60_QA_REPO) process.exit(90);
writeFileSync(
  join(log, `${process.pid}-${randomUUID()}.json`),
  JSON.stringify({ pid: process.pid, kind, cwd: process.cwd() }),
);
const auth = join(home, ".codex/auth.json");
if (kind === "npm") {
  const args = process.argv.slice(2);
  const prefix = args[args.indexOf("--prefix") + 1];
  if (
    args.join(" ") !==
    `install --global --prefix ${prefix} --ignore-scripts --no-audit --no-fund --registry https://registry.npmjs.org @openai/codex@0.171.0`
  )
    process.exit(91);
  if (existsSync(join(home, "fail-install"))) process.exit(92);
  const pkg = join(prefix, "lib/node_modules/@openai/codex");
  await mkdir(pkg, { recursive: true });
  await mkdir(join(prefix, "bin"));
  await writeFile(
    join(pkg, "package.json"),
    JSON.stringify({ name: "@openai/codex", version: "0.171.0", type: "module" }),
  );
  await copyFile(process.argv[1], join(pkg, "cli.mjs"));
  await chmod(join(pkg, "cli.mjs"), 0o700);
  await symlink("../lib/node_modules/@openai/codex/cli.mjs", join(prefix, "bin/codex"));
} else if (kind === "npx") {
  if (!process.env.CODEX_PATH || !existsSync(process.env.CODEX_PATH)) process.exit(98);
  if (process.argv.slice(2).join(" ") !== "-y @agentclientprotocol/codex-acp") process.exit(93);
  const child = spawn(
    process.execPath,
    [
      join(process.env.CODE60_QA_REPO, "test/fixtures/fake-agent.mjs"),
      "--relay",
      "--session-info",
      "--process-log",
      log,
    ],
    {
      stdio: "inherit",
      env: { ...process.env, FAKE_AGENT_AUTH: existsSync(auth) ? "0" : "1" },
    },
  );
  child.on("error", () => process.exit(94));
  child.on("exit", (code) => process.exit(code ?? 1));
} else if (process.argv[2] === "app-server") {
  const loginId = "00000000-0000-4000-8000-000000000001";
  let timer;
  const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    const { id, method, params } = JSON.parse(line);
    if (method === "initialize") send({ id, result: { userAgent: "isolated-fixture" } });
    else if (method === "account/login/start") {
      if (params.type !== "chatgptDeviceCode") process.exit(95);
      if (existsSync(join(home, "disabled-login"))) {
        send({ id, error: { code: -32000, message: "PRIVATE_PROVIDER_ERROR" } });
        return;
      }
      send({
        id,
        result: {
          type: "chatgptDeviceCode",
          loginId,
          verificationUrl: "https://auth.openai.com/codex/device",
          userCode: "QA60-1234",
        },
      });
      timer = setInterval(() => {
        if (!existsSync(join(home, "authorize"))) return;
        clearInterval(timer);
        mkdirSync(join(home, ".codex"), { recursive: true, mode: 0o700 });
        writeFileSync(auth, '{"synthetic":true}\n', { mode: 0o600 });
        send({ method: "account/login/completed", params: { loginId, success: true } });
      }, 25);
    } else if (method === "account/login/cancel") {
      if (params.loginId !== loginId) process.exit(96);
      clearInterval(timer);
      send({ id, result: { status: "canceled" } });
    }
  });
  lines.on("close", () => {
    clearInterval(timer);
    process.exit(0);
  });
} else if (process.argv[2] === "--version") {
  process.stdout.write("codex-cli 0.171.0\n");
} else {
  // No model requests or arbitrary commands are permitted by this fixture.
  readFileSync(auth);
  process.exit(97);
}
