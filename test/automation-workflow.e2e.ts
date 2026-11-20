import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type ElectronApplication, expect, type Page, test } from "@playwright/test";
import { launchDesktop, removeDesktopFixture } from "./electron-launcher.js";
import { commitFixture } from "./fixtures/git-repository.js";
import { nativeSupervisorFixture } from "./fixtures/native-supervisor.js";
import { recordedAgentPid } from "./fixtures/run-readiness.js";

const root = resolve(import.meta.dirname, "..");

test("workflow: desktop automation survives app quit, retains history and cancels without CLI", async () => {
  test.setTimeout(120_000);
  // Darwin's per-user TMPDIR can exceed the scheduler's local-socket path limit.
  const temporaryRoot = process.platform === "darwin" ? "/tmp" : tmpdir();
  const directory = await realpath(
    await mkdtemp(join(temporaryRoot, "code60-scheduler-workflow-")),
  );
  const repo = join(directory, "project");
  const gate = join(directory, "release-worker");
  const stateFile = join(directory, "state/code60/automations/state.json");
  const supervisor = await nativeSupervisorFixture(directory);
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
    application = await launchDesktop(
      directory,
      repo,
      join(directory, "projects.sqlite"),
      false,
      supervisor.environment,
    );
    const page = await application.firstWindow();
    return { page, instance: application };
  };
  const automations = async (page: Page) => {
    await page.locator("#tab-apps").press("ArrowRight");
    await page.locator("#tab-automations").click();
    await expect(page.locator("#panel-automations")).toBeVisible();
  };
  const job = (page: Page) =>
    page
      .locator(".automation-job")
      .filter({ has: page.getByRole("button", { name: "Run Retained scheduler", exact: true }) });
  const expandJob = async (page: Page) => {
    const trigger = page.locator('[data-slot="accordion-trigger"]').first();
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
    await expect(page.locator(".automation-job-details")).toBeVisible();
  };
  try {
    await expect.poll(async () => (await saved().catch(() => null))?.format).toBe(1);
    await expect
      .poll(async () => {
        const endpoint = await readFile(
          join(directory, "state/code60/automations/connection.json"),
          "utf8",
        ).catch(() => "null");
        return JSON.parse(endpoint)?.v;
      })
      .toBe(1);
    let { page } = await launch();
    const wizard = page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Claude", exact: true }).click();
    await expect(wizard.getByRole("status")).toHaveText("Claude connected");
    await wizard.getByRole("button", { name: "Close agent setup", exact: true }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await automations(page);
    await page.getByRole("button", { name: "Actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "New scheduled job", exact: true }).click();
    const editor = page.getByRole("region", { name: "New scheduled job", exact: true });
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
    await editor.getByRole("button", { name: "Create job", exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect((await saved()).automations).toHaveLength(1);
    expect((await saved()).automations[0].enabled).toBe(false);
    expect((await saved()).executions).toHaveLength(0);
    await expect(page.locator('[data-slot="accordion-trigger"]')).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(
      job(page).getByRole("button", { name: "Delete Retained scheduler" }),
    ).toBeVisible();
    for (const scheme of ["light", "dark"]) {
      await page.evaluate(
        (value) => document.documentElement.setAttribute("data-color-scheme", value),
        scheme,
      );
      const trigger = job(page).locator('[data-slot="accordion-trigger"]');
      const controls = job(page).locator(".automation-job-controls");
      await expect(job(page).locator(".automation-job-name")).toHaveText(
        "Retained scheduler (Paused)",
      );
      await expect(job(page).locator(".automation-job-meta")).toHaveCount(0);
      await expect(job(page)).toHaveCSS("border-top-left-radius", "5px");
      await expect(job(page).locator(".automation-job-header")).toHaveCSS(
        "border-top-left-radius",
        "3px",
      );
      await expect(job(page).locator(".automation-job-header")).toHaveCSS(
        "border-bottom-left-radius",
        "3px",
      );
      await expect(controls.locator("button")).toHaveCount(3);
      await expect(controls.locator("button").nth(0)).toHaveAccessibleName(
        "Run Retained scheduler",
      );
      await expect(controls.locator("button").nth(1)).toHaveAccessibleName(
        "Delete Retained scheduler",
      );
      await expect(controls.locator("button").nth(2)).toHaveAccessibleName(
        "Expand Retained scheduler",
      );
      await controls.locator("button").nth(0).focus();
      await page.keyboard.press("Tab");
      await expect(controls.locator("button").nth(1)).toBeFocused();
      await expect(
        controls.locator("button").nth(1).locator(".automation-header-circle"),
      ).toHaveCSS("outline-style", "solid");
      await page.keyboard.press("Tab");
      await expect(trigger).toBeFocused();
      for (const circle of await controls
        .locator(".automation-header-circle, .neo-accordion-indicator")
        .all()) {
        await expect(circle).toHaveCSS("border-radius", "50%");
        await expect(circle).toHaveCSS("border-top-color", "rgb(0, 0, 0)");
        await expect(circle).toHaveCSS("width", "24px");
        await expect(circle).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      }
      await job(page).locator("h3").click();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await trigger.hover();
      const bounds = await trigger.boundingBox();
      const header = job(page).locator(".automation-job-header");
      const fill = await header.evaluate((element) => getComputedStyle(element).backgroundColor);
      await expect(trigger).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await header.screenshot({ path: test.info().outputPath(`job-header-hover-${scheme}.png`) });
      await page.mouse.down();
      await expect(trigger).toHaveCSS("scale", "none");
      expect(await trigger.boundingBox()).toEqual(bounds);
      await expect(header.locator(".automation-job-name")).toBeVisible();
      await expect(header.locator(".automation-job-name")).toHaveCSS("color", "rgb(255, 255, 255)");
      await page.screenshot({ path: test.info().outputPath(`job-header-held-${scheme}.png`) });
      await page.mouse.up();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(job(page).locator(".automation-job-details")).toBeVisible();
      await expect(header).toHaveCSS("border-bottom-left-radius", "0px");
      await expect(header).toHaveCSS("border-top-left-radius", "3px");
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await job(page).getByRole("button", { name: "Delete Retained scheduler" }).hover();
      await expect(header).toHaveCSS("background-color", fill);
      await expect(trigger).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(controls.locator(".automation-header-circle").nth(1)).toHaveCSS(
        "background-color",
        "rgba(0, 0, 0, 0)",
      );
    }
    await page.getByRole("button", { name: "Run Retained scheduler", exact: true }).click();
    await expect.poll(async () => (await saved()).executions[0]?.status).toBe("running");
    await expect(
      page.getByRole("button", { name: "Stop Retained scheduler", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete Retained scheduler" })).toBeDisabled();
    const stopIcon = page.getByRole("button", { name: "Stop Retained scheduler" }).locator("svg");
    await expect(stopIcon).toHaveCSS("animation-name", "automation-stop-pulse");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(stopIcon).toHaveCSS("animation-name", "none");
    await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "active" });
    await expect(stopIcon).toHaveCSS("animation-name", "none");
    for (const circle of await page
      .locator(".automation-header-circle, .neo-accordion-indicator")
      .all()) {
      await expect(circle).toHaveCSS("box-shadow", "none");
    }
    for (const button of await page.locator(".automation-job-controls > button").all()) {
      await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    }
    await page.screenshot({ path: test.info().outputPath("job-circles-forced-colors.png") });
    await page.emulateMedia({ forcedColors: "none" });
    const first = (await saved()).executions[0];
    // Desktop exit cannot terminate the independent service or its work.
    await application?.close();
    application = undefined;
    expect(service.exitCode).toBeNull();
    expect((await saved()).executions[0].status).toBe("running");
    await writeFile(gate, "release");
    await expect.poll(async () => (await saved()).executions[0]?.status).toBe("finished");
    const reopened = await launch();
    page = reopened.page;
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await automations(page);
    await expect(page.locator(".automation-history-grid")).toContainText("finished");
    expect((await saved()).executions).toHaveLength(1);
    expect((await saved()).executions[0].id).toBe(first.id);
    await unlink(gate);
    await expandJob(page);
    await expect(page.locator(".automation-job-details")).toContainText("main");
    await expect(page.locator('[data-slot="accordion-trigger"] .carbon-icon')).toHaveCSS(
      "rotate",
      "0deg",
    );
    await reopened.instance.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(760, 650),
    );
    expect(
      await page
        .locator(".automation-job")
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(false);
    await expect
      .poll(() =>
        page
          .locator(".automation-job-facts")
          .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length),
      )
      .toBe(1);
    await page.screenshot({ path: test.info().outputPath("job-details-narrow.png") });
    await reopened.instance.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(1280, 860),
    );
    await page.screenshot({ path: test.info().outputPath("job-details-light.png") });
    await page
      .locator("html")
      .evaluate((element) => element.setAttribute("data-color-scheme", "dark"));
    await page.screenshot({ path: test.info().outputPath("job-details-dark.png") });
    await page
      .locator("html")
      .evaluate((element) => element.setAttribute("data-color-scheme", "light"));
    await page.getByRole("button", { name: "Enable schedule", exact: true }).click();
    await expect.poll(async () => (await saved()).automations[0].enabled).toBe(true);
    await page.getByRole("button", { name: "Pause schedule", exact: true }).click();
    await expect.poll(async () => (await saved()).automations[0].enabled).toBe(false);
    await page.getByRole("button", { name: "Edit job", exact: true }).click();
    const edit = page.getByRole("region", { name: "Edit scheduled job", exact: true });
    await expect(edit.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await edit.getByLabel("Turn timeout", { exact: true }).fill("2m");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(edit).toHaveCount(0);
    await expect.poll(async () => (await saved()).automations[0].turnTimeout).toBe("2m");
    const trigger = page.locator('[data-slot="accordion-trigger"]').first();
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "Run Retained scheduler", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await saved()).executions.filter((e: { status: string }) => e.status === "running")
            .length,
      )
      .toBe(1);
    // "running" is published before checkout preparation and provider launch finish.
    // Exercise cancellation of a real process, not cancellation before it exists.
    await expect
      .poll(async () => {
        const execution = (await saved()).executions.find(
          (entry: { status: string }) => entry.status === "running",
        );
        if (!execution?.runId) return 0;
        return recordedAgentPid(join(repo, ".git/code60/runs", execution.runId, "run.json"));
      })
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "Stop Retained scheduler", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await saved()).executions.filter(
            (e: { status: string }) => e.status === "running" || e.status === "claimed",
          ).length,
      )
      .toBe(0);
    const final = await saved();
    expect(final.pausedAll).toBe(false);
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
    await expect(
      page.getByRole("button", { name: "Run Retained scheduler", exact: true }),
    ).toBeVisible();
    await reopened.instance.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await page.getByRole("button", { name: "Delete Retained scheduler" }).click();
    await expect(page.getByRole("button", { name: "Delete Retained scheduler" })).toBeEnabled();
    expect((await saved()).automations).toHaveLength(1);
    await reopened.instance.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (options) => {
        if (!("message" in options) || options.message !== "Delete automation?")
          throw new Error("Unexpected confirmation");
        return { response: 1, checkboxChecked: false };
      };
    });
    await page.getByRole("button", { name: "Delete Retained scheduler" }).click();
    await expect(page.locator(".automation-job")).toHaveCount(0);
    expect((await saved()).automations).toHaveLength(0);
    expect((await saved()).executions).toHaveLength(2);
  } finally {
    await application
      ?.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      })
      .catch(() => {});
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
