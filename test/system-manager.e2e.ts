import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { build } from "vite";
import { launchDesktop, removeDesktopFixture } from "./electron-launcher.js";

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
    await expect(service).toHaveText("Service unavailable");
    await expect(page.getByRole("alert")).toContainText("Scheduler unavailable");
    await page.getByRole("button", { name: "Install service", exact: true }).click();
    await expect(service).toHaveText("Installed and running");
    expect(await requests()).toContainEqual({ action: "scheduler", control: "install" });
    await page.evaluate(() => window.systemManagerFixture.publish({ activeExecutionId: "active" }));
    await expect(service).toContainText("A run is active");
    await page.getByRole("button", { name: "Pause all and cancel active work" }).click();
    await expect(service).toHaveText("Installed, all automations paused");
    expect(await requests()).toContainEqual({ action: "pauseAll", cancelActive: true });
    await page.getByRole("button", { name: "Resume all", exact: true }).click();
    await expect(service).toHaveText("Installed and running");
    expect(await requests()).toContainEqual({ action: "resumeAll" });
    await page.getByText("Service options", { exact: true }).click();
    for (const control of ["install", "repair", "start", "stop", "uninstall"] as const) {
      await page.getByRole("button", { name: new RegExp(`^${control}$`, "i") }).click();
      await expect
        .poll(async () => (await requests()).at(-2))
        .toEqual({
          action: "scheduler",
          control,
        });
      await expect(service).toHaveText(
        control === "stop" || control === "uninstall"
          ? "Service unavailable"
          : "Installed and running",
      );
    }
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
    await expect(service).toHaveText("Installed and running");
    await page.evaluate(() => window.systemManagerFixture.releaseRead());
    await expect(service).toHaveText("Installed and running");
    expect((await requests()).length).toBe(count + 1);
    // A mutation stays single-flight over hide/show and refreshes the current active view.
    await page.evaluate(() => {
      window.systemManagerFixture.holdActions = true;
    });
    await page.getByRole("button", { name: "Pause all and cancel active work" }).click();
    await toggle.click();
    await toggle.click();
    await expect(
      page.getByRole("button", { name: "Pause all and cancel active work" }),
    ).toBeDisabled();
    const pending = (await requests()).filter((request) => request.action === "pauseAll").length;
    await page.evaluate(() => window.systemManagerFixture.releaseAction());
    await expect(service).toHaveText("Installed, all automations paused");
    await expect(page.getByRole("button", { name: "Resume all", exact: true })).toBeEnabled();
    expect((await requests()).filter((request) => request.action === "pauseAll")).toHaveLength(
      pending,
    );
    await toggle.click();
    expect(await page.evaluate(() => window.systemManagerFixture.listeners())).toBe(0);
  } finally {
    await application?.close().catch(() => {});
    await removeDesktopFixture(directory, { recursive: true, force: true });
  }
});
