import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { McpConfigurationStore as StoreType } from "../src/application/index.js";
import { openMcpServers } from "./fixtures/browser-actions.js";
import { browserApp, createDatabase, onboard, openProject } from "./fixtures/browser-app.js";

const config = (directory: string) => join(directory, "config/code60/mcp.json");
const text = (label: string, enabled = false) =>
  `{"version":1, "servers":{"docs":{"label":"${label}","enabled":${enabled},"type":"stdio","command":"never-launch"}}}\n`;
async function app(page: Page) {
  await openMcpServers(page);
  await expect(page.getByRole("tab", { name: "User", exact: true })).toBeVisible();
}
async function openJsonModal(page: Page) {
  await page.getByRole("button", { name: "Edit JSON", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Edit JSON —/ });
  await expect(dialog.locator(".mcp-json-editor .monaco-editor")).toBeVisible();
  return dialog;
}
async function edit(page: Page, value: string) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((text) => navigator.clipboard.writeText(text), value);
  await page.locator(".mcp-json-editor .inputarea").focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+v");
}
async function saveInModal(page: Page, file: string, value: string) {
  const dialog = await openJsonModal(page);
  await edit(page, value);
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => readFile(file, "utf8").catch(() => null)).toBe(value);
}

test("MCP JSON: completion, safe validation, exact saves, reset, format and guided edits", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const legacy = await readFile(join(fixture.directory, "config/code60/config.json"));
    const { page } = await fixture.open();
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await onboard(page);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await app(page);
    let dialog = await openJsonModal(page);
    await edit(page, '{\n  "ver');
    await page.keyboard.press("Control+Space");
    await expect(page.locator(".suggest-widget.visible")).toContainText("version");
    await page.keyboard.press("Escape");
    await edit(
      page,
      '{"version":1,"servers":{"docs":{"label":"Docs","enabled":false,"type":"stdio","command":"node","env":{"TOKEN":{"cred',
    );
    await page.keyboard.press("Control+Space");
    await expect(page.locator(".suggest-widget.visible")).toContainText("credentialRef");
    await page.keyboard.press("Escape");
    await edit(page, '{"secret-unknown":"synthetic-value",}');
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Format JSON", exact: true })).toBeDisabled();
    const issues = dialog.getByRole("list", { name: "Configuration issues", exact: true });
    await expect(issues).toHaveCSS("list-style-type", "none");
    await expect(issues).not.toContainText("synthetic-value");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(stat(config(fixture.directory))).rejects.toThrow();
    const exact = text("Exact");
    await edit(page, exact);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => readFile(config(fixture.directory), "utf8")).toBe(exact);
    dialog = await openJsonModal(page);
    await edit(page, text("Reset me"));
    await dialog.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(dialog.locator(".mcp-json-editor")).toContainText("Exact");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole("button", { name: /^Actions for / })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    const form = page.getByRole("dialog", { name: /Edit MCP server/ });
    await form.getByLabel("Label", { exact: true }).fill("Guided save");
    await form.getByRole("button", { name: "Save server", exact: true }).click();
    await expect(form).toHaveCount(0);
    dialog = await openJsonModal(page);
    await expect(dialog.locator(".mcp-json-editor")).toContainText("Guided save");
    await edit(page, text("Format"));
    await dialog.getByRole("button", { name: "Format JSON", exact: true }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() => readFile(config(fixture.directory), "utf8"))
      .toBe(`${JSON.stringify(JSON.parse(text("Format")), null, 2)}\n`);
    await page.reload();
    await app(page);
    dialog = await openJsonModal(page);
    await expect(dialog.locator(".mcp-json-editor")).toContainText("Format");
    expect(await readFile(join(fixture.directory, "config/code60/config.json"))).toEqual(legacy);
    expect((await stat(config(fixture.directory))).mode & 0o777).toBe(0o600);
    expect(requests.some((url) => /json\.worker.*\.js/.test(url))).toBe(true);
    expect(requests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
    const response = await page.request.get(page.url());
    expect(response.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(await response.text()).toContain("worker-src 'self';");
    expect(
      await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content"),
    ).toContain("connect-src 'self';");
    await page.screenshot({ path: test.info().outputPath("json-editor.png") });
  } finally {
    await fixture.close();
  }
});

