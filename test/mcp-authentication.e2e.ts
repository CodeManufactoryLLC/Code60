import { randomUUID } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { openMcpServers } from "./fixtures/browser-actions.js";
import { browserApp, onboard } from "./fixtures/browser-app.js";
import { oauthServer } from "./fixtures/mcp-oauth-server.js";

async function apps(page: Page) {
  await openMcpServers(page);
  await expect(page.getByLabel("Configuration", { exact: true })).toBeVisible();
}
async function authentication(page: Page) {
  await page.getByRole("button", { name: "Manage authentication", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Authentication —/ });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function secretFree(directory: string, secrets: string[]) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, item.name);
    if (item.isDirectory()) await secretFree(file, secrets);
    else {
      const bytes = await readFile(file);
      for (const secret of secrets) expect(bytes.includes(Buffer.from(secret))).toBe(false);
    }
  }
}
async function edit(page: Page, text: string) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await page.locator(".mcp-json-editor .inputarea").focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+v");
}
const reachable = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });

test("MCP credentials: explicit temporary entry, clearing, reload, no plaintext and confirmed sign-out", async ({
  browser,
}) => {
  const remote = await oauthServer(),
    fixture = await browserApp(browser);
  const secret = `synthetic-${randomUUID()}`;
  remote.acceptCredential(secret);
  const file = join(fixture.directory, "config/code60/mcp.json");
  const original = `${JSON.stringify({ version: 1, servers: { service: { label: "Header server", enabled: false, type: "http", url: `${remote.origin}/mcp`, headers: { Authorization: { credentialRef: "service-token", prefix: "Bearer " } }, auth: { type: "none" } } } })}\n`;
  try {
    await writeFile(file, original, { mode: 0o600 });
    const { page } = await fixture.open();
    await onboard(page);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await apps(page);
    let dialog = await authentication(page);
    expect(
      await dialog
        .getByLabel(/Temporary backend memory/)
        .evaluate((input) => input.getBoundingClientRect().width),
    ).toBeLessThanOrEqual(24);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: test.info().outputPath("authentication-storage-choice.png") });
    await dialog.getByLabel("Credential secret", { exact: true }).fill(secret);
    await dialog.getByText(/^Temporary backend memory —/).click();
    await expect(dialog.getByRole("radio", { name: /Temporary backend memory/ })).toBeChecked();
    await dialog.getByRole("button", { name: "Save credential", exact: true }).click();
    await expect(dialog.getByLabel("Credential secret", { exact: true })).toHaveValue("");
    await expect(dialog.getByRole("status").filter({ hasText: "Credential saved" })).toBeVisible();
    await dialog.getByRole("button", { name: /^Close Authentication/ }).click();
    await page.getByRole("button", { name: "Test connection", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "connected. 1 tools discovered" }),
    ).toBeVisible();
    expect(remote.counts.calls).toBe(0);
    expect(remote.counts.initialize).toBe(1);
    await page.reload();
    await apps(page);
    dialog = await authentication(page);
    await expect(dialog.getByLabel("Credential secret", { exact: true })).toHaveValue("");
    await expect(dialog).toContainText("credentials recorded");
    await dialog.getByRole("button", { name: "Sign out…", exact: true }).click();
    await dialog
      .locator(".cds--modal-footer")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    expect(await readFile(file, "utf8")).toBe(original);
    await dialog.getByRole("button", { name: "Sign out…", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirm sign out", exact: true }).click();
    await expect(dialog.getByRole("status").filter({ hasText: "Signed out." })).toBeVisible();
    await dialog.getByRole("button", { name: /^Close Authentication/ }).click();
    await page.getByRole("button", { name: "Test connection", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Authentication required" }),
    ).toBeVisible();
    expect(remote.counts.initialize).toBe(1);
    expect(await readFile(file, "utf8")).toBe(original);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(fixture.gateway.application.snapshot(false, true))).not.toContain(secret);
    expect(
      await page.evaluate(() =>
        JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
      ),
    ).not.toContain(secret);
    await secretFree(fixture.directory, [secret]);
    await page.screenshot({ path: test.info().outputPath("temporary-signed-out.png") });
  } finally {
    await fixture.close();
    await remote.close();
  }
});

