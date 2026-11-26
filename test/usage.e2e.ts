import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { expandNavigation } from "./fixtures/browser-actions.js";
import { browserApp, onboard } from "./fixtures/browser-app.js";

test("browser: Usage page records live turns, supports hotspot drill-down, export, CLI read, and confirmed clear", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const fixture = await browserApp(browser, [], false);
  const errors: string[] = [];
  try {
    const local = await fixture.open();
    local.page.on("pageerror", (error) => errors.push(error.message));
    await onboard(local.page);

    // Send one real turn in Relay so the ACP boundary records a live usage turn.
    const composer = local.page
      .locator(".orchestration-chat-page:visible")
      .getByRole("textbox", { name: "Message to orchestrator", exact: true });
    await expect(composer).toBeEditable({ timeout: 15_000 });
    await composer.fill("Summarize the workspace layout");
    await composer.press("Enter");
    await expect(local.page.getByText("Summarize the workspace layout").first()).toBeVisible({
      timeout: 15_000,
    });

    // Open Manage -> Usage without needing a database (updates live via usage-changed SSE).
    await expandNavigation(local.page, "Manage");
    await local.page.locator("#tab-usage").click();

    const page = local.page.locator("section.usage-page");
    await expect(page).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Burn rate by provider and model" }),
    ).toBeVisible();
    // Should record at least 1 turn from the Relay exchange.
    await expect(page.locator("table[aria-label='Provider burn rate']")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("table[aria-label='Provider burn rate']")).toContainText("claude");

    // Uses Carbon Dropdowns (no native <select>).
    await expect(page.locator(".usage-filters select")).toHaveCount(0);
    await expect(page.locator(".usage-filters .cds--dropdown")).toHaveCount(3);

    // Switch to Chats & workflows tab and drill into Turn inspector.
    await page.getByRole("tab", { name: "Chats & workflows" }).click();
    await expect(page.locator("table[aria-label='Usage by surface']")).toContainText("Relay");
    await page.getByRole("button", { name: "Inspect turns" }).first().click();

    // Turn inspector opens scoped to the hotspot and expands calculation details.
    await expect(page.locator(".usage-scope-banner")).toBeVisible();
    await expect(page.locator("table[aria-label='Turn-level usage audit log']")).toBeVisible();
    await page
      .getByRole("button", { name: /Inspect turn/i })
      .first()
      .click();
    await expect(page.getByText("Estimation Breakdown")).toBeVisible();
    await expect(page.getByText("Context & Tools")).toBeVisible();

    // Export Markdown triggers download toast.
    await page.getByRole("button", { name: "Export Markdown" }).click();
    await expect(local.page.getByRole("region", { name: "Notifications" })).toContainText(
      /Exported code60-usage-.*\.md/,
    );

    // Verify `code60 usage --format json` reads the same live gateway data from CLI.
    const cliOutput = execFileSync(
      process.execPath,
      [join(process.cwd(), "dist/management/main.js"), "usage", "--format", "json"],
      { env: fixture.env, encoding: "utf8" },
    );
    const cliParsed = JSON.parse(cliOutput);
    expect(cliParsed.report.totals.turns).toBeGreaterThanOrEqual(1);
    expect(
      cliParsed.report.providers.some((p: { provider: string }) => p.provider === "claude"),
    ).toBe(true);

    // Clear usage history via page actions menu and confirmation dialog.
    await local.page.getByRole("button", { name: "Usage actions", exact: true }).click();
    await local.page.getByRole("menuitem", { name: "Clear usage history", exact: true }).click();
    const dialog = local.page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Clear usage history", exact: true }).click();
    await expect(local.page.getByRole("region", { name: "Notifications" })).toContainText(
      /Cleared \d+ usage records/,
    );

    expect(errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});
