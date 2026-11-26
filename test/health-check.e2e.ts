import { expect, test } from "@playwright/test";
import { expandNavigation } from "./fixtures/browser-actions.js";
import { browserApp, onboard } from "./fixtures/browser-app.js";

test("browser: Health Check runs passive checks, supports granular rechecks and redacts copied reports by default", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const fixture = await browserApp(browser, [], false);
  const errors: string[] = [];
  try {
    const local = await fixture.open();
    local.page.on("pageerror", (error) => errors.push(error.message));
    await local.page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await onboard(local.page);

    await expandNavigation(local.page, "Manage");
    await local.page.locator("#tab-health-check").click();

    const page = local.page.locator("section.health-check-page");
    await expect(page).toBeVisible();
    await expect(page.getByRole("heading", { name: "System health", exact: true })).toBeVisible();

    // Wait for passive checks to settle without requiring a database.
    const backendCard = page.locator('[data-check-id="backend-connection"]');
    await expect(backendCard).toHaveAttribute("data-status", "healthy", { timeout: 15_000 });
    await expect(page.locator('[data-check-id="backend-version"]')).toHaveAttribute(
      "data-status",
      "healthy",
    );
    await expect(page.locator('[data-check-id="scheduler-status"]')).toHaveAttribute(
      "data-status",
      "healthy",
    );
    await expect(page.locator('[data-check-id="database-health"]')).toHaveAttribute(
      "data-status",
      "not_configured",
    );
    await expect(page.locator('[data-check-id="disk-space"]')).not.toHaveAttribute(
      "data-status",
      "not_checked",
    );
    // Active provider auth probe must remain not_checked until explicitly requested.
    await expect(page.locator('[data-check-id="providers-authenticated"]')).toHaveAttribute(
      "data-status",
      "not_checked",
    );

    // Progress bar above the System Health tile shows completed count, percentage, and proportional status segments.
    const progress = page.locator(".health-progress-section");
    await expect(progress).toBeVisible();
    await expect(progress.locator(".health-progress-numbers")).toContainText("17 of 18");
    await expect(progress.locator(".health-progress-numbers")).toContainText("94%");
    await expect(progress.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "17");
    await expect(progress.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "18");
    await expect(progress.locator('[data-segment="healthy"]')).toBeVisible();
    await expect(progress.locator('[data-segment="warning"]')).toBeVisible();

    // System Health tile displays Carbon IconIndicator status metrics, last completed timestamp, and one completion toast.
    const kpiGrid = page.getByLabel("Health status breakdown");
    await expect(kpiGrid.locator('[data-metric="healthy"]')).toBeVisible();
    await expect(kpiGrid.locator('[data-metric="warning"]')).toBeVisible();
    await expect(kpiGrid.locator('[data-metric="error"]')).toBeVisible();
    await expect(kpiGrid.locator('[data-metric="not_checked"]')).toContainText("1");
    await expect(page.locator(".cds--icon-indicator").first()).toBeVisible();
    await expect(page.getByTestId("health-last-completed")).toContainText("Last completed:");
    await expect(page.getByTestId("health-last-completed")).not.toContainText("Not yet completed");
    const notifications = local.page.getByRole("region", { name: "Notifications" });
    const toasts = notifications.locator(".carbon-toast-owner");
    await expect(toasts).toHaveCount(1);
    await expect(toasts).toContainText("Health check complete:");

    // Toolbar uses Carbon Dropdowns (no native <select>) and does not overlap the table header.
    await expect(page.locator(".health-toolbar-filter select")).toHaveCount(0);
    await expect(page.locator(".health-toolbar-filter .cds--dropdown")).toHaveCount(2);
    for (const heading of [
      "Status",
      "Check",
      "Category",
      "Items",
      "Mode",
      "Summary",
      "Checked",
      "Actions",
    ]) {
      await expect(page.getByRole("columnheader", { name: heading, exact: true })).toBeVisible();
    }
    const toolbarBox = await page.locator(".cds--table-toolbar").boundingBox();
    const theadBox = await page.locator(".cds--data-table thead").boundingBox();
    expect(toolbarBox).not.toBeNull();
    expect(theadBox).not.toBeNull();
    if (toolbarBox && theadBox) {
      expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(theadBox.y + 1);
    }

    // Expand a multi-target check row (Machine disk space) and verify its nested StructuredList and success-green available space meter.
    await page.getByRole("button", { name: "Expand Machine disk space", exact: true }).click();
    await expect(page.locator(".health-target-list")).toBeVisible();
    const diskMeterBar = page.locator(".health-target-meter .cds--progress-bar__bar").first();
    await expect(diskMeterBar).toBeVisible();
    await expect(diskMeterBar).toHaveCSS("background-color", "rgb(36, 161, 72)");

    // Granular recheck of a single check row triggers a targeted completion toast.
    await page.getByRole("button", { name: "Recheck Machine disk space", exact: true }).click();
    await expect(page.locator('[data-check-id="disk-space"]')).not.toHaveAttribute(
      "data-status",
      "running",
    );
    await expect(local.page.getByRole("region", { name: "Notifications" })).toContainText(
      "Machine disk space complete:",
    );
    await expect(page.locator('[data-check-id="providers-authenticated"]')).toHaveAttribute(
      "data-status",
      "not_checked",
    );

    // Copy redacted report by default (no hostname or IP addresses).
    await page.getByRole("button", { name: "Copy health report", exact: true }).click();
    await expect(page.locator(".health-copy-status")).toContainText(
      "Redacted health report copied",
    );
    const redacted = await local.page.evaluate(() => navigator.clipboard.readText());
    expect(redacted).toContain("# Code60 Health Report");
    expect(redacted).toContain("Redacted (host & network identifiers omitted)");
    expect(redacted).not.toContain("Hostname:");
    expect(redacted).not.toContain("Local IPs:");

    // Opt in to host & network details and verify report includes them.
    await page.getByText(/Include host & network details/).click();
    await expect(page.getByLabel(/Include host & network details/)).toBeChecked();
    await page.getByRole("button", { name: "Copy health report", exact: true }).click();
    await expect(page.locator(".health-copy-status")).toContainText("Full health report copied");
    const full = await local.page.evaluate(() => navigator.clipboard.readText());
    expect(full).toContain("Hostname:");
    expect(full).toContain("Local IPs:");

    await local.page.screenshot({
      path: test.info().outputPath("health-check-page.png"),
      fullPage: true,
    });

    // Switch to the Environment Carbon tab and verify OS and local IP structured list.
    await page.getByRole("tab", { name: "Environment", exact: true }).click();
    const envList = page.locator(".health-environment-list");
    await expect(envList).toBeVisible();
    await expect(envList).toContainText("Operating system");
    await expect(envList).toContainText("Local IP addresses");
    await local.page.screenshot({
      path: test.info().outputPath("health-check-environment.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});
