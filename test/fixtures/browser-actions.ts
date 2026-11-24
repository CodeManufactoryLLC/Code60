import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

export async function expandNavigation(
  page: Page,
  group:
    | "Chat"
    | "Develop"
    | "Automate"
    | "Connect"
    | "Customize"
    | "Personalize"
    | "Manage"
    | "Contributor Tools"
    | "Experiments",
) {
  const menu = page
    .getByRole("navigation", { name: "Product navigation" })
    .getByRole("button", { name: group, exact: true });
  if ((await menu.getAttribute("aria-expanded")) === "false") await menu.click();
}

export async function openMcpServers(page: Page) {
  await expandNavigation(page, "Connect");
  await page
    .getByRole("tablist", { name: "Connect", exact: true })
    .getByRole("tab", { name: "MCP Servers", exact: true })
    .click();
}

export async function onboard(page: Page) {
  const wizard = page.locator(".agent-setup-dialog");
  await expect(wizard).toBeVisible();
  await expect(page.locator("dialog:modal")).toHaveCount(1);
  await expect(wizard.getByRole("button", { name: "Claude", exact: true })).toHaveClass(
    /cds--tile--clickable/,
  );
  await wizard.getByRole("button", { name: "Claude", exact: true }).click();
  await expect(wizard.getByRole("status")).toHaveText("Claude connected");
  await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
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
  await expandNavigation(page, "Develop");
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
    .getByRole("button", { name: "Open project", exact: true })
    .click();
  await expect
    .poll(async () => (await page.evaluate(() => window.code60.snapshot())).directory)
    .toBe(join(directory, name));
}
