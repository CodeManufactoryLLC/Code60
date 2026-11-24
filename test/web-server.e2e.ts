import { expandNavigation } from "./fixtures/browser-actions.js";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { browserApp, createDatabase, onboard } from "./fixtures/browser-app.js";

async function serverPage(page: Page) {
  await page.locator("#advanced-toggle").click();
  await page.locator("#tab-web-server").click();
  await expect(page.getByRole("heading", { name: "Web Server Beta", exact: true })).toBeVisible();
  return page.getByRole("main", { name: "Web Server Beta", exact: true });
}

test("browser: Web Server Beta is available before provider or database setup", async ({
  browser,
}) => {
  const fixture = await browserApp(browser, [], false);
  try {
    const local = await fixture.open();
    await local.page.getByRole("button", { name: "Close provider setup", exact: true }).click();
    await local.page.getByRole("button", { name: "Web Server Beta", exact: true }).click();
    const settings = local.page.getByRole("main", { name: "Web Server Beta", exact: true });
    await expect(settings.getByRole("switch")).toBeEnabled();
    await expect(settings.locator("p[role=status]")).toHaveText("Off");
    const snapshot = await local.page.evaluate(() => window.code60.snapshot());
    expect(snapshot.agentSetup?.complete).toBe(false);
    expect(snapshot.database).toBeNull();
    expect(await readdir(fixture.processLog)).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test("browser: LAN beta pairs an HTTP browser, preserves approved work on disable and restores local access", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const fixture = await browserApp(browser, ["--relay", "--session-info"], false);
  const remote = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const gate = join(fixture.directory, "finish-lan-work");
  const errors: string[] = [];
  try {
    const local = await fixture.open();
    local.page.on("pageerror", (error) => errors.push(error.message));
    await onboard(local.page);
    await createDatabase(local.page, fixture.directory);
    await expect(local.page.getByRole("banner", { name: "Code60" })).toBeVisible();
    const settings = await serverPage(local.page);
    const toggle = settings.getByRole("switch", { name: "Enable Web Server Beta", exact: true });
    await expect(toggle).not.toBeChecked();
    await toggle.focus();
    await local.page.keyboard.press("Space");
    await expect(settings.locator("p[role=status]")).toHaveText("Listening");
    const url = await settings.getByRole("link").getAttribute("href");
    expect(url).toMatch(/^http:\/\/(?:10\.|172\.|192\.168\.)/);
    if (!url) throw new Error("Missing LAN URL");
    const code = settings.getByLabel("LAN pairing code", { exact: true });
    await expect(code).toHaveText(/^[0-9]{3}-[0-9]{3}$/);
    const previous = await code.textContent();
    await local.context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await settings.getByRole("button", { name: "Copy code", exact: true }).click();
    await expect
      .poll(() => local.page.evaluate(() => navigator.clipboard.readText()))
      .toBe(previous);
    await settings.getByRole("button", { name: "New code", exact: true }).click();
    await expect(code).not.toHaveText(previous ?? "");
    const activeCode = await code.textContent();
    const state = await readFile(
      join(fixture.directory, "state/code60/gateway/settings.json"),
      "utf8",
    );
    expect(state).toContain('"webServerEnabled":true');
    expect(state).not.toContain(activeCode);
    expect(JSON.stringify(await local.page.evaluate(() => window.code60.snapshot()))).not.toContain(
      activeCode,
    );
    await local.page.screenshot({ path: test.info().outputPath("web-server-local.png") });
    const page = await remote.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe("undefined");
    await expect(page.getByLabel("Pairing code", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Pairing code", { exact: true })).toHaveAttribute(
      "inputmode",
      "numeric",
    );
    await page.getByLabel("Pairing code", { exact: true }).fill(previous ?? "");
    await page.getByRole("button", { name: "Connect to Code60", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "invalid or expired" })).toContainText(
      "invalid or expired",
    );
    await page.getByLabel("Pairing code", { exact: true }).fill(activeCode?.replace("-", "") ?? "");
    await page.getByRole("button", { name: "Connect to Code60", exact: true }).click();
    await page.getByRole("button", { name: "Take control", exact: true }).click();
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await expandNavigation(page, "Manage");
    // MCP management also runs on paired HTTP, without secure-context UUID/clipboard APIs.
    const beforeMcp = await readdir(fixture.processLog);
    await page.getByRole("tab", { name: "Apps", exact: true }).click();
    await page.getByRole("button", { name: "Open MCP Servers", exact: true }).click();
    await page.getByRole("button", { name: "MCP Servers actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Add server", exact: true }).click();
    const form = page.getByRole("dialog", { name: /Add MCP server/ });
    await form.getByLabel("Server ID", { exact: true }).fill("lan-docs");
    await form.getByLabel("Label", { exact: true }).fill("LAN documentation");
    await form.getByLabel("Command", { exact: true }).fill("must-never-launch");
    await form.getByRole("button", { name: "Add argument", exact: true }).click();
    await form.getByLabel("Argument 1", { exact: true }).fill("public-argument");
    await form.getByRole("button", { name: "Save server", exact: true }).click();
    await expect(form).toHaveCount(0);
    const mcpPath = join(fixture.directory, "config/code60/mcp.json");
    expect(JSON.parse(await readFile(mcpPath, "utf8")).servers["lan-docs"]).toMatchObject({
      enabled: false,
      command: "must-never-launch",
      args: ["public-argument"],
    });
    expect((await stat(mcpPath)).mode & 0o777).toBe(0o600);
    await page.getByRole("button", { name: "JSON", exact: true }).click();
    await expect(page.locator(".monaco-editor")).toBeVisible();
    await page.getByRole("button", { name: "Servers", exact: true }).click();
    await page.getByRole("button", { name: "Review troubleshooting report", exact: true }).click();
    const report = page.getByRole("dialog", {
      name: "Safe MCP troubleshooting report",
      exact: true,
    });
    const safeReport = await report.locator("pre").textContent();
    expect(safeReport).not.toContain("LAN documentation");
    await report.getByRole("button", { name: "Copy safe report", exact: true }).click();
    await expect
      .poll(() => local.page.evaluate(() => navigator.clipboard.readText()))
      .toBe(safeReport);
    await report.getByRole("button", { name: "Close report", exact: true }).click();
    expect(await readdir(fixture.processLog)).toEqual(beforeMcp);
    const remoteSettings = await serverPage(page);
    await expect(remoteSettings.getByRole("switch")).toBeDisabled();
    await expect(remoteSettings.getByLabel("LAN pairing code")).toHaveCount(0);
    await expect(
      remoteSettings.getByText("Manage access from the controlling localhost browser."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    const chat = page.locator(".orchestration-chat-page:visible");
    const composer = chat.getByRole("combobox", { name: "Message to orchestrator", exact: true });
    await composer.fill(
      JSON.stringify([
        { message: "LAN request accepted" },
        { waitForFile: gate },
        { write: { path: "lan-result.txt", content: "completed after LAN disable\n" } },
        { message: "LAN work completed" },
      ]),
    );
    await composer.press("Enter");
    await expect(chat).toContainText("LAN request accepted");
    const directory = (await page.evaluate(() => window.code60.snapshot())).chat.directory;
    if (!directory) throw new Error("Missing owned conversation directory");
    const launches = await readdir(fixture.processLog);
    await chat.getByRole("button", { name: "Copy message", exact: true }).last().click();
    await expect
      .poll(() => local.page.evaluate(() => navigator.clipboard.readText()))
      .toBe("LAN request accepted");
    await local.page.getByRole("button", { name: "Take control", exact: true }).click();
    const localSettings = await serverPage(local.page);
    await expect(localSettings.getByRole("switch")).toBeEnabled();
    await localSettings.getByRole("switch").focus();
    await local.page.keyboard.press("Space");
    await expect(localSettings.locator("p[role=status]")).toHaveText("Off");
    expect(await readdir(fixture.processLog)).toEqual(launches);
    await writeFile(gate, "continue\n");
    await expect
      .poll(() =>
        readFile(join(directory, "lan-result.txt"), "utf8").catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
          },
        ),
      )
      .toBe("completed after LAN disable\n");
    await local.page.getByRole("button", { name: "Relay", exact: true }).click();
    await expect(local.page.locator(".orchestration-chat-page:visible")).toContainText(
      "LAN work completed",
    );
    expect((await fetch(fixture.gateway.origin)).status).toBe(200);
    await expect(fetch(url, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
    expect(errors).toEqual([]);
  } finally {
    await writeFile(gate, "continue\n").catch(() => {});
    await remote.close();
    await fixture.close();
  }
});
