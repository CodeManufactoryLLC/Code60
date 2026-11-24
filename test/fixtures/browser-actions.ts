import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

export async function onboard(page: Page) {
  const wizard = page.locator(".agent-setup-dialog");
  await expect(wizard).toBeVisible();
  await wizard.getByRole("button", { name: "Claude", exact: true }).click();
  await expect(wizard.getByRole("status")).toHaveText("Claude connected");
  await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
}
/** A fresh browser explicitly enters and opens an existing, retained project. */
export async function reopenRetainedProject(page: Page, directory: string, database: string) {
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(page.locator(".agent-setup-dialog")).toHaveCount(0);
  await expect
    .poll(async () => (await page.evaluate(() => window.code60.snapshot())).database)
    .toBe(database);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("tab", { name: "Projects", exact: true }).click();
  await page
    .locator("#panel-projects")
    .getByRole("button", { name: "New Project", exact: true })
    .click();
  const repo = join(directory, "project with spaces");
  const recent = page
    .getByRole("dialog", { name: "Open Project", exact: true })
    .getByRole("list", { name: "Recent projects", exact: true });
  const retained = recent.getByRole("button", { name: `project with spaces ${repo}`, exact: true });
  await expect(retained).toHaveCount(1);
  await retained.click();
  await page
    .getByRole("dialog", { name: "Open project?", exact: true })
    .getByRole("button", { name: "Open project", exact: true })
    .click();
  await expect
    .poll(async () => (await page.evaluate(() => window.code60.snapshot())).directory)
    .toBe(repo);
  await page.getByRole("button", { name: "Relay", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Message to orchestrator", exact: true }),
  ).toBeEditable();
}
export async function createDatabase(page: Page, directory: string) {
  await page.getByRole("button", { name: "Connect to database", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Select database", exact: true })
    .getByRole("button", { name: "Create database…", exact: true })
    .click();
  const chooser = page.getByRole("dialog", { name: "Create database", exact: true });
  await chooser.getByRole("option", { name: directory, exact: true }).dblclick();
  await chooser.getByLabel("Database filename", { exact: true }).fill("projects.sqlite");
  await chooser.getByRole("button", { name: "Create database", exact: true }).click();
  await expect(chooser).toHaveCount(0);
}
export async function openProject(page: Page, directory: string, name: string) {
  await page.getByRole("tab", { name: "Projects", exact: true }).click();
  await page
    .locator("#panel-projects")
    .getByRole("button", { name: "New Project", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Open Project", exact: true })
    .getByRole("button", { name: "Open Folder", exact: true })
    .click();
  const chooser = page.getByRole("dialog", { name: "Choose folder", exact: true });
  await chooser.getByRole("option", { name: directory, exact: true }).dblclick();
  await chooser.getByRole("option", { name, exact: true }).click();
  await chooser.getByRole("button", { name: "Choose folder", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Open project?", exact: true })
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect
    .poll(async () => (await page.evaluate(() => window.code60.snapshot())).directory)
    .toBe(join(directory, name));
}
