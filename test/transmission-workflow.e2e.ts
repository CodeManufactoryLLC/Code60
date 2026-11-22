import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
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
      const client = workflows.client;
      Object.defineProperty(client, "supported", { value: true });
      client.connect = async (signal: AbortSignal) => {
        await client.call("health", {}, signal);
      };
    },
    join(root, "dist/desktop/main.js"),
  );
}

test("workflow: Transmission prompt creation, isolated execution, status, cancellation and background reconnect", async () => {
  test.setTimeout(180_000);
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-transmission-ui-")));
  const repo = join(directory, "project");
  const engineRoot = join(directory, "state/code60/workflows/transmission-0.1.0-staging.18");
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
    const wizard = page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Claude", exact: true }).click();
    await expect(wizard.getByRole("status")).toHaveText("Claude connected");
    await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    if ((await page.locator("#apps-card-toggle").getAttribute("aria-expanded")) === "false")
      await page.locator("#apps-card-toggle").click();
    await page.locator("#tab-workflows").click();
    const workflows = page.locator(".workflows-page");
    await expect(page.getByRole("heading", { name: "Workflows", exact: true })).toBeVisible();
    if (process.platform === "linux") {
      await expect(workflows.getByText(/Transmission execution requires macOS/)).toBeVisible();
      await expect(
        workflows.getByRole("button", { name: "New workflow", exact: true }),
      ).toBeDisabled();
    }
    await attachTransmissionBoundary(application);
    await workflows.getByRole("button", { name: "Refresh", exact: true }).click();
    await workflows.getByRole("button", { name: "New workflow", exact: true }).click();
    const form = workflows.getByRole("region", { name: "New workflow", exact: true });
    await form.getByRole("button", { name: "Choose repository", exact: true }).click();
    await form.getByRole("button", { name: "Create with prompt", exact: true }).click();
    const chat = page.getByRole("dialog", { name: "Create with prompt", exact: true });
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
    workerPid = run.workerPid;
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
      await workflows.getByRole("button", { name: "Refresh", exact: true }).click();
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
    await workflows
      .getByLabel("Preserve negative zero?", { exact: true })
      .selectOption("normalize");
    await workflows.getByRole("button", { name: "Send answer", exact: true }).click();
    await expect(
      workflows.locator(".workflow-task-list").getByText("Repairing", { exact: true }),
    ).toBeVisible();
    await workflows
      .getByLabel("Guidance for a subsequent turn", { exact: true })
      .fill("Keep the public API stable");
    await workflows.getByRole("button", { name: "Queue guidance", exact: true }).click();
    await workflows
      .getByLabel("Guidance for a subsequent turn", { exact: true })
      .fill("reject guidance");
    await workflows.getByRole("button", { name: "Queue guidance", exact: true }).click();
    await expect(workflows.getByRole("alert")).toContainText("Transmission rejected");
    await writeFile(join(engineRoot, "control"), "verifying");
    await expect(
      workflows.locator(".workflow-task-list").getByText("Verifying", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(workflows.getByRole("alert")).toContainText("Transmission rejected");
    await workflows.getByRole("button", { name: "Refresh", exact: true }).click();
    await writeFile(join(engineRoot, "control"), "repairing");
    await workflows.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.locator("#tab-home").click();
    await page.locator("#tab-workflows").click();
    await expect(
      workflows.locator(".workflow-task-list").getByText("Repairing", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.locator("#tab-workflows").click();
    await workflows
      .getByRole("navigation", { name: "Workflow history" })
      .getByRole("button", { name: /Reviewed duration workflow/ })
      .click();
    await expect(
      workflows.locator(".workflow-task-list").getByText("Repairing", { exact: true }),
    ).toBeVisible();
    expect(await runs()).toHaveLength(1);
    await workflows.getByText("Activity", { exact: true }).click();
    await workflows.getByRole("button", { name: "Load more activity" }).click();
    await expect(
      workflows.locator("pre").filter({ hasText: "Keep the public API stable" }),
    ).toBeVisible();
    await workflows.getByText("Accepted diff", { exact: true }).click();
    await workflows.getByRole("button", { name: "Load accepted diff" }).click();
    await expect(workflows.locator("pre").filter({ hasText: "workflow-result.txt" })).toBeVisible();
    await writeFile(join(engineRoot, "control"), "disconnect");
    await workflows.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(workflows.getByText(/Status unavailable/)).toBeVisible();
    await expect(
      workflows.locator(".workflow-task-list").getByText("Repairing", { exact: true }),
    ).toBeVisible();
    await writeFile(join(engineRoot, "control"), "repairing");
    await workflows.getByRole("button", { name: "Refresh", exact: true }).click();
    await writeFile(join(engineRoot, "control"), "repairing");
    await workflows.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.locator("#tab-home").click();
    await page.locator("#tab-workflows").click();
    await expect(
      workflows.getByRole("heading", { name: "Reviewed duration workflow", exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.locator("#tab-workflows").click();
    await workflows
      .getByRole("navigation", { name: "Workflow history" })
      .getByRole("button", { name: /Reviewed duration workflow/ })
      .click();
    await expect(
      workflows.locator(".workflow-task-list").getByText("Repairing", { exact: true }),
    ).toBeVisible();
    expect(await runs()).toHaveLength(1);
    await page.screenshot({ path: test.info().outputPath("workflow-status.png") });
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
    if ((await page.locator("#apps-card-toggle").getAttribute("aria-expanded")) === "false")
      await page.locator("#apps-card-toggle").click();
    await page.locator("#tab-workflows").click();
    const reopened = page.locator(".workflows-page");
    await reopened.getByRole("button", { name: "Refresh", exact: true }).click();
    await reopened
      .getByRole("navigation", { name: "Workflow history" })
      .getByRole("button", { name: /Reviewed duration workflow/ })
      .click();
    await expect(reopened.getByText("Repairing", { exact: true })).toBeVisible();
    expect(await runs()).toHaveLength(1);
    await reopened.getByRole("button", { name: "Cancel workflow", exact: true }).click();
    await expect(reopened.locator(".workflow-actions > strong")).toHaveText("Cancelled");
    await expect.poll(() => (workerPid ? alive(workerPid) : true)).toBe(false);
    expect(await readFile(join(repo, "source.txt"), "utf8")).toBe("saved unstaged\n");
    expect(git("rev-parse", "HEAD")).toBe(head);
    // Manual entry and terminal evidence use the same production approval path.
    await reopened.getByRole("button", { name: "New workflow", exact: true }).click();
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
    await expect(reopened.getByText("1 of 1 tasks accepted", { exact: true })).toBeVisible();
    await expect(
      reopened.getByText("Independent fixture checks passed", { exact: true }),
    ).toBeVisible();
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
