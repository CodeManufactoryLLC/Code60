import { execFile, execFileSync, spawn } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { type ElectronApplication, expect, type Page, test } from "@playwright/test";
import { launchDesktop, removeDesktopFixture } from "./electron-launcher.js";
import { commitFixture } from "./fixtures/git-repository.js";
import { nativeSupervisorFixture } from "./fixtures/native-supervisor.js";
import { recordedAgentPid } from "./fixtures/run-readiness.js";
import { pageCommand } from "./page-header-controls.js";

const root = resolve(import.meta.dirname, "..");

for (const updateRoute of ["startup", "install-ui"] as const) {
  test(`workflow: ${updateRoute} app upgrade stops the old scheduler, aligns its version and resumes retained schedules`, async () => {
    test.skip(process.platform !== "linux", "Uses only the isolated fake systemd boundary");
    test.setTimeout(150_000);
    const directory = await mkdtemp(join(tmpdir(), "c60-upgrade-"));
    const supervisor = await nativeSupervisorFixture(directory);
    const oldApp = join(directory, "old-app");
    const repo = join(directory, "project");
    const stateRoot = join(directory, "state/code60/automations");
    const env = {
      ...process.env,
      ...supervisor.environment,
      HOME: join(directory, "home"),
      XDG_CONFIG_HOME: join(directory, "config"),
      XDG_STATE_HOME: join(directory, "state"),
    };
    const api = await import(pathToFileURL(join(root, "dist/automation/index.js")).href);
    const client = api.automationClient(env);
    const saved = async () => JSON.parse(await readFile(join(stateRoot, "state.json"), "utf8"));
    const helper = async (appRoot: string, action: "install" | "prepare") => {
      await promisify(execFile)(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          'const api = await import(process.argv[1]); if (process.argv[2] === "install") await api.schedulerControl(process.env, "install", true); else await api.prepareSchedulerUpdate(process.env);',
          pathToFileURL(join(appRoot, "dist/automation/index.js")).href,
          action,
        ],
        { env, timeout: 30_000 },
      );
    };
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        return false;
      }
    };
    let application: ElectronApplication | undefined;
    const exitedApplications: ElectronApplication[] = [];
    try {
      // Simulate the prior app install, with its own package version and runtime.
      // Native installation alone is fake; service, IPC, storage and agent are real.
      await cp(join(root, "dist"), join(oldApp, "dist"), {
        recursive: true,
        filter: (source) => source !== join(root, "dist/renderer"),
      });
      await symlink(join(root, "node_modules"), join(oldApp, "node_modules"), "dir");
      const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
      await writeFile(
        join(oldApp, "package.json"),
        JSON.stringify({
          ...manifest,
          version: updateRoute === "startup" ? "0.0.0" : manifest.version,
        }),
      );
      await mkdir(env.HOME);
      await mkdir(join(directory, "config/code60"), { recursive: true });
      await writeFile(
        join(directory, "config/code60/config.json"),
        JSON.stringify({
          agents: {
            claude: { command: [process.execPath, join(root, "test/fixtures/fake-agent.mjs")] },
          },
        }),
      );
      await mkdir(repo);
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
      await writeFile(join(repo, "result.txt"), "original\n");
      execFileSync("git", ["add", "."], { cwd: repo });
      commitFixture(repo);
      const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" });
      const index = await readFile(join(repo, ".git/index"));
      await helper(oldApp, "install");
      const oldStatus = await client({ action: "status" });
      expect(oldStatus.appVersion).toBe(updateRoute === "startup" ? "0.0.0" : manifest.version);
      const automation = await client({
        action: "create",
        draft: {
          name: "Retained upgrade job",
          agent: "claude",
          repository: repo,
          baseBranch: "main",
          allow: [],
          turnTimeout: "1m",
          enabled: true,
          prompt: JSON.stringify([{ message: "scheduled after upgrade" }]),
          schedule: {
            type: "interval",
            everyMinutes: 1,
            anchor: new Date(Date.now() + 45_000).toISOString(),
          },
        },
      });
      await client({ action: "runNow", id: automation.id });
      await expect.poll(async () => (await saved()).executions[0]?.status).toBe("finished");
      const before = await saved();
      if (updateRoute === "install-ui") {
        await writeFile(join(directory, "old-service-pid"), String(oldStatus.pid));
        application = await launchDesktop(
          directory,
          repo,
          join(directory, "projects.sqlite"),
          false,
          supervisor.environment,
          fileURLToPath(new URL("./fixtures/update-app.mjs", import.meta.url)),
        );
        const page = await application.firstWindow();
        const wizard = page.locator(".agent-setup-dialog");
        await wizard.getByRole("button", { name: "Claude", exact: true }).click();
        await expect(wizard.getByRole("status")).toHaveText("Claude connected");
        await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
        await page.getByRole("button", { name: "Start", exact: true }).click();
        await page.locator("#tab-settings-updates").click();
        const updates = page.locator("#app-updates");
        await updates.getByRole("switch", { name: "Automatically check for updates" }).uncheck();
        await (await pageCommand(page, "Check for updates")).click();
        const popup = page.getByRole("dialog", { name: "Update available", exact: true });
        await expect(popup).toBeVisible();
        await popup.getByRole("button", { name: "Later", exact: true }).click();
        await (await pageCommand(page, "Download update")).click();
        const mainPid = await application.evaluate(() => process.pid);
        await (await pageCommand(page, "Install and restart")).click();
        await expect.poll(() => alive(mainPid)).toBe(false);
        const evidence = (await readFile(join(directory, "installer-boundary.jsonl"), "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        expect(evidence).toContainEqual({
          action: "install",
          marker: { version: 1, pausedAll: false },
          oldExited: true,
        });
        expect(evidence).toContainEqual({ action: "relaunch" });
        expect(evidence).toContainEqual({
          action: "dialog",
          type: "warning",
          message: "Install update and restart Code60?",
          buttons: ["Keep working", "Install and restart"],
          defaultId: 0,
          cancelId: 0,
        });
        exitedApplications.push(application);
        application = undefined;
      } else await helper(root, "prepare");
      expect(alive(oldStatus.pid)).toBe(false);
      expect(JSON.parse(await readFile(join(stateRoot, "update-restart.json"), "utf8"))).toEqual({
        version: 1,
        pausedAll: false,
      });
      // Installation completes and the newly installed main app starts. Its normal
      // startup consumes the marker; no test calls the recovery helper in Electron.
      application = await launchDesktop(
        directory,
        repo,
        join(directory, "projects.sqlite"),
        false,
        supervisor.environment,
      );
      const status = await client({ action: "status" });
      expect(status).toMatchObject({ appVersion: manifest.version, pausedAll: false, block: null });
      expect(status.pid).not.toBe(oldStatus.pid);
      expect(alive(status.pid)).toBe(true);
      const executable = await application.evaluate(() => process.execPath);
      const registration = JSON.parse(await readFile(join(stateRoot, "registration.json"), "utf8"));
      expect(registration).toMatchObject({
        installed: true,
        runtime: { executable, args: [join(root, "dist/automation/main.js")] },
      });
      expect(registration).not.toHaveProperty("appVersion");
      expect(
        await readFile(join(env.HOME, ".config/systemd/user/code60-scheduler.service"), "utf8"),
      ).toContain(`ExecStart="${executable}" "${join(root, "dist/automation/main.js")}"`);
      await expect(readFile(join(stateRoot, "update-restart.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      const after = await saved();
      const { nextRunAt: _beforeNext, ...definition } = before.automations[0];
      const { nextRunAt, ...retained } = after.automations[0];
      expect(retained).toEqual(definition);
      expect(Date.parse(nextRunAt)).toBeGreaterThan(Date.now());
      expect(after.executions).toEqual(before.executions);
      const commands = (await readFile(join(directory, "supervisor-commands.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)[1]);
      expect(commands.filter((action) => action !== "show")).toEqual([
        "daemon-reload",
        "enable",
        "stop",
        "stop",
        "daemon-reload",
        "enable",
      ]);
      // Observe the main process's exit independently. Playwright's context close
      // also waits for inherited debug pipes held by the fake supervisor's service;
      // a real per-user supervisor does not inherit those test-only descriptors.
      const previous = application;
      const mainPid = await previous.evaluate(() => process.pid);
      exitedApplications.push(previous);
      void previous.evaluate(({ app }) => app.quit()).catch(() => {});
      await expect.poll(() => alive(mainPid)).toBe(false);
      application = await launchDesktop(
        directory,
        repo,
        join(directory, "projects.sqlite"),
        false,
        supervisor.environment,
      );
      expect((await client({ action: "status" })).pid).toBe(status.pid);
      // Recurrence itself, rather than Run now, must resume after installation.
      await expect
        .poll(
          async () =>
            (await saved()).executions.find(
              (execution: { trigger: string }) => execution.trigger === "schedule",
            )?.status,
          { timeout: 65_000 },
        )
        .toBe("finished");
      const final = await saved();
      expect(final.executions).toHaveLength(2);
      expect(
        final.executions.filter(
          (execution: { trigger: string }) => execution.trigger === "schedule",
        ),
      ).toHaveLength(1);
      expect(await readFile(join(repo, "result.txt"), "utf8")).toBe("original\n");
      expect(await readFile(join(repo, ".git/index"))).toEqual(index);
      expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" })).toBe(
        head,
      );
      await test.info().attach("scheduler-upgrade-outcomes", {
        body: JSON.stringify({
          oldVersion: oldStatus.appVersion,
          newVersion: status.appVersion,
          oldStopped: !alive(oldStatus.pid),
          pidRetainedAcrossRestart: (await client({ action: "status" })).pid === status.pid,
          commands,
          executionCount: final.executions.length,
        }),
        contentType: "application/json",
      });
    } finally {
      await supervisor.cleanup();
      await application?.close().catch(() => {});
      for (const previous of exitedApplications) await previous.close().catch(() => {});
      await removeDesktopFixture(directory, { recursive: true, force: true });
    }
  });
}

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
    await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await automations(page);
    await page.getByRole("button", { name: "Scheduled Jobs actions", exact: true }).click();
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
    await expect(
      page.getByRole("button", { name: "Scheduled Jobs actions", exact: true }),
    ).toBeFocused();
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
        "4px",
      );
      await expect(job(page).locator(".automation-job-header")).toHaveCSS(
        "border-bottom-left-radius",
        "4px",
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
      await expect(header).toHaveCSS("border-top-left-radius", "4px");
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
    for (const button of await page.locator(".automation-job-controls > button").all()) {
      await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    }
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
    await expect(page.locator(".automation-prompt-text")).toHaveCSS("scrollbar-gutter", "stable");
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
    await expect(edit.getByLabel("Name", { exact: true })).toBeFocused();
    await expect(edit.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await edit.getByLabel("Turn timeout", { exact: true }).fill("2m");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(edit).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Collapse Retained scheduler", exact: true }),
    ).toBeFocused();
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
