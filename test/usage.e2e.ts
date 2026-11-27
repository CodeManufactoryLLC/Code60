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
    await expect(page.locator(".cds--tile")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Summary" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "By Provider" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "By Model" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "By Surface" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "By Turn" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "By Workflow" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "By Session" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Usage Timeline" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Export" })).toBeVisible();

    // By Provider opens first with a TOTAL row at the top and the live recorded provider.
    const providerTable = page.locator("table[aria-label='Usage by provider']");
    await expect(providerTable).toBeVisible({ timeout: 15_000 });
    await expect(providerTable.locator("tbody tr").first()).toContainText("TOTAL");
    await expect(providerTable).toContainText("claude");

    // By Model shows a TOTAL row at the top and model usage.
    await page.getByRole("tab", { name: "By Model" }).click();
    const modelTable = page.locator("table[aria-label='Usage by model']");
    await expect(modelTable).toBeVisible();
    await expect(modelTable.locator("tbody tr").first()).toContainText("TOTAL");

    // By Surface shows a TOTAL row at the top and Relay surface usage.
    await page.getByRole("tab", { name: "By Surface" }).click();
    const surfaceTable = page.locator("table[aria-label='Usage by surface']");
    await expect(surfaceTable).toBeVisible();
    await expect(surfaceTable.locator("tbody tr").first()).toContainText("TOTAL");
    await expect(surfaceTable).toContainText("Relay");

    // Uses Carbon Dropdowns (no native <select>) with no UA list bullets/indentation.
    await expect(page.locator(".usage-filters select")).toHaveCount(0);
    await expect(page.locator(".usage-filters .cds--dropdown")).toHaveCount(4);
    await expect(page.locator(".usage-filters #usage-confidence-select")).toBeVisible();
    await expect(page.locator("[role='tabpanel'] #usage-confidence-select")).toHaveCount(0);
    const rangeTrigger = page.locator("#usage-range-select button.cds--list-box__field");
    await rangeTrigger.click();
    const rangeMenu = page.locator("#usage-range-select .cds--list-box__menu");
    await expect(rangeMenu).toBeVisible();
    const menuStyle = await rangeMenu.evaluate((el) => {
      const style = getComputedStyle(el);
      const item = el.querySelector(".cds--list-box__menu-item");
      const itemStyle = item ? getComputedStyle(item) : null;
      return {
        listStyleType: style.listStyleType,
        paddingLeft: style.paddingLeft,
        marginTop: style.marginTop,
        itemListStyleType: itemStyle?.listStyleType ?? null,
      };
    });
    expect(menuStyle).toEqual({
      listStyleType: "none",
      paddingLeft: "0px",
      marginTop: "0px",
      itemListStyleType: "none",
    });
    await rangeTrigger.press("Escape");

    // By Session shows a TOTAL row at the top and drills into By Turn.
    await page.getByRole("tab", { name: "By Session" }).click();
    const sessionTable = page.locator("table[aria-label='Usage by session']");
    await expect(sessionTable).toBeVisible();
    await expect(sessionTable.locator("tbody tr").first()).toContainText("TOTAL");
    await sessionTable.getByRole("button", { name: "Inspect turns" }).first().click();

    // By Turn opens scoped to the session with a TOTAL row at the top and expandable details.
    await expect(page.locator(".usage-scope-banner")).toBeVisible();
    const turnTable = page.locator("table[aria-label='Usage by turn']");
    await expect(turnTable).toBeVisible();
    await expect(turnTable.locator("tbody tr").first()).toContainText("TOTAL");
    await page
      .getByRole("button", { name: /Inspect turn/i })
      .first()
      .click();
    await expect(page.getByText("Estimation Breakdown")).toBeVisible();
    await expect(page.getByText("Context & Tools")).toBeVisible();

    // Switch to Usage Timeline tab and verify timeline renders without the old heading.
    await page.getByRole("tab", { name: "Usage Timeline" }).click();
    await expect(page.locator(".usage-timeline-bars")).toBeVisible();
    await expect(page.getByText("Burn timeline")).toHaveCount(0);

    // Switch to Export tab and trigger Markdown download toast.
    await page.getByRole("tab", { name: "Export" }).click();
    await expect(page.getByRole("button", { name: "Markdown", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "JSON", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "CSV", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Markdown", exact: true }).click();
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
