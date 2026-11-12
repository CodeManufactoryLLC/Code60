import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { defaultDeps, loadConfig } from "../dist/core/index.js";
import { DesktopController } from "../dist/desktop/controller.js";
import { filePreferences } from "../dist/desktop/preferences.js";
import { openProjectDatabase } from "../dist/desktop/projects.js";

// Opt-in, billed live-provider evaluation. Never run from the routine test suite.
const exec = promisify(execFile);
const repository = fileURLToPath(new URL("../", import.meta.url));
const source = filePreferences(
  join(process.env.XDG_STATE_HOME ?? join(process.env.HOME, ".local/state"), "code60/desktop.json"),
);
const verified = await source.agentSetup();
const provider = await source.orchestrationProvider();
const deps = defaultDeps();
const config = await loadConfig(deps.fs, process.env);
if (!verified || !provider || !config.agents[provider])
  throw new Error("Complete provider setup before running live evaluation");
const output = join(
  repository,
  "test-results",
  "tactics-evaluation",
  new Date().toISOString().replaceAll(":", "-"),
);
await mkdir(output, { recursive: true, mode: 0o700 });
const root = await realpath(await mkdtemp(join(tmpdir(), "code60-tactics-eval-")));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const good = `export function withdraw(balance, amount) {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("invalid amount");
  if (amount > balance) throw new Error("insufficient funds");
  return balance - amount;
}
`;
const fixtures = {
  "package.json": JSON.stringify({ type: "module", scripts: { test: "node --test" } }),
  "src/ledger.js": good,
  "src/storage.js":
    "const balances = new Map();\nexport const load = (id) => balances.get(id) ?? 10;\nexport const save = (id, value) => balances.set(id, value);\n",
  "src/handler.js":
    'import { withdraw } from "./ledger.js";\nimport { load, save } from "./storage.js";\nexport function handle(id, amount) { const next = withdraw(load(id), amount); save(id, next); return next; }\n',
  "test/ledger.test.js":
    'import {test} from "node:test";\nimport assert from "node:assert/strict";\nimport {withdraw} from "../src/ledger.js";\ntest("partial withdrawal", () => assert.equal(withdraw(10, 3), 7));\ntest("invalid amounts", () => {assert.throws(() => withdraw(10, -1)); assert.throws(() => withdraw(10, 11));});\n',
  "README.md":
    "# Ledger fixture\nThe handler loads a balance, withdraws an amount, saves the result and returns it. Withdrawing an entire balance is valid. Negative amounts and overdrafts are invalid. Use npm test. No external packages or network calls are required.\n",
};
const tasks = [
  {
    id: "independent-review",
    prompt:
      "Review the pending src/ledger.js change in the open project's checkout for actionable correctness bugs. Cite the affected file/lines and concrete triggering input. Review only; do not repair code. Return the findings and any incomplete evidence.",
  },
  {
    id: "diagnose-a-bug",
    prompt:
      "A user reports withdrawing 10 from a balance of 10 unexpectedly throws insufficient funds. Reproduce the failure, make a minimal fix in an isolated worker worktree, add a regression test and report actual fail/pass evidence. Do not apply, commit or merge the worker changes.",
  },
  {
    id: "explore-the-codebase",
    prompt:
      "Map the withdrawal request from handler through business logic and persistence to the relevant tests. Give concrete file/function references and say which tests cover it. Do not change files. Stop once the map is supported.",
  },
];
const reports = [];
async function until(fn, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() >= deadline) throw new Error("Evaluation deadline exceeded");
    await delay(100);
  }
}
async function run(task, tactic) {
  const label = `${task.id}-${tactic ? "tactic" : "ordinary"}`;
  const directory = join(root, label);
  const project = join(directory, "project");
  await mkdir(join(project, "src"), { recursive: true });
  await mkdir(join(project, "test"));
  for (const [name, content] of Object.entries(fixtures))
    await writeFile(join(project, name), content);
  await exec("git", ["init", "-q", project]);
  await exec("git", ["-C", project, "add", "."]);
  await exec("git", [
    "-C",
    project,
    "commit",
    "-qm",
    "Create isolated evaluation fixture\n\nCo-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>",
  ]);
  await writeFile(
    join(project, "src/ledger.js"),
    good.replace("amount > balance", "amount >= balance"),
  );
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: join(directory, "config"),
    XDG_STATE_HOME: join(directory, "state"),
  };
  await mkdir(join(env.XDG_CONFIG_HOME, "code60"), { recursive: true, mode: 0o700 });
  await writeFile(
    join(env.XDG_CONFIG_HOME, "code60/config.json"),
    JSON.stringify({
      defaultAgent: provider,
      maxParallel: 4,
      turnTimeout: "3m",
      agents: { [provider]: config.agents[provider] },
    }),
    { mode: 0o600 },
  );
  let database;
  const controller = new DesktopController(
    defaultDeps(),
    env,
    { confirm: async () => true },
    {
      openDatabase: openProjectDatabase,
      preferences: {
        agentSetup: async () => verified,
        orchestrationProvider: async () => provider,
        read: async () => database,
        write: async (value) => {
          database = value;
        },
      },
    },
  );
  let began;
  let timedOut = false;
  try {
    await controller.restore();
    await controller.connect(join(directory, "evaluation.sqlite"), true);
    await controller.open(project);
    await until(() => controller.snapshot().chat.run?.status === "idle");
    const id = controller.snapshot().chat.run.id;
    if (tactic)
      await controller.orchestrationChatAction({
        type: "set-tactic",
        id,
        project,
        tactic: task.id,
      });
    began = Date.now();
    await controller.orchestrationChatAction({ type: "send", id, text: task.prompt });
    let stable;
    await until(() => {
      const state = controller.snapshot();
      const quiet =
        state.chat.run?.status === "idle" &&
        !state.chat.updates.pending &&
        !state.runs.some(
          ({ view }) => view && ["queued", "running", "waiting"].includes(view.status),
        );
      if (!quiet) stable = undefined;
      else stable ??= Date.now();
      return stable && Date.now() - stable >= 1500;
    }, 180_000).catch(() => {
      timedOut = true;
    });
    const elapsedMs = Date.now() - began;
    const state = controller.snapshot();
    const messages = state.chat.events
      .filter(({ event }) => event.type === "message")
      .map(({ event }) => event.text)
      .join("");
    const workers = [];
    for (const run of state.runs) {
      let regressionPass = false;
      let testsPass = false;
      if (task.id === "diagnose-a-bug") {
        try {
          await exec(
            process.execPath,
            [
              "--input-type=module",
              "-e",
              `import {withdraw} from ${JSON.stringify(new URL(`file://${join(run.record.worktree, "src/ledger.js")}`).href)}; import assert from "node:assert/strict"; assert.equal(withdraw(10,10),0); assert.equal(withdraw(0,0),0); assert.throws(()=>withdraw(10,-1)); assert.throws(()=>withdraw(10,11));`,
            ],
            { timeout: 10_000 },
          );
          regressionPass = true;
        } catch {}
        try {
          await exec(process.execPath, ["--test"], { cwd: run.record.worktree, timeout: 10_000 });
          testsPass = true;
        } catch {}
      }
      workers.push({
        runId: run.record.id,
        worktree: run.record.worktree,
        regressionPass,
        testsPass,
      });
    }
    const report = {
      task: task.id,
      mode: tactic ? "tactic" : "ordinary",
      provider,
      elapsedMs,
      timedOut,
      humanCorrections: 0,
      workerCount: state.runs.length,
      workers,
      usageTotals: null,
      usageNote: "ACP context occupancy is not total token/cost usage.",
      messages,
      projectUnchanged:
        (await readFile(join(project, "src/ledger.js"), "utf8")) ===
        good.replace("amount > balance", "amount >= balance"),
    };
    await writeFile(join(output, `${label}.json`), JSON.stringify(report, null, 2), {
      mode: 0o600,
    });
    await writeFile(join(output, `${label}-events.json`), JSON.stringify(state.chat.events), {
      mode: 0o600,
    });
    reports.push(report);
    console.log(
      JSON.stringify({
        task: task.id,
        mode: report.mode,
        elapsedMs: report.elapsedMs,
        timedOut,
        workers: report.workerCount,
      }),
    );
  } finally {
    await controller.shutdown(true);
  }
}
try {
  for (const task of tasks) for (const tactic of [false, true]) await run(task, tactic);
} finally {
  await writeFile(join(output, "summary.json"), JSON.stringify({ root, reports }, null, 2), {
    mode: 0o600,
  });
  console.log(`Private evaluation artifacts: ${output}`);
  console.log(
    "Isolated fixtures/worktrees retained for verification; no product repository commit or application was performed.",
  );
}
