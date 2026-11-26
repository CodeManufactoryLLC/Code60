import { randomUUID } from "node:crypto";
import { chmod, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { McpConfigurationStore as StoreType } from "../src/application/index.js";
import { openMcpServers } from "./fixtures/browser-actions.js";
import { browserApp, createDatabase, onboard, openProject } from "./fixtures/browser-app.js";

async function app(page: Page) {
  await openMcpServers(page);
  await expect(page.getByRole("tab", { name: "User", exact: true })).toBeVisible();
}
async function clickAdd(page: Page) {
  await page.getByRole("button", { name: "Add server", exact: true }).click();
}
async function serverAction(page: Page, action: string, label?: string) {
  const trigger = label
    ? page.getByRole("button", { name: `Actions for ${label}`, exact: true })
    : page.getByRole("button", { name: /^Actions for / }).first();
  await trigger.click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}
async function add(page: Page, id: string, label: string) {
  await clickAdd(page);
  const form = page.getByRole("dialog", { name: /Add MCP server/ });
  await form.getByLabel("Server ID", { exact: true }).fill(id);
  await form.getByLabel("Label", { exact: true }).fill(label);
  await form.getByLabel("Command", { exact: true }).fill("must-never-launch");
  return form;
}
const config = (directory: string) => join(directory, "config/code60/mcp.json");
const load = async (file: string) => JSON.parse(await readFile(file, "utf8"));
test("MCP management: user scope, templates, pasted review, HTTP edits, cancellation and reload", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const legacy = await readFile(join(fixture.directory, "config/code60/config.json"));
    const { page } = await fixture.open();
    await onboard(page);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await app(page);
    const providerProcesses = await readdir(fixture.processLog);
    await expect(page.getByRole("tab", { name: "User", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const workspace = page.locator(".mcp-workspace");
    await expect(
      workspace.getByRole("status").filter({ hasText: "No servers configured." }),
    ).toBeVisible();
    await expect(workspace.getByRole("table")).toHaveCount(0);
    await expect(stat(config(fixture.directory))).rejects.toThrow();
    let form = await add(page, "docs", "Documentation");
    await form.getByRole("button", { name: "Add argument", exact: true }).click();
    await form.getByLabel("Argument 1", { exact: true }).fill("with spaces");
    await form.getByRole("button", { name: "Save server", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(form).toHaveCount(0);
    expect((await load(config(fixture.directory))).servers.docs).toMatchObject({
      enabled: false,
      args: ["with spaces"],
    });
    expect((await stat(config(fixture.directory))).mode & 0o777).toBe(0o600);
    await expect(workspace.getByRole("columnheader")).toHaveText([
      "Label",
      "Enabled",
      "Source",
      "Actions",
    ]);
    await expect(workspace.getByRole("table").getByRole("radio")).toHaveCount(0);
    await expect(workspace.getByRole("searchbox")).toHaveCount(0);
    await expect(workspace.getByRole("button", { name: "Filters", exact: true })).toHaveCount(0);
    await expect(workspace.getByLabel("Column menu", { exact: true })).toHaveCount(0);
    await expect(workspace.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
    await serverAction(page, "Edit", "Documentation");
    form = page.getByRole("dialog", { name: /Edit MCP server/ });
    await expect(form.getByLabel("Server ID", { exact: true })).toBeDisabled();
    await form.getByLabel("Transport", { exact: true }).selectOption("http");
    await form.getByLabel("URL", { exact: true }).fill("https://example.invalid/mcp");
    await form.getByRole("button", { name: "Add header", exact: true }).click();
    await form.getByLabel("Headers name 1", { exact: true }).fill("Authorization");
    await form.getByLabel("Headers binding 1", { exact: true }).selectOption("credential");
    await form.getByLabel("Headers value 1", { exact: true }).fill("docs-token");
    await form.getByLabel("Headers prefix 1", { exact: true }).fill("Bearer ");
    await form.getByLabel("Authentication", { exact: true }).selectOption("oauth");
    await form.getByLabel("Requested scopes", { exact: true }).fill("docs:read");
    const beforeInvalidSave = await readFile(config(fixture.directory));
    await expect(form.getByRole("button", { name: "Save server", exact: true })).toBeDisabled();
    expect(await readFile(config(fixture.directory))).toEqual(beforeInvalidSave);
    await form.getByLabel("Headers name 1", { exact: true }).fill("X-Service-Token");
    await expect(form.getByRole("button", { name: "Save server", exact: true })).toBeEnabled();
    await form.getByRole("button", { name: "Save server", exact: true }).click();
    await expect(form).toHaveCount(0);
    expect((await load(config(fixture.directory))).servers.docs).toMatchObject({
      type: "http",
      enabled: false,
      headers: { "X-Service-Token": { credentialRef: "docs-token", prefix: "Bearer " } },
      auth: { type: "oauth", scopes: ["docs:read"] },
    });
    const before = await readFile(config(fixture.directory));
    await serverAction(page, "Remove server", "Documentation");
    await page
      .getByRole("dialog", { name: "Remove MCP server?", exact: true })
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    expect(await readFile(config(fixture.directory))).toEqual(before);
    await clickAdd(page);
    form = page.getByRole("dialog", { name: /Add MCP server/ });
    await form.getByLabel("Starting definition", { exact: true }).selectOption("playwright");
    await expect(form.getByLabel("Argument 2", { exact: true })).toHaveValue(
      "@playwright/mcp@0.0.84",
    );
    await page.keyboard.press("Escape");
    await expect(form).toHaveCount(0);
    expect(await readFile(config(fixture.directory))).toEqual(before);
    await clickAdd(page);
    form = page.getByRole("dialog", { name: /Add MCP server/ });
    await form.getByLabel("Starting definition", { exact: true }).selectOption("context7");
    await form.getByRole("button", { name: "Save server", exact: true }).click();
    await expect(form).toHaveCount(0);
    await clickAdd(page);
    form = page.getByRole("dialog", { name: /Add MCP server/ });
    await form.getByLabel("Server ID", { exact: true }).fill("pasted");
    await form.getByRole("button", { name: "Paste definition", exact: true }).click();
    await form
      .getByLabel("Server definition", { exact: true })
      .fill(
        '{"label":"Pasted","enabled":true,"type":"stdio","command":"never-start","env":{"TOKEN":{"credentialRef":"private-reference"}}}',
      );
    await form.getByRole("button", { name: "Review definition", exact: true }).click();
    await expect(form.getByLabel("Label", { exact: true })).toHaveValue("Pasted");
    await form.getByRole("button", { name: "Save server", exact: true }).click();
    await expect(form).toHaveCount(0);
    expect((await load(config(fixture.directory))).servers.pasted.enabled).toBe(false);
    await serverAction(page, "Remove server", "Pasted");
    await page
      .getByRole("dialog", { name: "Remove MCP server?", exact: true })
      .getByRole("button", { name: "Confirm removal", exact: true })
      .click();
    await expect
      .poll(async () => Object.keys((await load(config(fixture.directory))).servers))
      .toEqual(["docs", "context7"]);
    expect(await readdir(fixture.processLog)).toEqual(providerProcesses);
    await page.reload();
    await app(page);
    await expect(page.locator(".mcp-workspace").getByRole("table")).toContainText("Context7");
    expect(await readFile(join(fixture.directory, "config/code60/config.json"))).toEqual(legacy);
    expect(await readdir(join(fixture.directory, "state/code60/mcp-configuration"))).toEqual(
      expect.arrayContaining([expect.stringMatching(/\.backup$/)]),
    );
    await page.screenshot({ path: test.info().outputPath("mcp-user-management.png") });
  } finally {
    await fixture.close();
  }
});
test("MCP management: project moves, collision preview, cancellation, inheritance and stale files", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const project = join(fixture.directory, "alpha");
    await mkdir(project);
    const { page } = await fixture.open();
    await onboard(page);
    await createDatabase(page, fixture.directory);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await openProject(page, fixture.directory, "alpha");
    await app(page);
    let form = await add(page, "docs", "User docs");
    await form.getByRole("button", { name: "Save server", exact: true }).click();
    await expect(form).toHaveCount(0);
    await serverAction(page, "Move", "User docs");
    let move = page.getByRole("dialog", { name: "Move MCP server", exact: true });
    await move.getByLabel("Destination", { exact: true }).selectOption({ label: "alpha" });
    await expect(move.getByRole("button", { name: "Confirm move", exact: true })).toBeEnabled();
    await expect(move).toContainText("No credentials or approvals are moved");
    await move.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(stat(join(project, ".code60/mcp.json"))).rejects.toThrow();
    await serverAction(page, "Move", "User docs");
    move = page.getByRole("dialog", { name: "Move MCP server", exact: true });
    await move.getByLabel("Destination", { exact: true }).selectOption({ label: "alpha" });
    await move.getByRole("button", { name: "Confirm move", exact: true }).click();
    await expect(move).toHaveCount(0);
    expect((await load(config(fixture.directory))).servers).toEqual({});
    expect((await load(join(project, ".code60/mcp.json"))).servers.docs.label).toBe("User docs");
    expect((await stat(join(project, ".code60/mcp.json"))).mode & 0o777).toBe(0o644);
    form = await add(page, "docs", "Inherited docs");
    await form.getByRole("button", { name: "Save server", exact: true }).click();
    await expect(form).toHaveCount(0);
    await serverAction(page, "Move", "Inherited docs");
    move = page.getByRole("dialog", { name: "Move MCP server", exact: true });
    await move.getByLabel("Destination", { exact: true }).selectOption({ label: "alpha" });
    await expect(move).toContainText("destination already contains this server ID");
    await expect(move.getByRole("button", { name: "Confirm move", exact: true })).toBeDisabled();
    await move.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("tab", { name: "Project", exact: true }).click();
    await expect(page.locator(".mcp-workspace").getByRole("table")).toContainText(
      "(overrides User)",
    );
    await serverAction(page, "Edit", "User docs");
    form = page.getByRole("dialog", { name: /Edit MCP server/ });
    await form.getByLabel("Label", { exact: true }).fill("Unsaved project draft");
    const external = '{"version":1,"servers":{}}\n';
    await writeFile(join(project, ".code60/mcp.json"), external);
    await form.getByRole("button", { name: "Save server", exact: true }).click();
    await expect(form).toContainText("Configuration or project changed");
    await expect(form.getByLabel("Label", { exact: true })).toHaveValue("Unsaved project draft");
    expect(await readFile(join(project, ".code60/mcp.json"), "utf8")).toBe(external);
    await form.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(form).toHaveCount(0);
    await page.getByRole("button", { name: "Actions for Inherited docs", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "Open user configuration", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    // Reloading a now-malformed document must close the discarded form and keep writes blocked.
    form = await add(page, "draft", "Invalid reload");
    await writeFile(join(project, ".code60/mcp.json"), "malformed");
    await form.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(page.locator("#panel-mcp-servers")).toContainText("Invalid configuration");
    await expect(page.getByRole("button", { name: "Add server", exact: true })).toBeDisabled();
    await writeFile(join(project, ".code60/mcp.json"), external);
    await page.getByRole("button", { name: "MCP Servers actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Reload configurations", exact: true }).click();
    // Replacing the canonical project while a draft is open must not redirect its write.
    form = await add(page, "new", "Stale owner");
    await rename(project, `${project}-old`);
    await mkdir(project);
    await form.getByRole("button", { name: "Save server", exact: true }).click();
    await expect(form).toContainText("Configuration or project changed");
    await expect(stat(join(project, ".code60/mcp.json"))).rejects.toThrow();
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
  } finally {
    await fixture.close();
  }
});
test("MCP management: malformed files and interrupted transactions block guided writes", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    await writeFile(config(fixture.directory), '{"private-token":"never-display",', {
      mode: 0o600,
    });
    const { page } = await fixture.open();
    await onboard(page);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await app(page);
    await expect(page.locator("#panel-mcp-servers")).toContainText("Invalid configuration");
    await expect(page.getByRole("button", { name: "Add server", exact: true })).toBeDisabled();
    await expect(page.locator("body")).not.toContainText("never-display");
    const { McpConfigurationStore } = (await import(
      pathToFileURL(resolve("dist/application/index.js")).href
    )) as { McpConfigurationStore: typeof StoreType };
    // Release the backend's private writer through real backend shutdown, then seed a synthetic interrupted publication.
    await fixture.gateway.stop();
    const io = await import("node:fs/promises");
    const store = await McpConfigurationStore.open({
      stateRoot: join(fixture.directory, "state/code60/mcp-configuration"),
      userDirectory: join(fixture.directory, "config/code60"),
      io: {
        ...io,
        checkpoint: async (step) => {
          if (step === "directory-sync") throw new Error("synthetic sync failure");
        },
      },
    });
    try {
      const target = store.targetIds()[0];
      if (!target) throw new Error("No user target");
      const read = await store.read(target.targetId);
      expect(
        (
          await store.save({
            targetId: target.targetId,
            expectedRevision: read.revision,
            requestId: randomUUID(),
            text: '{"version":1,"servers":{}}\n',
          })
        ).status,
      ).toBe("recovery-required");
    } finally {
      await store.close();
    }
    await fixture.restart();
    const { page: recovered } = await fixture.open();
    await expect(recovered.getByRole("banner", { name: "Code60" })).toBeVisible();
    await app(recovered);
    await expect(recovered.locator("#panel-mcp-servers")).toContainText(
      "Pending configuration recovery blocks writes",
    );
    await expect(recovered.getByRole("button", { name: "Add server", exact: true })).toBeDisabled();
    expect(
      (await readdir(join(fixture.directory, "state/code60/mcp-configuration"))).some((f) =>
        f.endsWith(".journal"),
      ),
    ).toBe(true);
    expect(await readFile(config(fixture.directory), "utf8")).toBe('{"version":1,"servers":{}}\n');
  } finally {
    await fixture.close();
  }
});

test("MCP management: initial unsafe storage surfaces MCP_CONFIG_UNSAFE and recovers on explicit reload", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    await writeFile(config(fixture.directory), '{"version":1,"servers":{}}\n', { mode: 0o644 });
    await chmod(config(fixture.directory), 0o644);
    const { page } = await fixture.open();
    await onboard(page);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await app(page);
    const panel = page.locator("#panel-mcp-servers");
    await expect(panel).toContainText("MCP_CONFIG_UNSAFE:");
    const reload = panel.getByRole("button", { name: "Reload configuration", exact: true });
    await expect(reload).toBeVisible();
    await chmod(config(fixture.directory), 0o600);
    await reload.click();
    await expect(panel).not.toContainText("MCP_CONFIG_UNSAFE:");
    await expect(panel).toContainText("No servers configured.");
    await expect(page.getByRole("button", { name: "Add server", exact: true })).toBeEnabled();
  } finally {
    await fixture.close();
  }
});
