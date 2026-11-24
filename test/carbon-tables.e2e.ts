import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { build } from "vite";
import { fixturePage } from "./fixtures/static-page.js";

// Supporting renderer integration: synthetic rows, no backend/API mutation.
test("browser: Carbon tables preserve selection, query scope, settings and upstream keyboard controls", async ({
  browser,
}) => {
  const previousNodeEnv = process.env.NODE_ENV;
  const directory = await mkdtemp(join(tmpdir(), "code60-carbon-tables-"));
  let app: Awaited<ReturnType<typeof fixturePage>> | undefined;
  try {
    await build({
      configFile: false,
      define: { "process.env.NODE_ENV": JSON.stringify("development") },
      logLevel: "error",
      build: {
        outDir: directory,
        lib: {
          entry: resolve("test/fixtures/carbon-tables.tsx"),
          formats: ["es"],
          fileName: () => "fixture.js",
          cssFileName: "fixture",
        },
      },
    });
    await writeFile(
      join(directory, "index.html"),
      '<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="./fixture.css"><div id="root"></div><script type="module" src="./fixture.js"></script>',
    );
    app = await fixturePage(browser, directory);
    const page = app.page;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const table = page.getByRole("table", { name: "Configurations", exact: true });
    await expect(page.locator(".cds--toolbar-content")).toHaveCSS("display", "flex");
    await expect(table.locator("tbody tr")).toHaveCount(50);
    await expect(table.locator("tbody tr").first()).toContainText("Job 60");
    const selectedRadio = table.getByRole("radio", { name: "Select Job 59", exact: true });
    await selectedRadio.focus();
    await selectedRadio.press("Space");
    await expect(page.getByLabel("Selected identity")).toHaveText("id-59");
    await table.getByRole("button", { name: "Count", exact: false }).click();
    await expect(table.locator("tbody tr").first()).toContainText("Job 00");
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(table.locator("tbody tr")).toHaveCount(11);
    await expect(table.getByRole("radio", { name: "Select Job 59", exact: true })).toBeChecked();
    const search = page.getByRole("searchbox", { name: "Search Configurations", exact: true });
    await search.fill("Job 59");
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(table.getByRole("radio")).toBeChecked();
    await search.fill("absent");
    await expect(table).toContainText("No rows match");
    await page.getByRole("button", { name: "Change workspace", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect(table.locator("tbody tr")).toHaveCount(50);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", {
      name: "Configurations table settings",
      exact: true,
    });
    await expect(settings).toBeVisible();
    await settings.getByLabel("Row density", { exact: true }).selectOption("low");
    await settings.getByText("Fit columns to width", { exact: true }).click();
    await settings.getByLabel("Width for Name", { exact: true }).selectOption("320");
    await settings.getByRole("button", { name: "Move Count earlier", exact: true }).click();
    await expect(settings.getByRole("table").locator("thead th").first()).toContainText("Count");
    await settings.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(settings).toHaveCount(0);
    await expect(table).toHaveClass(/cds--data-table--lg/);
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("code60.tableView.v1:configurations") ?? "null"),
      ),
    ).toMatchObject({
      density: "low",
      fit: false,
      widths: { name: 320 },
      order: ["count", "name"],
    });
    await expect(table.locator("thead th").nth(1)).toContainText("Count");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Retained query", exact: true }).click();
    await expect(page.locator(".cds--pagination")).toHaveCount(0);
    const retained = page.getByRole("searchbox", { name: "Search retained logs", exact: true });
    await retained.fill("retained text");
    await retained.press("Enter");
    await expect(page.getByLabel("Retained request")).toContainText('"search":"retained text"');
    await page.getByRole("button", { name: "Change workspace", exact: true }).click();
    await expect(retained).toHaveValue("");
    await expect(page.getByLabel("Retained request")).toContainText('"search":""');
    const tabs = page.getByRole("combobox", { name: "Files view", exact: true });
    await tabs.focus();
    await tabs.press("ArrowDown");
    await page.getByRole("option", { name: "Changes", exact: true }).click();
    await expect(tabs).toContainText("Changes");
    await page.getByRole("button", { name: "Fixture actions", exact: true }).press("ArrowUp");
    const menu = page.getByRole("menu", { name: "Fixture actions", exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Unavailable", exact: true })).toBeDisabled();
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitem", { name: "Delete", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Chosen action")).toHaveText("delete");
    await page.getByRole("button", { name: "Theme", exact: true }).click();
    await expect(table.locator("th").nth(1)).toHaveCSS("background-color", "rgb(57, 57, 57)");
    await expect(retained).toHaveCSS("background-color", "rgb(38, 38, 38)");
    await page.screenshot({
      path: "test-results/qa/carbon-app/carbon-table-dark.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 640, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    await expect(table).toBeVisible();
    await page.screenshot({
      path: "test-results/qa/carbon-app/carbon-table-forced-colors-narrow.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
