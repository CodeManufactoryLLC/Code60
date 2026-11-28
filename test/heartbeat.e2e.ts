import { expect, test } from "@playwright/test";
import { expandNavigation } from "./fixtures/browser-actions.js";
import { browserApp, onboard } from "./fixtures/browser-app.js";

test("browser: Heartbeat prioritizes actionable fixes, shows all actions, runs manual sweep, and records timing", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const fixture = await browserApp(browser, [], false);
  const errors: string[] = [];
  try {
    const local = await fixture.open();
    local.page.on("pageerror", (error) => errors.push(error.message));
    await onboard(local.page);

    await expandNavigation(local.page, "Manage");
    await local.page.locator("#tab-heartbeat").click();

    const page = local.page.locator("section.heartbeat-page");
    await expect(page).toBeVisible();
    await expect(page.getByRole("heading", { name: "Not yet run", exact: true })).toBeVisible();

    // All 8 heartbeat actions are visible in the audit log table.
    for (const title of [
      "Passive health sweep",
      "Disk pressure guard",
      "Scheduler drift audit",
      "Dead-owner run reconciliation",
      "Stuck run and orphan watchdog",
      "Sidecar and Relay recovery",
      "Stale temporary file cleanup",
      "Clean worktree cleanup",
    ]) {
      await expect(page.getByText(title, { exact: true })).toBeVisible();
    }

    // Manually initiate a Heartbeat sweep.
    await page
      .locator(".heartbeat-summary-controls")
      .getByRole("button", { name: "Run heartbeat" })
      .click();

    // Wait for initiation, termination, and duration to populate.
    const initiated = page.locator('[data-timing="initiated"] dd');
    const terminated = page.locator('[data-timing="terminated"] dd');
    const duration = page.locator('[data-timing="duration"] dd');
    await expect(terminated).not.toHaveText("—", { timeout: 25_000 });
    await expect(terminated).not.toHaveText("In progress…", { timeout: 25_000 });
    await expect(initiated).not.toHaveText("—");
    await expect(duration).toHaveText(/\d+\s*(ms|s|m)/);

    // Assert Sidecar and Relay recovery row completed cleanly without reporting "Memory service is stopping".
    await expect(page).not.toContainText("Memory service is stopping");

    await local.page.screenshot({
      path: test.info().outputPath("heartbeat-actions.png"),
      fullPage: true,
    });

    // Navigate to Health Check after Sweep 1 and verify Memory service remains operational on granular recheck.
    await local.page.locator("#tab-health-check").click();
    const healthPage = local.page.locator("section.health-check-page");
    await expect(healthPage).toBeVisible();
    const memoryRow = healthPage.locator('[data-check-id="memory-health"]');
    await expect(memoryRow).not.toHaveAttribute("data-status", "unavailable", { timeout: 15_000 });
    await expect(memoryRow).not.toContainText("Memory service is stopping");
    await healthPage.getByRole("button", { name: "Recheck Memory service", exact: true }).click();
    await expect(memoryRow).not.toHaveAttribute("data-status", "running", { timeout: 15_000 });
    await expect(memoryRow).not.toHaveAttribute("data-status", "unavailable");
    await expect(memoryRow).not.toContainText("Memory service is stopping");

    // Return to Heartbeat and execute a second consecutive sweep (KB-GOV-002 TEST-1.2.2).
    await local.page.locator("#tab-heartbeat").click();
    await expect(page).toBeVisible();
    await page
      .locator(".heartbeat-summary-controls")
      .getByRole("button", { name: "Run heartbeat" })
      .click();
    await expect(terminated).not.toHaveText("In progress…", { timeout: 25_000 });
    await expect(page).not.toContainText("Memory service is stopping");

    // Switch to History tab and verify both recorded sweeps are listed with their Source.
    await page.getByRole("tab", { name: "History", exact: true }).click();
    const historyTable = page.getByRole("table", { name: "Heartbeat history" });
    await expect(historyTable).toBeVisible();
    await expect(
      historyTable.getByRole("columnheader", { name: "Source", exact: true }),
    ).toBeVisible();
    await expect(historyTable.locator("tbody tr")).toHaveCount(2);
    await expect(historyTable).toContainText("Human-Triggered");

    // Switch to Policy tab and toggle scheduled heartbeat off, confirming persistence.
    await page.getByRole("tab", { name: "Policy", exact: true }).click();
    const policyToggle = page.getByRole("switch", { name: "Scheduled heartbeat", exact: true });
    await expect(policyToggle).toBeEnabled();
    await policyToggle.press("Space");
    await expect(page.locator('[data-timing="next"] dd')).toHaveText("Paused", { timeout: 10_000 });

    await local.page.screenshot({
      path: test.info().outputPath("heartbeat-policy.png"),
      fullPage: true,
    });

    expect(errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});