test("MCP JSON: external conflict, reset and reviewed backup restoration", async ({ browser }) => {
  const fixture = await browserApp(browser);
  try {
    const { page } = await fixture.open();
    await onboard(page);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await app(page);
    await saveInModal(page, config(fixture.directory), text("First"));
    await saveInModal(page, config(fixture.directory), text("Second"));
    let jsonDialog = await openJsonModal(page);
    await edit(page, text("Unsaved"));
    await writeFile(config(fixture.directory), text("External"));
    await jsonDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(jsonDialog).toContainText("MCP_CONFIG_CONFLICT");
    expect(await readFile(config(fixture.directory), "utf8")).toBe(text("External"));
    await jsonDialog.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(jsonDialog.locator(".mcp-json-editor")).toContainText("External");
    await jsonDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(jsonDialog).toHaveCount(0);
    const backupsBefore = await readdir(join(fixture.directory, "state/code60/mcp-configuration"));
    await page.getByRole("button", { name: "Restore backup", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Restore MCP backup", exact: true });
    const choices = dialog.getByLabel("Backup", { exact: true });
    await choices.selectOption({ index: 1 });
    await expect(dialog.locator("pre")).toContainText("First");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await readFile(config(fixture.directory), "utf8")).toBe(text("External"));
    expect(await readdir(join(fixture.directory, "state/code60/mcp-configuration"))).toEqual(
      backupsBefore,
    );
    await page.getByRole("button", { name: "Restore backup", exact: true }).click();
    await choices.selectOption({ index: 1 });
    await expect(dialog.locator("pre")).toContainText("First");
    await writeFile(config(fixture.directory), text("Newer"));
    await dialog.getByRole("button", { name: "Confirm restore", exact: true }).click();
    await expect(dialog).toContainText("MCP_CONFIG_CONFLICT");
    expect(await readFile(config(fixture.directory), "utf8")).toBe(text("Newer"));
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Restore backup", exact: true }).click();
    await choices.selectOption({ index: 1 });
    await dialog.getByRole("button", { name: "Confirm restore", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await readFile(config(fixture.directory), "utf8")).toBe(text("First"));
    await page.getByRole("button", { name: "Restore backup", exact: true }).click();
    await choices.selectOption({ index: 3 });
    await expect(dialog).toContainText("Restore removes this dedicated file");
    await dialog.getByRole("button", { name: "Confirm restore", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(stat(config(fixture.directory))).rejects.toThrow();
    jsonDialog = await openJsonModal(page);
    await expect(jsonDialog.locator(".mcp-json-editor")).toContainText('"servers": {}');
    await jsonDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally {
    await fixture.close();
  }
});

test("MCP reset: project inheritance, cancellation, guarded empty target and combined scope", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const project = join(fixture.directory, "alpha");
    const other = join(fixture.directory, "beta/.code60");
    await mkdir(project);
    await mkdir(other, { recursive: true });
    await writeFile(join(other, "mcp.json"), text("Untouched"));
    const { page } = await fixture.open();
    await onboard(page);
    await createDatabase(page, fixture.directory);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await openProject(page, fixture.directory, "alpha");
    await app(page);
    await saveInModal(page, config(fixture.directory), text("User enabled", true));
    await page.getByRole("tab", { name: "Project", exact: true }).click();
    const file = join(project, ".code60/mcp.json");
    await saveInModal(page, file, text("Project override"));
    await page.getByRole("button", { name: "Reset this configuration", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Reset MCP configuration?", exact: true });
    await expect(dialog).toContainText("User enabled");
    await expect(dialog).toContainText("Enabled: 1");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await readFile(file, "utf8")).toBe(text("Project override"));
    await page.getByRole("button", { name: "Reset this configuration", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirm reset", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(JSON.parse(await readFile(file, "utf8")).servers).toEqual({});
    const identity = (await stat(file)).ino;
    await page.getByRole("button", { name: "Reset User and this project", exact: true }).click();
    await expect(dialog).toContainText("also affects other projects");
    await dialog.getByRole("button", { name: "Confirm reset", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(JSON.parse(await readFile(config(fixture.directory), "utf8")).servers).toEqual({});
    expect((await stat(file)).ino).toBe(identity);
    expect((await stat(file)).mode & 0o777).toBe(0o644);
    expect(await readFile(join(other, "mcp.json"), "utf8")).toBe(text("Untouched"));
    await page.screenshot({ path: test.info().outputPath("reset-complete.png") });
  } finally {
    await fixture.close();
  }
});

test("MCP JSON: malformed repair and confirmed malformed reset retain private evidence", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const malformed = '{"synthetic-token":"private-preimage",';
    await writeFile(config(fixture.directory), malformed, { mode: 0o600 });
    const { page } = await fixture.open();
    await onboard(page);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await app(page);
    const jsonDialog = await openJsonModal(page);
    await expect(jsonDialog.locator(".mcp-json-editor")).toContainText("private-preimage");
    await edit(page, text("Repaired"));
    await jsonDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(jsonDialog).toHaveCount(0);
    await expect.poll(() => readFile(config(fixture.directory), "utf8")).toBe(text("Repaired"));
    await page.getByRole("button", { name: "Restore backup", exact: true }).click();
    const backups = page.getByRole("dialog", { name: "Restore MCP backup", exact: true });
    await expect(
      backups.getByRole("option", { name: /Malformed recovery evidence/ }),
    ).toHaveJSProperty("disabled", true);
    await backups.getByRole("button", { name: "Cancel", exact: true }).click();
    await writeFile(config(fixture.directory), malformed);
    await page.getByRole("button", { name: "Reset this configuration", exact: true }).click();
    const reset = page.getByRole("dialog", { name: "Reset MCP configuration?", exact: true });
    await expect(reset).toContainText("Malformed originals will be preserved");
    await reset.getByRole("button", { name: "Confirm reset", exact: true }).click();
    await expect(reset).toHaveCount(0);
    expect(JSON.parse(await readFile(config(fixture.directory), "utf8")).servers).toEqual({});
    const storage = join(fixture.directory, "state/code60/mcp-configuration");
    const files = (await readdir(storage)).filter((f) => f.endsWith(".backup"));
    const evidence = await Promise.all(files.map((f) => readFile(join(storage, f), "utf8")));
    expect(
      evidence.some((value) => value.includes(Buffer.from(malformed).toString("base64"))),
    ).toBe(true);
    for (const file of files) expect((await stat(join(storage, file))).mode & 0o777).toBe(0o600);
    expect(await readdir(storage)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/\.journal$/)]),
    );
  } finally {
    await fixture.close();
  }
});

test("MCP reset: interrupted publication remains blocked after restart without automatic replay", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const { page } = await fixture.open();
    await onboard(page);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await app(page);
    await saveInModal(page, config(fixture.directory), text("Before interrupted reset"));
    await fixture.gateway.stop();
    const { McpConfigurationStore } = (await import(
      pathToFileURL(resolve("dist/application/index.js")).href
    )) as { McpConfigurationStore: typeof StoreType };
    const io = await import("node:fs/promises");
    const store = await McpConfigurationStore.open({
      stateRoot: join(fixture.directory, "state/code60/mcp-configuration"),
      userDirectory: join(fixture.directory, "config/code60"),
      io: {
        ...io,
        checkpoint: async (step) => {
          if (step === "directory-sync") throw new Error("synthetic reset sync failure");
        },
      },
    });
    try {
      const target = store.targetIds()[0];
      if (!target) throw new Error("missing target");
      const before = await store.read(target.targetId);
      expect(
        (
          await store.reset({
            requestId: randomUUID(),
            targets: [
              { targetId: target.targetId, expectedRevision: before.revision, reset: true },
            ],
          })
        ).status,
      ).toBe("recovery-required");
    } finally {
      await store.close();
    }
    const published = await readFile(config(fixture.directory));
    await fixture.restart();
    const { page: recovered } = await fixture.open();
    await expect(recovered.getByRole("banner", { name: "Code60" })).toBeVisible();
    await app(recovered);
    await expect(
      recovered.getByRole("button", { name: "Reset this configuration", exact: true }),
    ).toBeDisabled();
    const jsonDialog = await openJsonModal(recovered);
    await expect(jsonDialog).toContainText("Pending recovery blocks writes");
    await edit(recovered, text("Blocked edit"));
    await expect(jsonDialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await jsonDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await recovered.getByRole("button", { name: "Restore backup", exact: true }).click();
    const backups = recovered.getByRole("dialog", { name: "Restore MCP backup", exact: true });
    await expect(backups.getByRole("option", { name: /Pending recovery/ })).toHaveJSProperty(
      "disabled",
      true,
    );
    await backups.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await readFile(config(fixture.directory))).toEqual(published);
    expect(
      (await readdir(join(fixture.directory, "state/code60/mcp-configuration"))).some((f) =>
        f.endsWith(".journal"),
      ),
    ).toBe(true);
  } finally {
    await fixture.close();
  }
});

test("MCP JSON: invalid UTF-8 stays non-editable and a replaced project cannot receive a save", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    await writeFile(config(fixture.directory), Buffer.from([0xff, 0xfe]), { mode: 0o600 });
    const project = join(fixture.directory, "alpha");
    await mkdir(project);
    const { page } = await fixture.open();
    await onboard(page);
    await createDatabase(page, fixture.directory);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await openProject(page, fixture.directory, "alpha");
    await app(page);
    let jsonDialog = await openJsonModal(page);
    await expect(jsonDialog).toContainText("original file is not valid UTF-8");
    await expect(jsonDialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await expect(
      jsonDialog.getByRole("button", { name: "Format JSON", exact: true }),
    ).toBeDisabled();
    await jsonDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Reset this configuration", exact: true }).click();
    const reset = page.getByRole("dialog", { name: "Reset MCP configuration?", exact: true });
    await expect(reset).toContainText("Malformed originals will be preserved");
    await reset.getByRole("button", { name: "Confirm reset", exact: true }).click();
    await expect(reset).toHaveCount(0);
    await page.getByRole("tab", { name: "Project", exact: true }).click();
    const file = join(project, ".code60/mcp.json");
    await saveInModal(page, file, text("Original owner"));
    jsonDialog = await openJsonModal(page);
    await edit(page, text("Replaced owner edit"));
    await rename(project, `${project}-old`);
    await mkdir(project);
    await jsonDialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(jsonDialog).toContainText("configuration owner is unavailable");
    await expect(jsonDialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    await expect(stat(file)).rejects.toThrow();
    expect(await readFile(join(`${project}-old`, ".code60/mcp.json"), "utf8")).toBe(
      text("Original owner"),
    );
    await jsonDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally {
    await fixture.close();
  }
});
