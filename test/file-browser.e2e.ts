import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { browserApp, createDatabase, onboard, openProject } from "./fixtures/browser-app.js";
import { commitFixture } from "./fixtures/git-repository.js";

test("browser: host chooser navigates, recovers, and creates and reopens the chosen database", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  const root = fixture.directory;
  const longName = "Quarterly project notes ".repeat(5).trim();
  try {
    await mkdir(join(root, longName));
    await mkdir(join(root, "Archives"));
    const { page } = await fixture.open({ hasTouch: true });
    await onboard(page);
    await page.getByRole("button", { name: "Connect to database", exact: true }).click();
    const launch = page.getByRole("button", { name: "Create database…", exact: true });
    await launch.click();
    const picker = page.getByRole("dialog", { name: "Create database", exact: true });
    const button = (name: string) => picker.getByRole("button", { name, exact: true });
    const row = (name: string) => picker.getByRole("option", { name, exact: true });
    const at = (location: string) =>
      expect(picker.locator(".picker-location")).toHaveText(location);
    await expect(button("Up")).toBeDisabled();
    await row(root).tap();
    await expect(row(root)).toHaveAttribute("aria-selected", "true");
    await at("Workspace roots");
    await button("Open folder").tap();
    await at(root);
    await button("Up").click();
    await at("Workspace roots");
    await button("Back").click();
    await at(root);
    await button("Forward").click();
    await at("Workspace roots");
    await row(root).dblclick();
    await row(longName).click();
    await row(longName).press("a");
    await expect(row("Archives")).toBeFocused();
    await rename(join(root, "Archives"), join(root, "Moved"));
    await row("Archives").press("Enter");
    await expect(picker.getByRole("alert")).toBeVisible();
    await at(root);
    await rename(join(root, "Moved"), join(root, "Archives"));
    await button("Retry").click();
    await at(join(root, "Archives"));
    await button("Back").click();
    await row(longName).dblclick();
    await at(join(root, longName));
    await expect(button("Forward")).toBeDisabled();
    await expect(picker.getByText("No items in this location.")).toBeVisible();
    await button("Up").click();
    await at(root);
    for (const [width, name] of [
      [1280, "desktop"],
      [390, "narrow"],
    ] as const) {
      await page.setViewportSize({ width, height: 760 });
      await page.screenshot({ path: test.info().outputPath(`chooser-${name}.png`) });
      expect(await picker.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
    await page.screenshot({ path: test.info().outputPath("chooser-dark.png") });
    await page.emulateMedia({ forcedColors: "active" });
    await row(longName).click();
    await expect(row(longName)).toHaveAttribute("aria-selected", "true");
    await page.screenshot({ path: test.info().outputPath("chooser-forced.png") });
    await page.emulateMedia({ forcedColors: "none" });
    await button("New folder").click();
    const name = picker.getByLabel("New folder name");
    await name.press("Escape");
    await expect(name).toHaveCount(0);
    await expect(button("New folder")).toBeFocused();
    await button("New folder").click();
    await name.fill("Archives");
    await name.press("Enter");
    await expect(picker.getByRole("alert")).toBeVisible();
    await expect(name).toHaveValue("Archives");
    await name.fill("Data");
    await name.press("Enter");
    await at(join(root, "Data"));
    expect((await stat(join(root, "Data"))).isDirectory()).toBe(true);
    await picker.getByLabel("Database filename").fill("Work.sqlite");
    await button("Create database").click();
    await expect(picker).toHaveCount(0);
    const target = join(root, "Data", "Work.sqlite");
    expect((await readFile(target)).subarray(0, 16).toString()).toBe("SQLite format 3\0");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Start", exact: true }).click();
    const databases = page.getByRole("button", { name: "Select or create database" });
    await databases.click();
    await launch.click();
    await row(root).dblclick();
    await row("Data").dblclick();
    await picker.getByLabel("Database filename").fill("Work.sqlite");
    const before = await readFile(target);
    await button("Create database").click();
    await expect(picker.getByRole("alert")).toBeVisible();
    expect(await readFile(target)).toEqual(before);
    await button("Cancel").click();
    await expect(picker).toHaveCount(0);
    const open = page.getByRole("button", { name: "Open existing database…" });
    if (!(await open.isVisible())) await databases.click();
    await open.click();
    const reopen = page.getByRole("dialog", { name: "Open database", exact: true });
    for (const folder of [root, "Data"])
      await reopen.getByRole("option", { name: folder, exact: true }).dblclick();
    await reopen.getByRole("option", { name: "Work.sqlite", exact: true }).click();
    await reopen.getByRole("button", { name: "Open", exact: true }).click();
    await expect(reopen).toHaveCount(0);
    expect((await page.evaluate(() => window.code60.snapshot())).database).toBe(target);
  } finally {
    await fixture.close();
  }
});

test("browser: project Explorer selects, expands and reuses an owned preview", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  const file = "Long mixed CASE filename for a read-only preview.txt";
  try {
    for (const name of ["alpha", "beta"]) {
      const repo = join(fixture.directory, name);
      await mkdir(join(repo, "src"), { recursive: true });
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
      await writeFile(join(repo, "src", file), `${name} project contents\n`);
      execFileSync("git", ["add", "."], { cwd: repo });
      commitFixture(repo);
    }
    const { page } = await fixture.open();
    await onboard(page);
    await createDatabase(page, fixture.directory);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    const explorer = page.getByRole("region", { name: "File Explorer", exact: true });
    const selector = page.getByRole("combobox", { name: "Files view", exact: true });
    const tree = explorer.getByRole("tree");
    const folder = tree.getByRole("treeitem", { name: "src", exact: true });
    const entry = tree.getByRole("treeitem", { name: file, exact: true });
    for (const name of ["alpha", "beta"]) {
      await openProject(page, fixture.directory, name);
      await page
        .getByRole("button", { name: `New Session in ${name}`, exact: true })
        .first()
        .click();
      const chat = page
        .getByRole("region", { name: `Project ${join(fixture.directory, name)}`, exact: true })
        .getByRole("button", { name: "Chat 1", exact: true });
      await chat.click();
      await expect(chat).toHaveAttribute("aria-current", "true");
      const toggle = page.getByRole("button", { name: "Toggle files panel", exact: true });
      if (!(await selector.isVisible()))
        await toggle.and(page.locator('[aria-expanded="false"]')).click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await selector.click();
      await page.getByRole("option", { name: "File Explorer", exact: true }).click();
      await folder.click();
      await expect(folder).toHaveAttribute("aria-expanded", "false");
      await folder.locator("[data-disclosure]").click();
      await entry.click();
      await expect(entry).toHaveAttribute("aria-selected", "true");
      if (name === "alpha") {
        for (const [width, label] of [
          [1440, "desktop"],
          [420, "narrow"],
        ] as const) {
          await page.setViewportSize({ width, height: 800 });
          await entry.scrollIntoViewIfNeeded();
          await explorer.screenshot({ path: test.info().outputPath(`explorer-${label}.png`) });
        }
        await page.emulateMedia({ colorScheme: "dark" });
        await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
        await explorer.screenshot({ path: test.info().outputPath("explorer-dark.png") });
        await page.emulateMedia({ forcedColors: "active" });
        await explorer.screenshot({ path: test.info().outputPath("explorer-forced.png") });
        await page.emulateMedia({ forcedColors: "none", colorScheme: "light" });
        await page.setViewportSize({ width: 1440, height: 900 });
      }
      await entry.press("Enter");
      const preview = page.getByRole("complementary", { name: "File preview" });
      await expect(preview).toContainText(`${name} project contents`);
      await selector.click();
      await page.getByRole("option", { name: "File Explorer", exact: true }).click();
      await expect(folder).toHaveAttribute("aria-expanded", "true");
      await entry.dblclick();
      await expect(preview).toContainText(`${name} project contents`);
      await selector.click();
      await expect(page.getByRole("option", { name: file, exact: true })).toHaveCount(1);
      await selector.press("Escape");
    }
  } finally {
    await fixture.close();
  }
});
