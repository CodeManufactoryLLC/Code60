import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { build } from "vite";
import { launchDesktop, removeDesktopFixture } from "./electron-launcher.js";
import { nativeSupervisorFixture } from "./fixtures/native-supervisor.js";

test("desktop: System Manager service actions, pushed status and navigation races", async () => {
  const directory = await mkdtemp(join(tmpdir(), "code60-system-manager-fixture-"));
  const output = join(directory, "fixture");
  let application: Awaited<ReturnType<typeof launchDesktop>> | undefined;
  try {
    await build({
      configFile: false,
      logLevel: "error",
      define: { "process.env.NODE_ENV": JSON.stringify("development") },
      build: {
        outDir: output,
        minify: false,
        lib: {
          entry: resolve(import.meta.dirname, "fixtures/system-manager.tsx"),
          formats: ["es"],
          fileName: () => "fixture.js",
        },
      },
    });
    const html = join(output, "index.html");
    await writeFile(
      html,
      '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'"><div id="root"></div><script type="module" src="./fixture.js"></script>',
    );
    application = await launchDesktop(directory, directory, join(directory, "unused.sqlite"));
    const ready = application.waitForEvent("window");
    await application.evaluate(({ BrowserWindow }, html) => {
      const window = new BrowserWindow({
        show: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
      });
      void window.loadFile(html);
    }, html);
    const page = await ready;
    const toggle = page.getByRole("button", { name: "Toggle page", exact: true });
    const service = page.getByRole("status");
    const requests = () => page.evaluate(() => window.systemManagerFixture.requests);
    await expect(toggle).toBeVisible();
    expect(await requests()).toEqual([]);
    expect(await page.evaluate(() => window.systemManagerFixture.listeners())).toBe(0);
    await toggle.click();
    await expect(service).toHaveText("Not installed");
    await page.getByRole("button", { name: "Install", exact: true }).click();
    await expect(service).toHaveText("Running");
    expect(await requests()).toContainEqual({ action: "scheduler", control: "install" });
    await page.evaluate(() =>
      window.systemManagerFixture.setStatus(
        { installed: true, nativeState: "stopped", service: null },
        false,
      ),
    );
    await expect(service).toHaveText("Stopped", { timeout: 5000 });
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(service).toHaveText("Running");
    const beforeBackgroundRead = (await requests()).length;
    await page.evaluate(() => {
      window.systemManagerFixture.holdReads = true;
    });
    await expect.poll(async () => (await requests()).length).toBeGreaterThan(beforeBackgroundRead);
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
    await expect(page.locator(".automation-service")).toHaveAttribute("aria-busy", "false");
    await page.evaluate(() => {
      window.systemManagerFixture.holdReads = false;
      window.systemManagerFixture.releaseRead();
    });
    await page.evaluate(() => window.systemManagerFixture.publish({ activeExecutionId: "active" }));
    await expect(service).toContainText("A run is active");
    await expect(
      page.getByRole("button", { name: "Pause all and cancel active work" }),
    ).toHaveCount(0);
    await expect(page.locator(".automation-service-actions > .primary")).toHaveText("Stop");
    await page.evaluate(() => window.systemManagerFixture.publish({ pausedAll: true }));
    await expect(service).toContainText("Jobs paused");
    await expect(page.locator(".automation-service-badge")).toHaveText("Running");
    await page.getByRole("button", { name: "Resume jobs", exact: true }).click();
    await expect(service).toHaveText("Running");
    expect(await requests()).toContainEqual({ action: "resumeAll" });
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(service).toHaveText("Stopped");
    await expect(page.getByRole("button", { name: "Install", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(service).toHaveText("Running");
    await page.getByText("Service options", { exact: true }).click();
    for (const control of ["repair", "uninstall"] as const) {
      await page.getByRole("button", { name: new RegExp(`^${control}$`, "i") }).click();
      await expect(service).toHaveText(control === "uninstall" ? "Not installed" : "Running");
    }
    await page.getByRole("button", { name: "Install", exact: true }).click();
    await expect(service).toHaveText("Running");
    await page.getByText("Service options", { exact: true }).click();
    for (const reason of ["leftover_agent", "persistence_failed"] as const) {
      await page.evaluate(
        (reason) =>
          window.systemManagerFixture.publish({
            block: { reason, executionId: null, runId: null },
          }),
        reason,
      );
      await expect(page.getByRole("alert")).toContainText(
        reason === "leftover_agent" ? "unfinished agent process" : "could not save",
      );
      await page.getByRole("button", { name: "Recheck", exact: true }).click();
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(await requests()).toContainEqual({ action: "resolveBlock" });
    }
    await page.evaluate(() => {
      window.systemManagerFixture.failAction = true;
    });
    await page.getByRole("button", { name: "Repair", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Service action refused");
    await expect(page.getByRole("button", { name: "Repair", exact: true })).toBeEnabled();
    await page.evaluate(() => window.systemManagerFixture.publish({ pausedAll: true }, false));
    await expect(service).toContainText("Jobs paused", { timeout: 5000 });
    await expect(page.getByRole("alert")).toHaveText("Service action refused");
    await page.evaluate(() => {
      window.systemManagerFixture.failAction = false;
    });
    await page.getByRole("button", { name: "Repair", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    // Hidden pages unsubscribe and defer reads. An old read cannot overwrite the new view.
    await page.evaluate(() => {
      window.systemManagerFixture.holdReads = true;
      window.systemManagerFixture.publish({ pausedAll: true });
      window.systemManagerFixture.publish({ pausedAll: true });
    });
    const count = (await requests()).length;
    await page.evaluate(() => window.systemManagerFixture.publish({ pausedAll: true }));
    expect((await requests()).length).toBe(count);
    await toggle.click();
    expect(await page.evaluate(() => window.systemManagerFixture.listeners())).toBe(0);
    await page.evaluate(() => {
      window.systemManagerFixture.holdReads = false;
      window.systemManagerFixture.publish();
    });
    expect((await requests()).length).toBe(count);
    await toggle.click();
    await expect(service).toHaveText("Running");
    await page.evaluate(() => window.systemManagerFixture.releaseRead());
    await expect(service).toHaveText("Running");
    expect((await requests()).length).toBe(count + 1);
    // A mutation stays single-flight over hide/show and refreshes the current active view.
    await page.evaluate(() => {
      window.systemManagerFixture.holdActions = true;
    });
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await toggle.click();
    await toggle.click();
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeDisabled();
    await expect(service).toContainText("Stopping…");
    const pending = (await requests()).filter(
      (request) => request.action === "scheduler" && request.control === "stop",
    ).length;
    await page.evaluate(() => window.systemManagerFixture.releaseAction());
    await expect(page.locator(".automation-service-badge")).toHaveText("Stopped");
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeEnabled();
    expect(
      (await requests()).filter(
        (request) => request.action === "scheduler" && request.control === "stop",
      ),
    ).toHaveLength(pending);
    expect((await requests()).some((request) => request.action === "pauseAll")).toBe(false);
    await toggle.click();
    expect(await page.evaluate(() => window.systemManagerFixture.listeners())).toBe(0);
  } finally {
    await application?.close().catch(() => {});
    await removeDesktopFixture(directory, { recursive: true, force: true });
  }
});

test("workflow: Scheduling Service lifecycle uses verified native status and preserves history", async () => {
  test.skip(
    process.platform !== "linux",
    "Fake systemd boundary is Linux-only; never install a host service",
  );
  test.setTimeout(120_000);
  const directory = await mkdtemp(join(tmpdir(), "code60-service-ui-"));
  const supervisor = await nativeSupervisorFixture(directory);
  const stateRoot = join(directory, "state/code60/automations");
  const registration = join(stateRoot, "registration.json");
  const definition = join(directory, "home/.config/systemd/user/code60-scheduler.service");
  const saved = async () => JSON.parse(await readFile(join(stateRoot, "state.json"), "utf8"));
  let application: Awaited<ReturnType<typeof launchDesktop>> | undefined;
  try {
    await mkdir(join(directory, "config/code60"), { recursive: true });
    await writeFile(
      join(directory, "config/code60/config.json"),
      JSON.stringify({
        agents: {
          claude: {
            command: [process.execPath, resolve(import.meta.dirname, "fixtures/fake-agent.mjs")],
          },
        },
      }),
    );
    application = await launchDesktop(
      directory,
      directory,
      join(directory, "unused.sqlite"),
      false,
      supervisor.environment,
    );
    await application.evaluate(({ dialog }) => {
      const scope = globalThis as typeof globalThis & {
        serviceDialogs?: {
          response: number;
          observed: { message?: string; buttons?: string[]; defaultId?: number }[];
        };
      };
      scope.serviceDialogs = { response: 1, observed: [] };
      dialog.showMessageBox = async (options) => {
        if (!("message" in options)) throw new Error("Expected native confirmation options");
        scope.serviceDialogs?.observed.push({
          message: options.message,
          buttons: options.buttons ?? [],
          defaultId: options.defaultId ?? -1,
        });
        return { response: scope.serviceDialogs?.response ?? 0, checkboxChecked: false };
      };
    });
    const page = await application.firstWindow();
    const wizard = page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Claude", exact: true }).click();
    await expect(wizard.getByRole("status")).toHaveText("Claude connected");
    await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    const openManager = async () => {
      await page.locator("#tab-apps").press("ArrowRight");
      await page.locator("#tab-system-manager").click();
    };
    await openManager();
    const panel = page.locator("#panel-system-manager");
    const badge = panel.locator(".automation-service-badge");
    const button = (name: string) => panel.getByRole("button", { name, exact: true });
    const setResponse = async (response: number) =>
      application?.evaluate((_electron, response) => {
        const state = (globalThis as typeof globalThis & { serviceDialogs?: { response: number } })
          .serviceDialogs;
        if (state) state.response = response;
      }, response);
    for (const theme of ["light", "dark"]) {
      await page.locator("#tab-settings").press("ArrowRight");
      await page.locator("#tab-settings-appearance").click();
      await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption(theme);
      await openManager();
      await expect(badge).toHaveText("Not installed");
      await expect(badge).toHaveCSS("border-style", "dashed");
      await expect(button("Start")).toHaveCount(0);
      await expect(button("Stop")).toHaveCount(0);
      await page.screenshot({
        path: test.info().outputPath(`scheduling-not-installed-${theme}.png`),
      });
      const beforeRegistration = await readFile(registration, "utf8").catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return null;
      });
      await setResponse(0);
      await button("Install").click();
      await expect(button("Install")).toBeEnabled();
      await expect(badge).toHaveText("Not installed");
      expect(
        await readFile(registration, "utf8").catch((error) => {
          if (error.code !== "ENOENT") throw error;
          return null;
        }),
      ).toBe(beforeRegistration);
      await setResponse(1);
      await button("Install").click();
      await expect(badge).toHaveText("Running");
      expect(JSON.parse(await readFile(registration, "utf8")).installed).toBe(true);
      // Stop/uninstall intentionally persist pausedAll; installation never resumes jobs.
      if (await panel.getByRole("button", { name: "Resume jobs", exact: true }).isVisible())
        await panel.getByRole("button", { name: "Resume jobs", exact: true }).click();
      expect(await readFile(definition, "utf8")).toContain("code60");
      const evidence = await saved();
      await page.screenshot({ path: test.info().outputPath(`scheduling-running-${theme}.png`) });
      await expect(button("Pause all and cancel active work")).toHaveCount(0);
      await expect(panel.locator(".automation-service-actions > .primary")).toHaveText("Stop");
      await button("Stop").click();
      await expect(badge).toHaveText("Stopped");
      await expect(badge).toHaveCSS("border-style", "solid");
      await expect(button("Start")).toBeEnabled();
      expect(JSON.parse(await readFile(registration, "utf8")).installed).toBe(true);
      expect(await readFile(definition, "utf8")).toContain("code60");
      expect((await saved()).executions).toEqual(evidence.executions);
      expect((await saved()).automations).toEqual(evidence.automations);
      await page.screenshot({ path: test.info().outputPath(`scheduling-stopped-${theme}.png`) });
      await button("Start").click();
      await expect(badge).toHaveText("Running");
      await expect(panel.getByRole("status")).toContainText("Jobs paused");
      expect((await saved()).pausedAll).toBe(true);
      await expect(button("Stop")).toBeVisible();
      await expect(button("Pause all and cancel active work")).toHaveCount(0);
      await button("Resume jobs").click();
      await expect(panel.getByRole("status")).not.toContainText("Jobs paused");
      await panel.getByText("Service options", { exact: true }).click();
      await setResponse(0);
      await button("Uninstall").click();
      await expect(button("Uninstall")).toBeEnabled();
      await expect(badge).toHaveText("Running");
      await setResponse(1);
      await button("Uninstall").click();
      await expect(badge).toHaveText("Not installed");
      expect(JSON.parse(await readFile(registration, "utf8")).installed).toBe(false);
      await expect(readFile(definition)).rejects.toMatchObject({ code: "ENOENT" });
      expect((await saved()).executions).toEqual(evidence.executions);
      expect((await saved()).automations).toEqual(evidence.automations);
    }
    // The service works without a database; the shared polling controls require one.
    const database = join(directory, "polling.sqlite");
    await application.evaluate(({ dialog }, database) => {
      dialog.showSaveDialog = async (options) => {
        if (!("title" in options) || options.title !== "Create database")
          throw new Error("Expected Create database native dialog");
        return { canceled: false, filePath: database };
      };
    }, database);
    await page.getByRole("button", { name: "Connect to database", exact: true }).click();
    const databases = page.getByRole("dialog", { name: "Select database", exact: true });
    await databases.getByRole("button", { name: "Create database…", exact: true }).click();
    await expect(databases).toHaveCount(0);
    expect((await readFile(database)).subarray(0, 16).toString()).toBe("SQLite format 3\0");
    await openManager();
    await page.getByRole("button", { name: "Open polling controls", exact: true }).click();
    let pollingDialog = page.getByRole("dialog", { name: "Polling controls", exact: true });
    await pollingDialog.getByRole("button", { name: "Pause polling", exact: true }).click();
    await expect(
      pollingDialog.getByRole("button", { name: "Start polling", exact: true }),
    ).toBeVisible();
    await pollingDialog
      .getByRole("button", { name: "Close Polling controls", exact: true })
      .click();
    await expect(pollingDialog).toHaveCount(0);
    await writeFile(join(directory, "supervisor-unavailable"), "test boundary unavailable\n");
    await page.getByRole("button", { name: "Open polling controls", exact: true }).click();
    pollingDialog = page.getByRole("dialog", { name: "Polling controls", exact: true });
    await pollingDialog.getByRole("button", { name: "Start polling", exact: true }).click();
    await pollingDialog
      .getByRole("button", { name: "Close Polling controls", exact: true })
      .click();
    await expect(pollingDialog).toHaveCount(0);
    await expect(badge).toHaveText("Status unavailable", { timeout: 10_000 });
    await expect(button("Install")).toHaveCount(0);
    await unlink(join(directory, "supervisor-unavailable"));
    await expect(badge).toHaveText("Not installed", { timeout: 10_000 });
    await page.locator("#tab-settings").press("ArrowRight");
    await page.locator("#tab-settings-text").click();
    await page
      .getByRole("group", { name: "Card Titles", exact: true })
      .getByLabel("Font size")
      .fill("32");
    await openManager();
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setMinimumSize(640, 480);
      window?.setSize(640, 800);
    });
    await page.locator(".sidebar-toggle").click();
    await expect(panel.locator("#automation-service-title")).toHaveCSS("font-size", "32px");
    await button("Install").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(button("Install")).toBeFocused();
    await expect(button("Install")).toHaveCSS("outline-width", "2px");
    for (const media of [
      { reducedMotion: "reduce" as const, forcedColors: "none" as const },
      { reducedMotion: "no-preference" as const, forcedColors: "active" as const },
    ]) {
      await page.emulateMedia(media);
      await page.screenshot({
        path: test.info().outputPath(`scheduling-narrow-${media.forcedColors}.png`),
      });
      expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      if (media.forcedColors === "active")
        await expect(panel.locator(".automation-service")).toHaveCSS("box-shadow", "none");
    }
    const dialogs = await application.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            serviceDialogs?: {
              observed: { message?: string; buttons?: string[]; defaultId?: number }[];
            };
          }
        ).serviceDialogs?.observed,
    );
    expect(dialogs?.length).toBeGreaterThan(0);
    expect(
      dialogs?.every(
        (dialog) =>
          dialog.message?.endsWith("Scheduling Service?") &&
          dialog.buttons?.join(",") === "Cancel,Confirm" &&
          dialog.defaultId === 0,
      ),
    ).toBe(true);
  } finally {
    await supervisor.cleanup();
    await application?.close().catch(() => {});
    await removeDesktopFixture(directory, { recursive: true, force: true });
  }
});
