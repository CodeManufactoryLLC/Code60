import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

export async function expandNavigation(
  page: Page,
  group:
    | "Automate"
    | "Connect"
    | "Context"
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

export async function openChat(page: Page) {
  await page
    .getByRole("navigation", { name: "Product navigation" })
    .getByRole("tab", { name: "Chat", exact: true })
    .click();
  await expect(page.locator("cds-aichat-history-shell")).toBeVisible();
}

export async function openNewChatModal(page: Page) {
  if (!(await page.locator("cds-aichat-history-toolbar").isVisible())) {
    await openChat(page);
  }
  await page.locator("cds-aichat-history-toolbar cds-icon-button").click();
  const dialog = page.getByRole("dialog", { name: "New chat", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
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
/** A fresh verified browser opens an existing, retained project through visible controls. */
export async function reopenRetainedProject(page: Page, directory: string, database: string) {
  await expect(page.getByRole("banner", { name: "Code60", exact: true })).toBeVisible();
  await expect(page.locator(".agent-setup-dialog")).toHaveCount(0);
  await expect
    .poll(async () => (await page.evaluate(() => window.code60.snapshot())).database)
    .toBe(database);
  const newChat = await openNewChatModal(page);
  await newChat.getByRole("button", { name: "Open Project Folder", exact: true }).click();
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
  await openChat(page);
  await expect(
    page
      .locator(".orchestration-chat-page:visible")
      .getByRole("textbox", { name: "Message to orchestrator", exact: true }),
  ).toBeEditable();
}
export async function createDatabase(page: Page, directory: string) {
  const connect = page.getByRole("button", { name: "Connect to database", exact: true });
  if (await connect.isVisible()) {
    await connect.click();
  } else {
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    await page.getByRole("button", { name: "Select or create database" }).click();
  }
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
  const newChat = await openNewChatModal(page);
  await newChat.getByRole("button", { name: "Open Project Folder", exact: true }).click();
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

export async function newProjectSession(page: Page, name: string) {
  const newChat = await openNewChatModal(page);
  const row = newChat.locator(".chat-history-project-row").filter({ hasText: name }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "New Session", exact: true }).click();
}
