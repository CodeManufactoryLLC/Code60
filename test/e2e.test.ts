import { execFileSync, spawn } from "node:child_process";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpGateway } from "../src/desktop/mcp-gateway.js";
import { readMcpTool } from "../src/desktop/mcp-tables.js";
import { nativeIdentity } from "../src/platform/index.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Inside node_modules so the compiled CLI resolves the project's dependencies.
const OUT = join(ROOT, "node_modules", ".cache", "code60-e2e", "dist");
const MAIN = join(OUT, "cli", "main.js");
const FAKE_AGENT = join(ROOT, "test", "fixtures", "fake-agent.mjs");

let dir: string;
let repo: string;
let env: NodeJS.ProcessEnv;

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}

function cli(
  args: string[],
  options: {
    input?: string;
    cwd?: string;
    onStderr?: (text: string, kill: (s: NodeJS.Signals) => void) => void;
  } = {},
): Promise<Result> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [MAIN, ...args], {
      cwd: options.cwd ?? repo,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      options.onStderr?.(stderr, (s) => child.kill(s));
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
    child.stdin.end(options.input ?? "");
  });
}

const steps = (...s: unknown[]) => JSON.stringify(s);

beforeAll(async () => {
  execFileSync(process.execPath, [
    join(ROOT, "node_modules", "typescript", "bin", "tsc"),
    "-p",
    join(ROOT, "tsconfig.build.json"),
    "--outDir",
    OUT,
    "--sourceMap",
    "false",
  ]);
  // Mirror the installed layout, including the single source of the product version.
  await copyFile(join(ROOT, "package.json"), join(OUT, "..", "package.json"));
  if (process.platform === "win32")
    await cp(join(ROOT, "native", "win32"), join(OUT, "..", "native", "win32"), {
      recursive: true,
    });
  dir = await realpath(await mkdtemp(join(tmpdir(), "code60-e2e-")));
  repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  const git = (...a: string[]) => execFileSync("git", a, { cwd: repo });
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");
  await writeFile(join(repo, "README.md"), "hi\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  await mkdir(join(dir, "config", "code60"), { recursive: true });
  await writeFile(
    join(dir, "config", "code60", "config.json"),
    JSON.stringify({
      defaultAgent: "fake",
      agents: { fake: { command: [process.execPath, FAKE_AGENT] } },
    }),
  );
  env = {
    ...process.env,
    XDG_CONFIG_HOME: join(dir, "config"),
    XDG_STATE_HOME: join(dir, "state"),
  };
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

it("serves the Code60 MCP stdio protocol from a separate process", async () => {
  const gateway = await createMcpGateway((name, args) =>
    readMcpTool(name, args, async () => [{ id: "one", text: "Hello Code60" }]),
  );
  const child = spawn(process.execPath, [join(OUT, "desktop", "mcp-server.js")], {
    env: {
      ...process.env,
      CODE60_MCP_GATEWAY_URL: gateway.url,
      CODE60_MCP_GATEWAY_TOKEN: gateway.token,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    const result = await new Promise<Result>((resolveResult, reject) => {
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => resolveResult({ code, stdout, stderr }));
      const requests = [
        { id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
        { method: "notifications/initialized" },
        { id: 2, method: "tools/list" },
        {
          id: 3,
          method: "tools/call",
          params: {
            name: "code60_search_messages",
            arguments: { query: "hello" },
          },
        },
        { id: 4, method: "tools/call", params: { name: "code60_write_messages", arguments: {} } },
      ];
      child.stdin.end(
        `${requests.map((request) => JSON.stringify({ jsonrpc: "2.0", ...request })).join("\n")}\n`,
      );
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const responses = new Map(
      result.stdout
        .trim()
        .split("\n")
        .map((line) => {
          const response = JSON.parse(line);
          return [response.id, response.result] as const;
        }),
    );
    expect(responses.get(1)).toMatchObject({
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
    });
    type Listed = {
      name: string;
      annotations: { readOnlyHint: boolean; destructiveHint: boolean };
    };
    const listed: Listed[] = responses.get(2).tools;
    expect(listed).toHaveLength(25);
    const hint = (name: string) => listed.find((tool) => tool.name === name)?.annotations;
    expect(hint("code60_search_messages")).toMatchObject({ readOnlyHint: true });
    expect(hint("code60_read_events")).toMatchObject({ readOnlyHint: true });
    expect(hint("code60_search_events")).toMatchObject({ readOnlyHint: true });
    expect(hint("code60_list_agents")).toMatchObject({ readOnlyHint: true });
    expect(hint("code60_get_activity_context")).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(hint("code60_report_activity")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(hint("code60_read_review")).toMatchObject({ readOnlyHint: true });
    expect(hint("code60_address_feedback")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(hint("code60_dispatch_agent")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(hint("code60_stop_agent")).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(JSON.parse(responses.get(3).content[0].text)).toMatchObject({
      table: "messages",
      total: 1,
      rows: [{ id: "one", text: "Hello Code60" }],
    });
    expect(responses.get(4).isError).toBe(true);
  } finally {
    child.kill();
    await gateway.close();
  }
}, 20_000);

describe("code60 (spawned)", () => {
  it.runIf(process.platform === "win32")(
    "owner crash kills the agent tree, retains its worktree and permits explicit leftover inspection",
    async () => {
      const sentinel = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        stdio: "ignore",
      });
      const pidFile = join(dir, "crash-descendant.pid");
      const prompt = steps({ grandchild: pidFile }, { hang: "stubborn" });
      let kill: ((signal: NodeJS.Signals) => void) | undefined;
      const finished = cli(["run", "--json", prompt], {
        onStderr: (_, stop) => {
          kill = stop;
        },
      });
      try {
        await expect
          .poll(() => readFile(pidFile, "utf8").catch(() => ""), { timeout: 10_000 })
          .not.toBe("");
        const descendant = Number(await readFile(pidFile, "utf8"));
        const records = join(repo, ".git", "code60", "runs");
        const saved = await Promise.all(
          (await readdir(records)).map(async (id) =>
            JSON.parse(await readFile(join(records, id, "run.json"), "utf8")),
          ),
        );
        const record = saved.find((record) => record.firstPrompt === prompt);
        expect(record.ownerIdentity).toBeDefined();
        expect(record.agentIdentity.job).toBeTruthy();
        kill?.("SIGKILL");
        await finished;
        await expect
          .poll(() => alive(record.agentPid) || alive(descendant), { timeout: 7_000 })
          .toBe(false);
        expect(alive(sentinel.pid as number)).toBe(true);
        expect((await stat(record.worktree)).isDirectory()).toBe(true);
        const list = await cli(["list", "--json"]);
        expect(
          JSON.parse(list.stdout).runs.find((run: { id: string }) => run.id === record.id).status,
        ).toBe("interrupted");
      } finally {
        kill?.("SIGKILL");
        await finished;
        sentinel.kill("SIGKILL");
      }
    },
    30_000,
  );

  it("runs headless, then lists, diffs, and discards the run", async () => {
    const prompt = steps({ write: { path: "hello.txt", content: "hi\n" } });
    const result = await cli(["run", "--json", prompt]);
    expect(result.code).toBe(0);
    const { runs } = JSON.parse(result.stdout);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ agent: "fake", status: "finished", changedFiles: 1 });
    expect(runs[0].worktree).toBe(join(dir, "repo.worktrees", runs[0].id));
    expect(result.stderr).toMatch(/finished/);
    expect(result.stderr).not.toContain("hello.txt");
    const id = runs[0].id as string;

    const record = JSON.parse(
      await readFile(join(repo, ".git", "code60", "runs", id, "run.json"), "utf8"),
    );
    expect(record).toMatchObject({
      status: "finished",
      firstPrompt: prompt,
      turns: 1,
      lastStopReason: "end_turn",
    });
    if (process.platform === "win32") {
      // A busy Windows host can reuse the PID after verified job cleanup.
      expect(record.agentIdentity?.createdAt).toEqual(expect.any(String));
      expect((await nativeIdentity(record.agentPid))?.createdAt).not.toBe(
        record.agentIdentity.createdAt,
      );
    } else {
      expect(alive(record.agentPid)).toBe(false);
    }

    const list = await cli(["list", "--json"]);
    expect(JSON.parse(list.stdout).runs.find((run: { id: string }) => run.id === id)).toMatchObject(
      { id, status: "finished" },
    );

    const diff = await cli(["diff", id]);
    expect(diff.code).toBe(0);
    expect(diff.stdout).toMatch(/^\+\+\+ b\/hello.txt$/m);

    const refused = await cli(["discard", id]);
    expect(refused.code).toBe(2);
    expect(refused.stderr).toMatch(/untracked +hello.txt/);

    const discard = await cli(["discard", "--yes", id]);
    expect(discard.code).toBe(0);
    expect(
      execFileSync("git", ["branch", "--list", `code60/${id}`], { cwd: repo, encoding: "utf8" }),
    ).toBe("");
  }, 60_000);

  it("runs outside a Git repository directly in the directory", async () => {
    const plain = join(dir, "plain");
    await mkdir(plain);
    const result = await cli(
      ["run", "--json", steps({ write: { path: "hi.txt", content: "hi" } })],
      {
        cwd: plain,
      },
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).runs[0]).toMatchObject({
      status: "finished",
      branch: null,
      worktree: plain,
    });
    expect(result.stderr).toMatch(/not in a Git repository/);
    expect(await readFile(join(plain, "hi.txt"), "utf8")).toBe("hi");
    const list = await cli(["list", "--json"], { cwd: plain });
    expect(JSON.parse(list.stdout).runs).toHaveLength(1);
  }, 60_000);

  it("reads the prompt from standard input", async () => {
    const result = await cli(["run", "--json"], { input: steps({ message: "hi" }) });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).runs[0].status).toBe("finished");
  }, 60_000);

  it.skipIf(process.platform === "win32")(
    "exits 130 on SIGTERM, stops the agent, and writes a partial result",
    async () => {
      let sent = false;
      const result = await cli(["run", "--json", steps({ hang: "cancellable" })], {
        onStderr: (text, kill) => {
          if (!sent && /running/.test(text)) {
            sent = true;
            setTimeout(() => kill("SIGTERM"), 200);
          }
        },
      });
      expect(result.code).toBe(130);
      const { runs } = JSON.parse(result.stdout);
      expect(runs[0].status).toBe("cancelled");
      const record = JSON.parse(
        await readFile(join(repo, ".git", "code60", "runs", runs[0].id, "run.json"), "utf8"),
      );
      expect(alive(record.agentPid)).toBe(false);
    },
    60_000,
  );

  it("fails a run whose agent requires authentication", async () => {
    env.FAKE_AGENT_AUTH = "1";
    try {
      const result = await cli(["run", "--json", "hi"]);
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stdout).runs[0]).toMatchObject({
        status: "failed",
        reason: expect.stringContaining("log in through fake's own CLI"),
      });
    } finally {
      delete env.FAKE_AGENT_AUTH;
    }
  }, 60_000);
});
