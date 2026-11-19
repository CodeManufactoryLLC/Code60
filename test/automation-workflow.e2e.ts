import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type ElectronApplication, expect, type Page, test } from "@playwright/test";
import { launchDesktop, removeDesktopFixture } from "./electron-launcher.js";
import { commitFixture } from "./fixtures/git-repository.js";

const root = resolve(import.meta.dirname, "..");

test("workflow: desktop automation survives app quit, retains history and cancels without CLI", async () => {
  test.setTimeout(120_000);
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-scheduler-workflow-")));
  const repo = join(directory, "project");
  const gate = join(directory, "release-worker");
  const stateFile = join(directory, "state/code60/automations/state.json");
  await mkdir(repo);
  await mkdir(join(directory, "config/code60"), { recursive: true });
  await mkdir(join(directory, "home"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8", timeout: 10_000 });
  git("init", "-q", "-b", "main");
  await writeFile(join(repo, "result.txt"), "original\n");
  git("add", ".");
  commitFixture(repo);
  const before = {
    head: git("rev-parse", "HEAD"),
    index: await readFile(join(repo, ".git/index")),
  };
  await writeFile(
    join(directory, "config/code60/config.json"),
    JSON.stringify({
      agents: {
        claude: { command: [process.execPath, join(root, "test/fixtures/fake-agent.mjs")] },
      },
    }),
  );
  // Launch the real internal service in isolated state. No OS registration is installed.
  const service = spawn(process.execPath, [join(root, "dist/automation/main.js")], {
    env: {
      ...process.env,
      HOME: join(directory, "home"),
      XDG_CONFIG_HOME: join(directory, "config"),
      XDG_STATE_HOME: join(directory, "state"),
    },
    detached: true,
    stdio: "ignore",
  });
  const serviceExit = new Promise<void>((done, reject) => {
    service.once("exit", () => done());
    service.once("error", reject);
  });
  void serviceExit.catch(() => {});
  let application: ElectronApplication | undefined;
  const saved = async () => JSON.parse(await readFile(stateFile, "utf8"));
  const launch = async () => {
    application = await launchDesktop(directory, repo, join(directory, "projects.sqlite"));
    const page = await application.firstWindow();
    return page;
  };
  const automations = async (page: Page) => {
    await page.locator("#tab-apps").press("ArrowRight");
    await page.locator("#tab-automations").click();
    await expect(page.locator("#panel-automations")).toBeVisible();
  };
  const selectSchedule = async (page: Page) => {
    const canvas = page.locator(".automation-schedules-grid").getByTestId("data-grid-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Missing schedule grid");
    await page.mouse.click(box.x + 100, box.y + 44);
    await expect(page.getByRole("button", { name: "Run now", exact: true })).toBeVisible();
  };
  try {
    await expect.poll(async () => (await saved().catch(() => null))?.format).toBe(1);
    let page = await launch();
    const wizard = page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Claude", exact: true }).click();
    await expect(wizard.getByRole("status")).toHaveText("Claude connected");
    await wizard.getByRole("button", { name: "Close agent setup", exact: true }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await automations(page);
    await page.getByRole("button", { name: "New scheduled job", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "New scheduled job", exact: true });
    await editor.getByLabel("Name", { exact: true }).fill("Retained scheduler");
    await editor.getByLabel("Local base branch", { exact: true }).fill("main");
    await editor
      .getByLabel("Saved prompt", { exact: true })
      .fill(
        JSON.stringify([
          { write: { path: "result.txt", content: "service-owned edit\n" } },
          { waitForFile: gate },
          { message: "finished" },
        ]),
      );
    await editor.getByRole("button", { name: "Choose repository", exact: true }).click();
    await editor.getByRole("button", { name: "Save automation", exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect((await saved()).automations).toHaveLength(1);
    expect((await saved()).automations[0].enabled).toBe(false);
    expect((await saved()).executions).toHaveLength(0);
    await selectSchedule(page);
    await page.getByRole("button", { name: "Run now", exact: true }).click();
    await expect.poll(async () => (await saved()).executions[0]?.status).toBe("running");
    const first = (await saved()).executions[0];
    // Desktop exit cannot terminate the independent service or its work.
    await application?.close();
    application = undefined;
    expect(service.exitCode).toBeNull();
    expect((await saved()).executions[0].status).toBe("running");
    await writeFile(gate, "release");
    await expect.poll(async () => (await saved()).executions[0]?.status).toBe("finished");
    page = await launch();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await automations(page);
    await expect(page.locator(".automation-history-grid")).toContainText("finished");
    expect((await saved()).executions).toHaveLength(1);
    expect((await saved()).executions[0].id).toBe(first.id);
    await unlink(gate);
    await selectSchedule(page);
    await page.getByRole("button", { name: "Run now", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await saved()).executions.filter((e: { status: string }) => e.status === "running")
            .length,
      )
      .toBe(1);
    await page.locator("#tab-system-manager").click();
    await page
      .getByRole("button", { name: "Pause all and cancel active work", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await saved()).executions.filter(
            (e: { status: string }) => e.status === "running" || e.status === "claimed",
          ).length,
      )
      .toBe(0);
    const final = await saved();
    expect(final.pausedAll).toBe(true);
    expect(final.executions).toHaveLength(2);
    for (const execution of final.executions) {
      const record = JSON.parse(
        await readFile(join(repo, ".git/code60/runs", execution.runId, "run.json"), "utf8"),
      );
      expect(record.agentPid).toBeGreaterThan(0);
      await expect
        .poll(() => {
          try {
            process.kill(record.agentPid, 0);
            return true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
            throw error;
          }
        })
        .toBe(false);
    }
    expect(final.executions.map((e: { status: string }) => e.status).sort()).toEqual([
      "cancelled",
      "finished",
    ]);
    expect(await readFile(join(repo, "result.txt"), "utf8")).toBe("original\n");
    expect(await readFile(join(repo, ".git/index"))).toEqual(before.index);
    expect(git("rev-parse", "HEAD")).toBe(before.head);
    expect(git("worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(3);
  } finally {
    await application?.close();
    service.kill("SIGTERM");
    try {
      await expect.poll(() => service.exitCode !== null || service.signalCode !== null).toBe(true);
      await serviceExit;
    } finally {
      // Only this test's detached process group is eligible for escalation.
      if (service.pid)
        try {
          process.kill(-service.pid, "SIGKILL");
        } catch (error) {
          expect((error as NodeJS.ErrnoException).code).toBe("ESRCH");
        }
      await removeDesktopFixture(directory, { recursive: true, force: true });
    }
  }
});
