import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { expandNavigation } from "./fixtures/browser-actions.js";
import { browserApp, onboard } from "./fixtures/browser-app.js";

test("browser: Context → Vector Search lists indexed repos, sizes, expandable details, and supports Query and confirmed removal", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const fixture = await browserApp(browser, [], false);
  const errors: string[] = [];
  try {
    const repo = join(fixture.directory, "vector-ui-repo");
    await mkdir(join(repo, "src"), { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Vector Test"], { cwd: repo });
    await writeFile(
      join(repo, "src/auth.ts"),
      "export function verifySessionCookie(token: string): boolean {\n  return token.startsWith('v1_');\n}\n",
    );
    await writeFile(
      join(repo, "src/billing.ts"),
      "export function computeInvoiceTotal(cents: number): number {\n  return Math.round(cents * 1.1);\n}\n",
    );
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: repo });

    const local = await fixture.open();
    local.page.on("pageerror", (error) => errors.push(error.message));
    await onboard(local.page);

    // Open Context -> Vector Search without needing a database.
    await expandNavigation(local.page, "Context");
    const contextNav = local.page.getByRole("tablist", { name: "Context", exact: true });
    await expect(contextNav.getByRole("tab")).toHaveText([
      "Vector Search",
      "Memory",
      "Commands",
      "Internal Prompts",
    ]);
    await local.page.locator("#tab-vector-search").click();

    const section = local.page.locator("section.vector-search-page");
    await expect(section).toBeVisible();
    await expect(section.locator(".cds--tile")).toHaveCount(0);
    await expect(section.getByRole("tab", { name: "Repositories", exact: true })).toBeVisible();
    await expect(section.getByRole("tab", { name: "Query", exact: true })).toBeVisible();
    await expect(section.getByText("No repositories indexed yet.")).toBeVisible();

    // Index the test repository through the host folder picker.
    await section.getByRole("button", { name: "Index repository", exact: true }).click();
    const chooser = local.page.getByRole("dialog", { name: "Choose folder", exact: true });
    await expect(chooser).toBeVisible();
    await chooser.getByRole("option", { name: fixture.directory, exact: true }).dblclick();
    await chooser.getByRole("option", { name: "vector-ui-repo", exact: true }).click();
    await chooser.getByRole("button", { name: "Choose folder", exact: true }).click();
    await expect(chooser).toHaveCount(0);

    // Wait for indexing to complete and appear in the table with chunks, size, and Ready tag.
    const row = section.locator("tbody tr").filter({ hasText: "vector-ui-repo" }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText("Ready", { timeout: 30_000 });
    await expect(row).toContainText("main");
    await expect(row).toContainText("2");

    // Expand row details to verify Git snapshot and language breakdown.
    await section.getByRole("button", { name: "Expand details for vector-ui-repo" }).click();
    await expect(section.getByText("Git snapshot")).toBeVisible();
    await expect(section.getByText("Index details")).toBeVisible();
    await expect(section.getByText(/typescript \(2 files, 2 chunks\)/)).toBeVisible();
    await local.page.screenshot({ path: test.info().outputPath("vector-search-repos.png") });

    // Switch to Query tab and run a query against the indexed repository.
    await section.getByRole("tab", { name: "Query", exact: true }).click();
    await section.getByRole("textbox", { name: "Query", exact: true }).fill("verifySessionCookie");
    await section.getByRole("button", { name: "Search", exact: true }).click();
    await expect(section.locator(".vector-search-hit").first()).toContainText("src/auth.ts", {
      timeout: 30_000,
    });
    await local.page.screenshot({ path: test.info().outputPath("vector-search-query.png") });

    // Switch back to Repositories and remove the index with confirmation.
    await section.getByRole("tab", { name: "Repositories", exact: true }).click();
    await section.getByRole("button", { name: "Remove vector-ui-repo index" }).click();
    const dialog = local.page.getByRole("dialog", { name: "Remove repository index?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Remove index", exact: true }).click();
    await expect(section.getByText("No repositories indexed yet.")).toBeVisible({
      timeout: 15_000,
    });

    expect(errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});
