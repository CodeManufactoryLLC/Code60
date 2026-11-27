import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { expandNavigation } from "./fixtures/browser-actions.js";
import {
  browserApp,
  createDatabase,
  newProjectSession,
  onboard,
  openProject,
} from "./fixtures/browser-app.js";

test("browser: right sidebar terminal opens in project folder and appears in System Manager Terminals", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  const projectName = "demo-project";
  const projectDir = join(fixture.directory, projectName);
  try {
    await mkdir(projectDir);
    const { page } = await fixture.open();
    await onboard(page);
    await createDatabase(page, fixture.directory);
    await openProject(page, fixture.directory, projectName);
    await newProjectSession(page, projectName);

    // Open the right sidebar on the open project's chat.
    const toggle = page.getByRole("button", { name: "Toggle files panel", exact: true });
    await toggle.click();
    await page.getByRole("button", { name: "Open Terminal", exact: true }).click();

    const terminalRegion = page.locator(".terminal-panel").first();
    await expect(terminalRegion).toBeVisible();
    await expect(terminalRegion.locator(".terminal-viewport")).toHaveAttribute(
      "data-terminal-state",
      "running",
      { timeout: 15_000 },
    );
    await expect(terminalRegion.locator(".terminal-cwd")).toHaveAttribute("title", projectDir);
    await expect(terminalRegion.locator(".terminal-cwd")).toContainText(projectName);

    // Type a command into xterm and confirm real shell execution in the project directory.
    await terminalRegion.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("pwd && echo CODE60_BROWSER_TERM_OK");
    await page.keyboard.press("Enter");
    await expect(terminalRegion).toContainText("CODE60_BROWSER_TERM_OK", { timeout: 15_000 });

    // Navigate to System Manager -> Terminals and verify the active session and associated project.
    await expandNavigation(page, "Manage");
    await page.getByRole("tab", { name: "System Manager", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Services", exact: true })).toBeVisible();
    const terminalsTab = page.getByRole("tab", { name: /Terminals \(1\)/ });
    await expect(terminalsTab).toBeVisible({ timeout: 10_000 });
    await terminalsTab.click();

    const item = page.locator(".system-manager-terminal-item").first();
    await expect(item).toBeVisible();
    await expect(item).toContainText(projectName);
    await expect(item.locator(".system-manager-terminal-path")).toHaveAttribute(
      "title",
      projectDir,
    );

    // Close the terminal from System Manager and confirm the list becomes empty.
    await item.getByRole("button", { name: "Close terminal", exact: true }).click();
    await expect(page.getByText("No active terminal sessions.")).toBeVisible({ timeout: 10_000 });
  } finally {
    await fixture.close();
  }
});
