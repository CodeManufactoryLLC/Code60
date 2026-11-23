import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type ElectronApplication, expect, test } from "@playwright/test";
import { launchDesktop, removeDesktopFixture } from "./electron-launcher.js";
import { commitFixture } from "./fixtures/git-repository.js";

const root = resolve(import.meta.dirname, "..");
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
// Only replace the external runtime's platform/bootstrap boundary. Requests still
// traverse the production renderer/preload/bridge/registry/Git/HTTP implementation.
async function attachTransmissionBoundary(application: ElectronApplication) {
  await application.evaluate(
    async (_electron, path) => {
      const { createRequire } = process.getBuiltinModule(
        "node:module",
      ) as typeof import("node:module");
      const { workflows } = createRequire(path)(path);
      for (const client of [workflows.client, workflows.legacyClient]) {
        Object.defineProperty(client, "supported", { value: true });
        client.connect = async (signal: AbortSignal) => {
          await client.call("health", {}, signal);
        };
      }
    },
    join(root, "dist/application/main.js"),
  );
}

test("workflow: Transmission prompt creation, isolated execution, status, cancellation and background reconnect", async () => {
  test.setTimeout(180_000);
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-transmission-ui-")));
  const repo = join(directory, "project");
  const engineRoot = join(directory, "state/code60/workflows/transmission-0.1.0-staging.20");
  const config = join(directory, "config/code60");
  await mkdir(repo);
  await mkdir(config, { recursive: true });
  await mkdir(engineRoot, { recursive: true, mode: 0o700 });
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  await writeFile(join(repo, "source.txt"), "committed\n");
  git("add", ".");
  commitFixture(repo);
  await writeFile(join(repo, "source.txt"), "staged\n");
  git("add", ".");
  await writeFile(join(repo, "source.txt"), "saved unstaged\n");
  await writeFile(join(repo, "untracked.txt"), "untracked saved\n");
  await writeFile(join(repo, "README.md"), "Duration parser fixture");
  const index = await readFile(join(repo, ".git/index"));
  const head = git("rev-parse", "HEAD");
  await writeFile(
    join(config, "config.json"),
    JSON.stringify({
      agents: {
        claude: { command: [process.execPath, join(root, "test/fixtures/fake-agent.mjs")] },
      },
    }),
  );
  const engine = spawn(
    process.execPath,
    [join(root, "test/fixtures/fake-transmission.mjs"), engineRoot],
    { stdio: "ignore" },
  );
  const engineExit = new Promise<void>((done) => engine.once("exit", () => done()));
  let application: ElectronApplication | undefined;
  let workerPid: number | undefined;
  try {
    await expect
      .poll(() => readFile(join(engineRoot, "fixture-ready"), "utf8").catch(() => ""))
      .not.toBe("");
    application = await launchDesktop(directory, repo, join(directory, "projects.sqlite"));
    let page = await application.firstWindow();
    const openWorkflows = async () => {
      await page.locator("#tab-apps").press("ArrowRight");
      await page.locator("#tab-workflows").click();
    };
    const menu = async (label: string) => {
      await page.getByRole("button", { name: "Workflows actions" }).click();
      return page.getByRole("menuitem", { name: label, exact: true });
    };
    const headerAction = async (label: string) => (await menu(label)).click();
    const wizard = page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Claude", exact: true }).click();
    await expect(wizard.getByRole("status")).toHaveText("Claude connected");
    await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await openWorkflows();
    const workflows = page.locator(".workflows-page");
    await expect(page.getByRole("heading", { name: "Workflows", exact: true })).toBeVisible();
    if (process.platform === "linux") {
      await expect(workflows.getByText(/Transmission execution requires macOS/)).toBeVisible();
      await expect(await menu("New workflow")).toBeDisabled();
      await page.keyboard.press("Escape");
    }
    await attachTransmissionBoundary(application);
    await headerAction("Refresh");
    await headerAction("New workflow");
    const form = workflows.getByRole("region", { name: "New workflow", exact: true });
    await form.getByRole("button", { name: "Choose repository", exact: true }).click();
    await form.getByRole("button", { name: "Create with prompt", exact: true }).click();
    const chat = page.getByRole("dialog", { name: "Create with prompt", exact: true });
    await chat.getByRole("textbox", { name: "Describe the workflow" }).fill("ask a question");
    await chat.getByRole("button", { name: "Send", exact: true }).click();
    await expect(chat.getByRole("log")).toContainText("Which parser should be repaired?");
    await chat
      .getByRole("textbox", { name: "Describe the workflow", exact: true })
      .fill("Fix fractional duration parsing and update documentation");
    await chat.getByRole("button", { name: "Send", exact: true }).click();
    await expect(chat.getByRole("log")).toContainText("Prepared workflow draft");
    await chat
      .getByRole("textbox", { name: "Describe the workflow", exact: true })
      .fill("refine the workflow with negative values");
    await chat.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      chat.getByRole("log").getByText("Prepared workflow draft", { exact: true }),
    ).toHaveCount(2);
    await chat.getByRole("button", { name: "Close chat", exact: true }).click();
    await expect(form.getByLabel("Workflow name", { exact: true })).toHaveValue(
      "Refined parser workflow",
    );
    await expect(form.getByLabel("Task name", { exact: true })).toHaveCount(2);
    await form.getByLabel("Workflow name", { exact: true }).fill("Reviewed duration workflow");
    await form.getByRole("button", { name: "Create with prompt", exact: true }).click();
    await chat
      .getByRole("textbox", { name: "Describe the workflow", exact: true })
      .fill("invalid draft");
    await chat.getByRole("button", { name: "Send", exact: true }).click();
    await expect(chat.getByRole("alert")).toBeVisible();
    await chat.getByRole("button", { name: "Close chat", exact: true }).click();
    await expect(form.getByLabel("Workflow name", { exact: true })).toHaveValue(
      "Reviewed duration workflow",
    );
    await form.getByRole("button", { name: "Create with prompt", exact: true }).click();
    await chat
      .getByRole("textbox", { name: "Describe the workflow", exact: true })
      .fill("wait for cancellation");
    await chat.getByRole("button", { name: "Send", exact: true }).click();
    await chat.getByRole("button", { name: "Cancel generation", exact: true }).click();
    await chat.getByRole("button", { name: "Close chat", exact: true }).click();
    expect(git("worktree", "list", "--porcelain")).not.toContain(
      "branch refs/heads/code60/transmission-",
    );
    expect(await readdir(engineRoot)).not.toContain("fixture-runs.json");
    await form.getByRole("button", { name: "Review workflow", exact: true }).click();
    await expect(
      form.getByText("Dedicated worktree; continues after Code60 quits", { exact: true }),
    ).toBeVisible();
    expect(git("worktree", "list", "--porcelain")).not.toContain(
      "branch refs/heads/code60/transmission-",
    );
    await form.getByRole("button", { name: "Start workflow", exact: true }).click();
    await expect(workflows.getByText("1 of 2 tasks accepted", { exact: true })).toHaveCount(0);
    await expect(workflows.getByText("Implementing", { exact: true })).toBeVisible();
    const runs = async () =>
      JSON.parse(await readFile(join(engineRoot, "fixture-runs.json"), "utf8"));
    const run = (await runs())[0];
    const stream = workflows.getByRole("log");
    await expect(stream.getByText("2 tool updates")).toBeVisible();
    await expect(stream.getByText("Read fixture file: completed")).toHaveCount(0);
    await workflows.getByRole("button", { name: "Expand tool calls" }).press("Enter");
    await expect(stream.getByText("Read fixture file: completed")).toBeVisible();
    await workflows.getByRole("button", { name: "Collapse tool calls" }).click();
    await expect(stream.getByText("Read fixture file: completed")).toHaveCount(0);
    await expect(stream.getByText("Started", { exact: true })).toBeVisible();
    const firstTask = workflows.locator(".workflow-task-list details").first();
    await expect(firstTask).not.toHaveAttribute("open", "");
    await firstTask.locator("summary").click();
    const configButton = firstTask.getByRole("button", { name: "View Configuration" });
    await configButton.click();
    await expect(page.getByRole("dialog", { name: "Task 1 configuration" })).toContainText(
      "Verification Criteria",
    );
    await page.keyboard.press("Escape");
    await expect(configButton).toBeFocused();
    await firstTask.locator("summary").click();
    await workflows.getByRole("button", { name: "Pause workflow" }).click();
    await expect(firstTask.locator("summary")).toContainText("Paused");
    const timer = workflows.getByRole("timer");
    await expect(timer).toHaveText(/^\d+:\d{2}$/);
    const pauseTime = (await timer.textContent()) ?? "";
    expect(alive(run.workerPid)).toBe(false);
    await page.reload();
    await openWorkflows();
    await workflows.getByRole("button", { name: /Reviewed duration workflow/ }).click();
    await expect(timer).toHaveText(pauseTime);
    await workflows.getByRole("button", { name: "Resume workflow" }).click();
    await expect(firstTask.locator("summary")).toContainText("Implementing");
    expect((await runs())[0].id).toBe(run.id);
    workerPid = (await runs())[0].workerPid;
    expect(workerPid && alive(workerPid)).toBeTruthy();
    expect(await readFile(join(run.plan.repository, "source.txt"), "utf8")).toBe(
      "saved unstaged\n",
    );
    expect(await readFile(join(run.plan.repository, "untracked.txt"), "utf8")).toBe(
      "untracked saved\n",
    );
    expect(await readFile(join(run.plan.repository, "workflow-result.txt"), "utf8")).toContain(
      "isolated",
    );
    await expect(readFile(join(repo, "workflow-result.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    for (const phase of ["verifying", "repairing", "needs_input"]) {
      await writeFile(join(engineRoot, "control"), phase);
      await headerAction("Refresh");
      await expect(
        workflows
          .locator(".workflow-task-list")
          .getByText(
            phase === "needs_input"
              ? "Needs input"
              : phase.charAt(0).toUpperCase() + phase.slice(1),
            { exact: true },
          ),
      ).toBeVisible();
    }
    await firstTask.locator("summary").click();
    await firstTask.getByRole("button", { name: "View Results" }).click();
    const rejected = page.getByRole("dialog", { name: "Task 1 results" });
    await expect(rejected).toContainText("Rejected");
    await expect(rejected).toContainText("Add the missing negative case");
    await rejected.getByRole("button", { name: "Close" }).click();
    await firstTask.locator("summary").click();
    await workflows
      .getByLabel("Preserve negative zero?", { exact: true })
      .selectOption("normalize");
    await workflows.getByRole("button", { name: "Send answer", exact: true }).click();
    await expect(
      workflows.locator(".workflow-task-list").getByText("Repairing", { exact: true }),
    ).toBeVisible();
    await workflows.getByRole("button", { name: "Steer", exact: true }).click();
    await workflows
      .getByLabel("Guidance for a subsequent turn", { exact: true })
      .fill("Keep the public API stable");
    await workflows.getByRole("button", { name: "Queue guidance", exact: true }).click();
    await workflows.getByRole("button", { name: "Steer", exact: true }).click();
    await workflows
      .getByLabel("Guidance for a subsequent turn", { exact: true })
      .fill("reject guidance");
    await workflows.getByRole("button", { name: "Queue guidance", exact: true }).click();
    await expect(workflows.getByRole("alert")).toContainText("Transmission rejected");
    await page.keyboard.press("Escape");
    await writeFile(join(engineRoot, "control"), "verifying");
    await expect(
      workflows.locator(".workflow-task-list").getByText("Verifying", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(workflows.getByRole("alert")).toContainText("Transmission rejected");
    await headerAction("Refresh");
    await writeFile(join(engineRoot, "control"), "repairing");
    await headerAction("Refresh");
    await page.locator("#tab-home").click();
    await openWorkflows();
    await expect(
      workflows.locator(".workflow-task-list").getByText("Repairing", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await openWorkflows();
    await workflows
      .getByRole("navigation", { name: "Workflow history" })
      .getByRole("button", { name: /Reviewed duration workflow/ })
      .click();
    await expect(
      workflows.locator(".workflow-task-list").getByText("Repairing", { exact: true }),
    ).toBeVisible();
    expect(await runs()).toHaveLength(1);
    await expect(workflows.getByRole("log")).toContainText("Keep the public API stable");
    await expect(
      workflows.locator("pre").filter({ hasText: "Keep the public API stable" }),
    ).toBeVisible();
    await writeFile(join(engineRoot, "control"), "disconnect");
    await headerAction("Refresh");
    await expect(workflows.getByText(/Status unavailable/)).toBeVisible();
    await expect(
      workflows.locator(".workflow-task-list").getByText("Repairing", { exact: true }),
    ).toBeVisible();
    await headerAction("Reconnect engine…");
    const reconnectDialog = page.getByRole("dialog", { name: "Reconnect engine" });
    await expect(reconnectDialog).toContainText("unfinished approved workflows");
    await writeFile(join(engineRoot, "control"), "repairing");
    await reconnectDialog.getByRole("button", { name: "Reconnect engine" }).click();
    await writeFile(join(engineRoot, "control"), "repairing");
    await headerAction("Refresh");
    await writeFile(join(engineRoot, "control"), "repairing");
    await headerAction("Refresh");
    await page.locator("#tab-home").click();
    await openWorkflows();
    await expect(
      workflows.getByRole("heading", { name: "“Reviewed duration workflow”", exact: true }),
    ).toBeVisible();
    await page.reload();
    await openWorkflows();
    await workflows
      .getByRole("navigation", { name: "Workflow history" })
      .getByRole("button", { name: /Reviewed duration workflow/ })
      .click();
    await expect(
      workflows.locator(".workflow-task-list").getByText("Repairing", { exact: true }),
    ).toBeVisible();
    expect(await runs()).toHaveLength(1);
    await writeFile(join(engineRoot, "control"), "next_task");
    await headerAction("Refresh");
    await expect(
      workflows.getByRole("img", { name: "50% complete, 1 of 2 tasks accepted" }),
    ).toBeVisible();
    await workflows.getByText("Accepted diff", { exact: true }).click();
    await workflows.getByRole("button", { name: "Load accepted diff" }).click();
    await expect(workflows.locator("pre").filter({ hasText: "workflow-result.txt" })).toBeVisible();
    const theme = page.getByRole("button", { name: /^Color theme:/ });
    for (const width of [1400, 640]) {
      await application.evaluate(({ BrowserWindow }, w) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.setMinimumSize(600, 600);
        win?.setSize(w, w === 1400 ? 1100 : 900);
      }, width);
      for (const mode of ["Dark", "Light"]) {
        for (
          let i = 0;
          i < 3 && !(await theme.getAttribute("aria-label"))?.includes(`Color theme: ${mode}.`);
          i++
        )
          await theme.click();
        await expect(theme).toHaveAccessibleName(new RegExp(`Color theme: ${mode}`));
        const player = await workflows.locator(".workflow-player").boundingBox();
        expect(player?.width).toBeLessThanOrEqual(736);
        const controls = await workflows.locator(".workflow-player-left").boundingBox();
        const activity = await workflows.locator(".workflow-activity-box").boundingBox();
        expect(controls && activity && Math.abs(controls.height - activity.height) < 2).toBe(true);
        expect(
          controls &&
            activity &&
            (width === 640
              ? activity.y >= controls.y + controls.height
              : Math.abs(controls.y - activity.y) < 2),
        ).toBe(true);
        await workflows.locator(".workflow-player > h2").scrollIntoViewIfNeeded();
        const sequences = await workflows
          .getByRole("log")
          .locator("li")
          .evaluateAll((rows) => rows.map((row) => Number(row.getAttribute("data-sequence"))));
        expect(sequences).toEqual([...new Set(sequences)].sort((a, b) => b - a));
        await page.mouse.move(0, 0);
        await page.screenshot({ path: test.info().outputPath(`workflow-${width}-${mode}.png`) });
      }
    }
    const exited = new Promise<void>((done) => application?.process().once("exit", () => done()));
    await application.evaluate(({ app }) => app.quit());
    await exited;
    application = undefined;
    expect(engine.pid && alive(engine.pid)).toBeTruthy();
    expect(workerPid && alive(workerPid)).toBeTruthy();
    application = await launchDesktop(directory, repo, join(directory, "projects.sqlite"));
    await attachTransmissionBoundary(application);
    page = await application.firstWindow();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await openWorkflows();
    const reopened = page.locator(".workflows-page");
    await headerAction("Refresh");
    await reopened
      .getByRole("navigation", { name: "Workflow history" })
      .getByRole("button", { name: /Reviewed duration workflow/ })
      .click();
    await expect(
      reopened.locator(".workflow-task-list").getByText("Implementing", { exact: true }),
    ).toBeVisible();
    expect(await runs()).toHaveLength(1);
    const stop = reopened.getByRole("button", { name: "Stop workflow", exact: true });
    await stop.click();
    const confirmation = page.getByRole("dialog", { name: "Stop workflow?" });
    await expect(confirmation).toContainText("cannot be resumed");
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(workerPid && alive(workerPid)).toBeTruthy();
    await writeFile(join(engineRoot, "lose-stop-response"), "once");
    await stop.click();
    await confirmation.getByRole("button", { name: "Stop workflow", exact: true }).click();
    await expect(reopened.locator(".workflow-player > [role=status]")).toContainText(
      "Stop acknowledgement pending",
    );
    await stop.click();
    await confirmation.getByRole("button", { name: "Stop workflow", exact: true }).click();
    await expect(reopened.locator(".workflow-player > [role=status]")).toHaveText("Cancelled");
    await expect.poll(() => (workerPid ? alive(workerPid) : true)).toBe(false);
    expect(await readFile(join(repo, "source.txt"), "utf8")).toBe("saved unstaged\n");
    expect(git("rev-parse", "HEAD")).toBe(head);
    // Manual entry and terminal evidence use the same production approval path.
    await headerAction("New workflow");
    const manual = reopened.getByRole("region", { name: "New workflow", exact: true });
    await manual.getByLabel("Workflow name", { exact: true }).fill("Manual workflow");
    await manual.getByRole("button", { name: "Choose repository", exact: true }).click();
    await manual.getByLabel("Task name", { exact: true }).fill("Check behavior");
    await manual
      .getByLabel("Implementation instructions", { exact: true })
      .fill("Inspect the parser behavior");
    await manual.getByLabel("Verification criteria", { exact: true }).fill("Verify the public API");
    await manual.getByRole("button", { name: "Review workflow", exact: true }).click();
    await writeFile(join(engineRoot, "control"), "completed");
    await manual.getByRole("button", { name: "Start workflow", exact: true }).click();
    await expect(
      reopened.getByRole("img", { name: "100% complete, 1 of 1 tasks accepted" }),
    ).toBeVisible();
    await reopened.locator(".workflow-task-list summary").click();
    await reopened.getByRole("button", { name: "View Results" }).click();
    await expect(
      reopened.getByText("Independent fixture checks passed", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(reopened.getByRole("button", { name: "View Results" })).toBeFocused();
    expect(await runs()).toHaveLength(2);
    expect(await readFile(join(repo, ".git/index"))).toEqual(index);
    expect(await readFile(join(run.plan.repository, "workflow-result.txt"), "utf8")).toContain(
      "isolated",
    );
    await writeFile(
      test.info().outputPath("independent-outcomes.json"),
      JSON.stringify(
        {
          sameRunAfterQuit: run.id,
          sourceHeadUnchanged: true,
          sourceIndexUnchanged: true,
          isolatedResultRetained: true,
          workerStoppedAfterCancel: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await application?.close();
    engine.kill("SIGTERM");
    await engineExit;
    if (workerPid) expect(alive(workerPid)).toBe(false);
    await removeDesktopFixture(directory, { recursive: true, force: true });
  }
});

test("workflow: Transmission staging.18 retained history and controls use its original engine", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-legacy-workflow-")));
  const repo = join(directory, "source");
  const registry = join(directory, "state/code60/workflows");
  const version = "0.1.0-staging.18";
  const engineRoot = join(registry, `transmission-${version}`);
  const id = randomUUID(),
    key = randomUUID(),
    branch = `code60/transmission-${id}`;
  const worktree = join(directory, "execution");
  await mkdir(repo);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  await writeFile(join(repo, "baseline.txt"), "legacy baseline");
  git("add", ".");
  commitFixture(repo);
  git("worktree", "add", "-qb", branch, worktree);
  const baseline = git("rev-parse", "HEAD");
  const identity = async (path: string) => {
    const entry = await stat(path, { bigint: true });
    return `${path}:${entry.dev}:${entry.ino}`;
  };
  const config = join(directory, "config/code60");
  await mkdir(config, { recursive: true });
  await writeFile(
    join(config, "config.json"),
    JSON.stringify({
      agents: {
        claude: { command: [process.execPath, join(root, "test/fixtures/fake-agent.mjs")] },
      },
    }),
  );
  await mkdir(engineRoot, { recursive: true, mode: 0o700 });
  const definition = {
    name: "Retained legacy workflow",
    tasks: [
      {
        name: "Legacy task",
        instructions: "Inspect saved files",
        verify: "Read baseline",
        checks: [],
      },
    ],
    repairs: 2,
    retries: 2,
    autoApprove: true,
  };
  await writeFile(
    join(engineRoot, "fixture-plan.json"),
    JSON.stringify({
      ...definition,
      repository: worktree,
      confirmed: true,
      idempotencyKey: key,
    }),
  );
  const engine = spawn(
    process.execPath,
    [join(root, "test/fixtures/fake-transmission.mjs"), engineRoot, "--retained"],
    { stdio: "ignore" },
  );
  const exit = new Promise<void>((done) => engine.once("exit", () => done()));
  let app: ElectronApplication | undefined;
  try {
    await expect
      .poll(() => readFile(join(engineRoot, "fixture-ready"), "utf8").catch(() => ""))
      .not.toBe("");
    const snapshot = JSON.parse(await readFile(join(engineRoot, "fixture-snapshot.json"), "utf8"));
    const now = new Date().toISOString();
    await writeFile(
      join(registry, "registry.json"),
      JSON.stringify({
        format: 1,
        version,
        entries: [
          {
            id,
            key,
            name: definition.name,
            repository: repo,
            worktree,
            branch,
            baseline,
            repositoryIdentity: await identity(repo),
            repositoryGitIdentity: await identity(join(repo, ".git")),
            worktreeIdentity: await identity(worktree),
            createdAt: now,
            updatedAt: now,
            state: "submitted",
            definition,
            snapshot,
          },
        ],
      }),
      { mode: 0o600 },
    );
    app = await launchDesktop(directory, repo, join(directory, "project.sqlite"));
    const page = await app.firstWindow();
    const wizard = page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Claude", exact: true }).click();
    await expect(wizard.getByRole("status")).toHaveText("Claude connected");
    await wizard.getByRole("button", { name: "Close provider setup" }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.locator("#tab-apps").press("ArrowRight");
    await page.locator("#tab-workflows").click();
    const view = page.locator(".workflows-page");
    await view.getByRole("button", { name: /Retained legacy workflow/ }).click();
    await expect(view.getByRole("heading", { name: "“Retained legacy workflow”" })).toBeVisible();
    if (process.platform === "linux")
      await expect(view.getByText(/Transmission execution requires macOS/)).toBeVisible();
    await attachTransmissionBoundary(app);
    await page.getByRole("button", { name: "Workflows actions" }).click();
    await page.getByRole("menuitem", { name: "Refresh" }).click();
    await expect(view.getByRole("button", { name: "Pause workflow" })).toBeDisabled();
    await expect(view.getByRole("button", { name: "Resume workflow" })).toBeDisabled();
    await view.getByRole("button", { name: "Stop workflow" }).click();
    const stop = view.getByRole("dialog", { name: "Stop workflow?" });
    await expect(stop).not.toContainText("'Pause'");
    await stop.getByRole("button", { name: "Stop workflow", exact: true }).click();
    await expect(view.locator(".workflow-player > [role=status]")).toHaveText("Cancelled");
    const runs = JSON.parse(await readFile(join(engineRoot, "fixture-runs.json"), "utf8"));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: snapshot.runId,
      status: "cancelled",
      plan: { idempotencyKey: key },
    });
    expect(alive(runs[0].workerPid)).toBe(false);
    expect(await readdir(registry)).not.toContain("transmission-0.1.0-staging.20");
  } finally {
    await app?.close();
    engine.kill("SIGTERM");
    await exit;
    await removeDesktopFixture(directory, { recursive: true, force: true });
  }
});
