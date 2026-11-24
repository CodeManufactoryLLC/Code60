import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { browserApp, onboard } from "./fixtures/browser-app.js";
import { goldenJourney } from "./fixtures/golden-journey.js";

test("browser: first use through accepted plan, automatic edits, diff, attachment and Undo", async ({
  browser,
}) => {
  await goldenJourney(await browserApp(browser));
});

test("browser: setup-prepared database through provider verification and accepted work", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    await fixture.gateway.application.prepareInitialDatabase();
    await goldenJourney(
      fixture,
      join(fixture.env.XDG_DATA_HOME, "code60/databases/default.sqlite"),
    );
  } catch (error) {
    await fixture.close();
    throw error;
  }
});

test("browser: closing and reconnecting preserves the backend; takeover and stop require explicit action", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const first = await fixture.open();
    await onboard(first.page);
    const pid = fixture.gateway.application.snapshot().versions.node;
    const second = await fixture.open();
    await expect(
      second.page.getByRole("button", { name: "Take control", exact: true }),
    ).toBeVisible();
    await second.page.getByRole("button", { name: "Take control", exact: true }).click();
    await expect(
      first.page.getByRole("button", { name: "Take control", exact: true }),
    ).toBeVisible();
    await second.context.close();
    expect((await fetch(fixture.gateway.origin)).status).toBe(200);
    expect(fixture.gateway.application.snapshot().versions.node).toBe(pid);
    await first.page.getByRole("button", { name: "Take control", exact: true }).click();
    await expect(first.page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await first.page.getByRole("button", { name: "Workspace", exact: true }).click();
    await first.page.getByRole("button", { name: "Stop Code60 Backend", exact: true }).click();
    await first.page
      .getByRole("dialog", { name: "Stop Code60 Backend?", exact: true })
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    expect((await fetch(fixture.gateway.origin)).status).toBe(200);
    expect((await readdir(fixture.processLog)).length).toBeGreaterThan(0);
  } finally {
    await fixture.close();
  }
});
