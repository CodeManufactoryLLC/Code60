import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { DEFAULT_CONFIG } from "../src/core/index.js";
import { DesktopLogStore } from "../src/desktop/log-store.js";
import { privateDirectory } from "../src/platform/index.js";
import { launchDesktop, removeDesktopFixture } from "./electron-launcher.js";
import { verifiedAgents } from "./fixtures/verified-agents.js";

const root = resolve(import.meta.dirname, "..");
async function openLogs(page: Page) {
  const tables = page.getByRole("button", { name: "Tables", exact: true });
  if ((await tables.getAttribute("aria-expanded")) === "false") await tables.click();
  await page.getByRole("tab", { name: "Logs", exact: true }).click();
  await expect(page.locator("#panel-logs")).toBeVisible();
}
test("desktop: app-wide Logs query retained history, preserve paused reading, and survive reload/restart", async () => {
  test.setTimeout(90000);
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-log-view-")));
  const database = join(directory, "projects.sqlite");
  const config = {
    ...DEFAULT_CONFIG,
    agents: {
      ...DEFAULT_CONFIG.agents,
      claude: {
        command: [process.execPath, join(root, "test/fixtures/fake-agent.mjs")] as [
          string,
          ...string[],
        ],
      },
    },
  };
  const configFile = join(directory, "config", "code60", "config.json");
  await mkdir(dirname(configFile), { recursive: true });
  await writeFile(configFile, JSON.stringify({ agents: { claude: config.agents.claude } }));
  await privateDirectory(join(directory, "state", "code60"));
  await writeFile(
    join(directory, "state", "code60", "desktop.json"),
    JSON.stringify({
      orchestrationProvider: "claude",
      agentSetup: verifiedAgents(config, "claude"),
    }),
  );
  const store = new DesktopLogStore(join(directory, "state", "code60", "logs"));
  for (let index = 0; index < 140; index++)
    store.sink({
      event: "turn.end",
      operationId: randomUUID(),
      outcome: "succeeded",
      runId: `retained-${index}`,
      provider: "claude",
    });
  await store.close();
  let application = await launchDesktop(directory, directory, database);
  try {
    let page = await application.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.locator(".splash").getByRole("button", { name: "Start", exact: true }).click();
    await openLogs(page);
    const logs = page.locator("#panel-logs");
    await expect(logs.getByRole("heading", { name: "Logs", exact: true })).toBeVisible();
    expect((await page.evaluate(() => window.desktop.snapshot())).database).toBeNull();
    await expect(logs.getByRole("button", { name: "Older page", exact: true })).toBeEnabled();
    await logs.getByRole("button", { name: "Older page", exact: true }).click();
    await expect(logs.getByText("Page 2", { exact: true })).toBeVisible();
    await logs.getByRole("button", { name: "Search logs", exact: true }).click();
    const search = logs.getByRole("textbox", { name: "Search retained logs" });
    await search.fill("retained-139");
    await search.press("Enter");
    await expect(logs.getByText("Page 1", { exact: true })).toBeVisible();
    await expect(logs.getByRole("button", { name: "Older page", exact: true })).toBeDisabled();
    await logs.getByLabel("Current app launch only").check();
    await expect(logs.getByText("No diagnostic logs match these filters.")).toBeVisible();
    await search.fill("retained-138");
    await search.press("Enter");
    await expect(logs.getByText("No diagnostic logs match these filters.")).toBeVisible();
    await logs.getByLabel("Current app launch only").uncheck();
    await expect(logs.getByText("No diagnostic logs match these filters.")).toHaveCount(0);
    await search.fill("retained-139");
    await search.press("Enter");
    const canvas = logs.getByTestId("data-grid-canvas");
    await canvas.focus();
    await canvas.press("ArrowDown");
    await canvas.press("Enter");
    const detail = page.getByRole("dialog", { name: "Log record", exact: true });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("retained-139");
    await detail.getByRole("button", { name: "Copy record", exact: true }).click();
    await expect(detail.getByRole("status")).toHaveText("Record copied.");
    await page.keyboard.press("Escape");
    await logs.getByRole("button", { name: "Close search", exact: true }).click();
    await logs.getByRole("button", { name: "Filters", exact: true }).click();
    const filters = page.getByRole("dialog", { name: "Filters", exact: true });
    await filters.getByRole("button", { name: "New filter", exact: true }).click();
    await filters.getByLabel("Filter name").fill("Only retained turn");
    await filters.getByLabel("Column").selectOption("runId");
    await filters.getByLabel("Comparison").selectOption("eq");
    await filters.getByLabel("Condition 1 value").fill("retained-139");
    await filters.getByRole("button", { name: "Save filter", exact: true }).click();
    await expect(filters.getByRole("status")).toHaveText("Apply to search all retained history.");
    await filters.getByRole("button", { name: "Apply filter", exact: true }).click();
    await filters.getByRole("button", { name: "Close", exact: true }).click();
    await expect(logs.getByRole("button", { name: "Older page", exact: true })).toBeDisabled();
    await logs.getByRole("button", { name: "Unapply filter", exact: true }).click();
    const scroller = logs.locator(".dvn-scroller");
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollHeight))
      .toBeGreaterThan(1000);
    await scroller.evaluate((element) => {
      element.scrollTop = 600;
    });
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await logs.getByRole("button", { name: "Pause viewing", exact: true }).click();
    await page.evaluate(() => window.desktop.connectDatabase("create"));
    await expect(logs.getByText("Viewing paused. Diagnostic capture continues.")).toBeVisible();
    await expect(
      logs.getByRole("button", { name: "New records available, show latest" }),
    ).toBeVisible();
    await logs.getByRole("button", { name: "Resume viewing", exact: true }).click();
    // Resume preserves a scrolled reader; explicitly accept the pending latest page.
    const latest = logs.getByRole("button", { name: "New records available, show latest" });
    await expect(latest).toBeVisible();
    await latest.click();
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
    await expect(logs.getByRole("button", { name: "Refresh logs", exact: true })).toBeVisible();
    const retained = await page.evaluate(() =>
      window.desktop.queryLogs({
        scope: "all",
        limit: 1,
        search: "retained-139",
        conditions: [],
        columnConditions: [],
        match: "all",
      }),
    );
    const id = retained.records[0]?.id;
    expect(id).toBeTruthy();
    for (const theme of ["dark", "light", "system"]) {
      await page.getByRole("tab", { name: "Settings", exact: true }).click();
      await page.getByLabel("Theme", { exact: true }).selectOption(theme);
      await openLogs(page);
      await expect(logs.getByRole("button", { name: "Search logs", exact: true })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`logs-${theme}.png`) });
    }
    await page.reload();
    await openLogs(page);
    expect(
      await page.evaluate((id) => window.desktop.logDetail({ id: id as string }), id),
    ).toBeTruthy();
    await application.close();
    application = await launchDesktop(directory, directory, database);
    page = await application.firstWindow();
    await page.locator(".splash").getByRole("button", { name: "Start", exact: true }).click();
    await openLogs(page);
    expect(
      await page.evaluate((id) => window.desktop.logDetail({ id: id as string }), id),
    ).toBeTruthy();
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    await page
      .locator("#panel-logs")
      .getByRole("button", { name: "Clear logs", exact: true })
      .click();
    expect(
      await page.evaluate((id) => window.desktop.logDetail({ id: id as string }), id),
    ).toBeTruthy();
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await page
      .locator("#panel-logs")
      .getByRole("button", { name: "Clear logs", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate((id) => window.desktop.logDetail({ id: id as string }), id))
      .toBeNull();
    expect((await readFile(database)).byteLength).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } finally {
    await application.close();
    await removeDesktopFixture(directory, { recursive: true, force: true });
  }
});