test("MCP credentials: unavailable persistent storage never silently becomes temporary", async ({
  browser,
}) => {
  test.skip(
    process.platform !== "linux",
    "Uses a deliberately absent private Linux Secret Service address",
  );
  const remote = await oauthServer(),
    fixture = await browserApp(browser, ["--relay", "--session-info"], true, false, undefined, {
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/code60-nonexistent-synthetic-secret-service",
    });
  const secret = `synthetic-${randomUUID()}`;
  remote.acceptCredential(secret);
  const file = join(fixture.directory, "config/code60/mcp.json");
  const original = `${JSON.stringify({ version: 1, servers: { service: { label: "Storage failure", enabled: false, type: "http", url: `${remote.origin}/mcp`, headers: { Authorization: { credentialRef: "token", prefix: "Bearer " } }, auth: { type: "none" } } } })}\n`;
  try {
    await writeFile(file, original, { mode: 0o600 });
    const { page } = await fixture.open();
    await onboard(page);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await apps(page);
    const dialog = await authentication(page);
    await dialog.getByLabel("Credential secret", { exact: true }).fill(secret);
    await dialog.getByRole("button", { name: "Save credential", exact: true }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: "unavailable" })).toBeVisible();
    await expect(dialog.getByLabel("Credential secret", { exact: true })).toHaveValue("");
    await expect(dialog.getByLabel(/Secure OS storage/)).toBeChecked();
    expect(remote.counts.initialize).toBe(0);
    await dialog.getByText(/^Temporary backend memory —/).click();
    await expect(dialog.getByRole("radio", { name: /Temporary backend memory/ })).toBeChecked();
    await dialog.getByLabel("Credential secret", { exact: true }).fill(secret);
    await dialog.getByRole("button", { name: "Save credential", exact: true }).click();
    await expect(dialog.getByRole("status").filter({ hasText: "Credential saved" })).toBeVisible();
    await dialog.getByRole("button", { name: /^Close Authentication/ }).click();
    await page.getByRole("button", { name: "Test connection", exact: true }).click();
    await expect.poll(() => remote.counts.initialize).toBe(1);
    expect(await readFile(file, "utf8")).toBe(original);
    await secretFree(fixture.directory, [secret]);
  } finally {
    await fixture.close();
    await remote.close();
  }
});

