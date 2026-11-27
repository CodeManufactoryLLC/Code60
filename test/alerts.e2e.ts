import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { browserApp, onboard } from "./fixtures/browser-app.js";

test("browser: header Alerts bell shows unread count dot, links to destinations, and persists read/unread state", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const fixture = await browserApp(browser, [], false);
  const errors: string[] = [];
  try {
    const firstOpen = await fixture.open();
    firstOpen.page.on("pageerror", (error) => errors.push(error.message));
    await onboard(firstOpen.page);

    // Initially empty: bell is present in the upper-right header without a badge dot.
    const emptyBell = firstOpen.page.locator(".product-utilities .alert-bell-trigger");
    await expect(emptyBell).toBeVisible();
    await expect(emptyBell).toHaveAttribute("aria-label", "Alerts");
    await expect(emptyBell.locator(".alert-bell-badge")).toHaveCount(0);

    // Opening shows empty state; Escape closes and returns focus to the bell trigger.
    await emptyBell.click();
    const emptyPopover = firstOpen.page.getByRole("dialog", { name: "Alerts" });
    await expect(emptyPopover).toBeVisible();
    await expect(emptyPopover).toContainText("No alerts.");
    await firstOpen.page.keyboard.press("Escape");
    await expect(emptyPopover).toHaveCount(0);
    await expect(emptyBell).toBeFocused();
    await firstOpen.context.close();

    // Seed private backend alert state and restart gateway to verify persistence loading.
    const alertsDir = join(fixture.env.XDG_STATE_HOME, "code60", "alerts");
    await mkdir(alertsDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(alertsDir, "state.json"),
      `${JSON.stringify({
        format: 1,
        seededSchedulerHistory: true,
        dismissedKeys: [],
        alerts: [
          {
            id: "550e8400-e29b-41d4-a716-446655440101",
            dedupeKey: "event:automation-exec:e1",
            source: "automation",
            severity: "error",
            title: "Scheduled job failed: Nightly check",
            detail: "Exit code 1",
            target: { kind: "page", id: "automations" },
            read: false,
            createdAt: "2026-11-27T10:02:00.000Z",
            updatedAt: "2026-11-27T10:02:00.000Z",
          },
          {
            id: "550e8400-e29b-41d4-a716-446655440102",
            dedupeKey: "event:workflow-failed:wf1",
            source: "workflow",
            severity: "warning",
            title: "Workflow failed: Release pipeline",
            detail: "Verifier rejected build",
            target: { kind: "page", id: "health-check" },
            read: false,
            createdAt: "2026-11-27T10:01:00.000Z",
            updatedAt: "2026-11-27T10:01:00.000Z",
          },
          {
            id: "550e8400-e29b-41d4-a716-446655440104",
            dedupeKey: "live:workspace:database-error",
            source: "workspace",
            severity: "error",
            title: "Stale database error",
            target: { kind: "page", id: "health-check" },
            read: false,
            createdAt: "2026-11-27T10:00:30.000Z",
            updatedAt: "2026-11-27T10:00:30.000Z",
          },
          {
            id: "550e8400-e29b-41d4-a716-446655440103",
            dedupeKey: "event:settings:update",
            source: "system",
            severity: "info",
            title: "Check update instructions",
            target: { kind: "settings", id: "updates" },
            read: true,
            createdAt: "2026-11-27T10:00:00.000Z",
            updatedAt: "2026-11-27T10:00:00.000Z",
          },
        ],
      })}\n`,
      { mode: 0o600 },
    );

    await fixture.restart();
    const local = await fixture.open();
    local.page.on("pageerror", (error) => errors.push(error.message));

    const bell = local.page.locator(".product-utilities .alert-bell-trigger");
    await expect(bell).toBeVisible({ timeout: 15_000 });
    await expect(bell).toHaveAttribute("aria-label", "Alerts (2 unread)", { timeout: 15_000 });
    await expect(bell.locator(".alert-bell-badge")).toHaveText("2");

    // Open popover and toggle read/unread on individual items.
    await bell.click();
    const popover = local.page.getByRole("dialog", { name: "Alerts" });
    await expect(popover).toBeVisible();
    // Stale live alert auto-resolved on restart; the 2 unread + 1 read point-in-time alerts remain.
    await expect(popover.locator(".alert-item")).toHaveCount(3);
    await expect(popover).not.toContainText("Stale database error");

    await popover
      .getByRole("button", { name: 'Mark "Workflow failed: Release pipeline" read', exact: true })
      .click();
    await expect(bell.locator(".alert-bell-badge")).toHaveText("1");
    await expect(popover.locator('.alert-item[data-read="true"]')).toHaveCount(2);

    await popover
      .getByRole("button", { name: 'Mark "Workflow failed: Release pipeline" unread', exact: true })
      .click();
    await expect(bell.locator(".alert-bell-badge")).toHaveText("2");
    await expect(popover.locator('.alert-item[data-read="false"]')).toHaveCount(2);

    // Mark the second item read, reload the page, and verify persistence.
    await popover
      .getByRole("button", { name: 'Mark "Workflow failed: Release pipeline" read', exact: true })
      .click();
    await expect(bell.locator(".alert-bell-badge")).toHaveText("1");

    await local.page.reload();
    const reloadedBell = local.page.locator(".product-utilities .alert-bell-trigger");
    await expect(reloadedBell.locator(".alert-bell-badge")).toHaveText("1", { timeout: 15_000 });

    // Click an alert link: marks read, closes popover, and navigates to Scheduled Jobs.
    await reloadedBell.click();
    const reloadedPopover = local.page.getByRole("dialog", { name: "Alerts" });
    await expect(reloadedPopover).toBeVisible();
    await reloadedPopover
      .locator(".alert-item-link", { hasText: "Scheduled job failed: Nightly check" })
      .click();

    await expect(reloadedPopover).toHaveCount(0);
    await expect(reloadedBell.locator(".alert-bell-badge")).toHaveCount(0);
    await expect(local.page.locator("#panel-automations")).toBeVisible();

    // Mark an item unread, then use Mark all read and Clear read.
    await reloadedBell.click();
    await expect(reloadedPopover).toBeVisible();
    await reloadedPopover
      .getByRole("button", { name: 'Mark "Check update instructions" unread', exact: true })
      .click();
    await expect(reloadedBell.locator(".alert-bell-badge")).toHaveText("1");

    await reloadedPopover.getByRole("button", { name: "Mark all read", exact: true }).click();
    await expect(reloadedBell.locator(".alert-bell-badge")).toHaveCount(0);

    await reloadedPopover.getByRole("button", { name: "Clear read", exact: true }).click();
    await expect(reloadedPopover).toContainText("No alerts.");

    // Reload once more to verify cleared state stays cleared on disk.
    await local.page.reload();
    await expect(local.page.locator(".product-utilities .alert-bell-trigger")).toHaveAttribute(
      "aria-label",
      "Alerts",
      { timeout: 15_000 },
    );

    expect(errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});