test("MCP OAuth: reviewed issuer/registration, browser consent, retained JSON draft and sign-out", async ({
  browser,
}) => {
  const remote = await oauthServer(),
    fixture = await browserApp(browser, ["--relay", "--session-info", "--restore"]);
  const file = join(fixture.directory, "config/code60/mcp.json");
  const document = {
    version: 1,
    servers: {
      service: {
        label: "OAuth server",
        enabled: false,
        type: "http",
        url: `${remote.origin}/mcp`,
        headers: {},
        auth: { type: "oauth", scopes: [] },
      },
    },
  };
  const original = `${JSON.stringify(document)}\n`;
  try {
    await writeFile(file, original, { mode: 0o600 });
    const { page, context } = await fixture.open();
    await onboard(page);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await apps(page);
    let dialog = await authentication(page);
    await dialog.getByRole("button", { name: "Review issuer and scopes", exact: true }).click();
    await expect(dialog).toContainText("tools.read");
    await expect(dialog).toContainText("per installation");
    await dialog.getByText(/^Temporary backend memory —/).click();
    await expect(dialog.getByRole("radio", { name: /Temporary backend memory/ })).toBeChecked();
    await dialog.getByRole("button", { name: "Start sign-in", exact: true }).click();
    await expect(
      dialog.getByRole("link", { name: "Continue to authorization server", exact: true }),
    ).toBeVisible();
    expect(remote.counts.registrations).toBe(1);
    expect(remote.counts.token).toBe(0);
    expect(remote.counts.calls).toBe(0);
    const popup = context.waitForEvent("page");
    await dialog
      .getByRole("link", { name: "Continue to authorization server", exact: true })
      .click();
    const issuer = await popup;
    await expect(
      issuer.getByRole("button", { name: "Authorize synthetic server", exact: true }),
    ).toBeVisible();
    await page.bringToFront();
    await dialog.getByRole("button", { name: "Continue in background", exact: true }).click();
    await page.getByRole("tab", { name: "JSON", exact: true }).click();
    await expect(page.locator(".mcp-json-editor .monaco-editor")).toBeVisible();
    const draft = JSON.stringify(
      {
        ...document,
        servers: { service: { ...document.servers.service, label: "Retained OAuth draft" } },
      },
      null,
      2,
    );
    await edit(page, draft);
    await expect(
      page.getByRole("button", { name: "Save configuration", exact: true }),
    ).toBeEnabled();
    await issuer.getByRole("button", { name: "Authorize synthetic server", exact: true }).click();
    await expect(issuer.locator("body")).toContainText("Authorization response received");
    await page.bringToFront();
    await expect.poll(() => remote.counts.token).toBe(1);
    await expect(page.locator(".mcp-json-editor")).toContainText("Retained OAuth draft");
    expect(await readFile(file, "utf8")).toBe(original);
    await page.getByRole("tab", { name: "Servers", exact: true }).click();
    const guard = page.getByRole("dialog", { name: "Unsaved MCP JSON changes", exact: true });
    await guard.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator(".mcp-json-editor")).toContainText("Retained OAuth draft");
    await page.getByRole("tab", { name: "Servers", exact: true }).click();
    await guard.getByRole("button", { name: "Discard", exact: true }).click();
    dialog = await authentication(page);
    await expect(dialog).toContainText("authenticated");
    const secrets = remote.accessTokens();
    await dialog.getByRole("button", { name: /^Close Authentication/ }).click();
    await page.getByRole("button", { name: "Test connection", exact: true }).click();
    await expect.poll(() => remote.counts.initialize).toBe(1);
    expect(remote.counts.calls).toBe(0);
    dialog = await authentication(page);
    await dialog.getByRole("button", { name: "Sign out…", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirm sign out", exact: true }).click();
    await expect(dialog.getByRole("status").filter({ hasText: "Signed out." })).toBeVisible();
    expect(remote.counts.revocations).toBe(1);
    expect(await readFile(file, "utf8")).toBe(original);
    await secretFree(fixture.directory, secrets);
    await page.screenshot({ path: test.info().outputPath("oauth-signed-out.png") });
    await issuer.close();
  } finally {
    await fixture.close();
    await remote.close();
  }
});

test("MCP OAuth: Cancel and browser detach revoke pending loopback callbacks", async ({
  browser,
}) => {
  const remote = await oauthServer(),
    fixture = await browserApp(browser);
  const file = join(fixture.directory, "config/code60/mcp.json");
  try {
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        servers: {
          service: {
            label: "Cancel OAuth",
            enabled: false,
            type: "http",
            url: `${remote.origin}/mcp`,
            headers: {},
            auth: { type: "oauth", scopes: [], clientId: "supplied-native" },
          },
        },
      }),
      { mode: 0o600 },
    );
    const { page } = await fixture.open();
    await onboard(page);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await apps(page);
    const dialog = await authentication(page);
    await dialog.getByRole("button", { name: "Review issuer and scopes", exact: true }).click();
    await dialog.getByText(/^Temporary backend memory —/).click();
    await expect(dialog.getByRole("radio", { name: /Temporary backend memory/ })).toBeChecked();
    await dialog.getByRole("button", { name: "Start sign-in", exact: true }).click();
    let link = await dialog
      .getByRole("link", { name: "Continue to authorization server", exact: true })
      .getAttribute("href");
    let port = Number(new URL(new URL(link!).searchParams.get("redirect_uri")!).port);
    expect(await reachable(port)).toBe(true);
    await dialog.getByRole("button", { name: "Cancel sign-in", exact: true }).click();
    await expect.poll(() => reachable(port)).toBe(false);
    expect(remote.counts.token).toBe(0);
    await dialog.getByRole("button", { name: "Review issuer and scopes", exact: true }).click();
    await dialog.getByRole("button", { name: "Start sign-in", exact: true }).click();
    link = await dialog
      .getByRole("link", { name: "Continue to authorization server", exact: true })
      .getAttribute("href");
    port = Number(new URL(new URL(link!).searchParams.get("redirect_uri")!).port);
    // Drop only the cancellation packet, leaving the real backend attempt intact.
    await page.route("**/api/operation", async (route) => {
      const packet = route.request().postDataJSON();
      if (packet.operation === "mcp-authentication" && packet.value?.action === "cancel")
        await route.abort("failed");
      else await route.continue();
    });
    await dialog.getByRole("button", { name: /^Close Authentication/ }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(await reachable(port)).toBe(true);
    await page.unroute("**/api/operation");
    await dialog.getByRole("button", { name: /^Close Authentication/ }).click();
    await expect(dialog).not.toBeVisible();
    await expect.poll(() => reachable(port)).toBe(false);
    await authentication(page);
    await dialog.getByRole("button", { name: "Review issuer and scopes", exact: true }).click();
    await dialog.getByRole("button", { name: "Start sign-in", exact: true }).click();
    link = await dialog
      .getByRole("link", { name: "Continue to authorization server", exact: true })
      .getAttribute("href");
    port = Number(new URL(new URL(link!).searchParams.get("redirect_uri")!).port);
    await page.close();
    await expect.poll(() => reachable(port)).toBe(false);
    expect(remote.counts.token).toBe(0);
    expect(remote.counts.calls).toBe(0);
  } finally {
    await fixture.close();
    await remote.close();
  }
});
