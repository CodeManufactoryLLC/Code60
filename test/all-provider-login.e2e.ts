import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { expandNavigation } from "./fixtures/browser-actions.js";
import { browserApp } from "./fixtures/browser-app.js";
import { syntheticProviderDownload } from "./fixtures/provider-artifacts.js";
import { assertProviderStateSecretFree } from "./fixtures/provider-state-scan.js";

async function stopped(log: string, relayWorkspace?: string) {
  const records = await Promise.all(
    (await readdir(log)).map(async (file) => JSON.parse(await readFile(join(log, file), "utf8"))),
  );
  expect(records.length).toBeGreaterThan(0);
  await expect
    .poll(() =>
      records.filter(({ pid, cwd }) => {
        if (relayWorkspace && cwd === relayWorkspace) return false;
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      }),
    )
    .toEqual([]);
}

for (const [id, name] of [
  ["antigravity", "Antigravity"],
  ["claude", "Claude"],
  ["copilot", "Copilot"],
  ["droid", "Droid"],
  ["kiro", "Kiro"],
  ["opencode", "OpenCode"],
] as const) {
  test(`browser: ${name} missing install, private browser login, verification, save and restart`, async ({
    browser,
  }) => {
    const fixture = await browserApp(browser, [], false, true, syntheticProviderDownload);
    try {
      const { page, context } = await fixture.open();
      const wizard = page.locator(".agent-setup-dialog");
      await wizard.getByRole("button", { name, exact: true }).click();
      await expect(
        wizard.getByRole("button", { name: `Install ${name} and sign in`, exact: true }),
      ).toBeVisible();
      if (id === "copilot") await writeFile(join(fixture.directory, "no-keychain"), "1");
      if (id === "claude")
        await wizard.getByLabel("Sign-in method", { exact: true }).selectOption("claude-console");
      if (id === "opencode")
        await wizard.getByLabel("Sign-in method", { exact: true }).selectOption("github-copilot");
      await wizard
        .getByRole("button", { name: `Install ${name} and sign in`, exact: true })
        .click();
      const link = wizard.getByRole("link", { name: "Open sign-in page", exact: true });
      await expect(link).toBeVisible();
      if (id === "claude") await page.setViewportSize({ width: 420, height: 780 });
      await page.screenshot({ path: test.info().outputPath(`${id}-sign-in.png`) });
      expect(JSON.stringify(await page.evaluate(() => window.code60.snapshot()))).not.toMatch(
        /QA60|PRIVATE-STATE|oauth\/authorize|cli-auth/,
      );
      expect(
        await page.evaluate(() =>
          JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
        ),
      ).not.toMatch(/QA60|PRIVATE-STATE/);
      for (const host of [
        "https://claude.ai/**",
        "https://platform.claude.com/**",
        "https://accounts.google.com/**",
        "https://github.com/**",
        "https://app.factory.ai/**",
        "https://app.kiro.dev/**",
      ])
        await context.route(host, async (route) => {
          if (route.request().method() === "POST") {
            await writeFile(join(fixture.directory, `authorize-${id}`), "1");
            await route.fulfill({
              contentType: "text/html",
              body: "Authorized. Return to Code60.",
            });
          } else
            await route.fulfill({
              contentType: "text/html",
              body: '<form method="post"><label>Device code<input name="code"></label><button>Authorize</button></form><p>Authorization code: QA60-PASTE</p>',
            });
        });
      const popup = context.waitForEvent("page");
      await link.click();
      const provider = await popup;
      if (id === "claude" || id === "antigravity") {
        await expect(
          provider.getByText("Authorization code: QA60-PASTE", { exact: true }),
        ).toBeVisible();
        await wizard.getByLabel("Authorization code", { exact: true }).fill("QA60-PASTE");
        await wizard.getByRole("button", { name: "Complete sign-in", exact: true }).click();
      } else {
        const code = wizard.getByLabel("Device code", { exact: true });
        await expect(code).toHaveText("QA60-1234");
        await provider
          .getByLabel("Device code", { exact: true })
          .fill((await code.textContent()) ?? "");
        await provider.getByRole("button", { name: "Authorize", exact: true }).click();
        if (id === "copilot")
          await wizard.getByRole("button", { name: "Save login", exact: true }).click();
      }
      await expect(wizard.locator("p[role=status]")).toHaveText(`${name} connected`);
      expect(fixture.gateway.application.snapshot().agentSetup?.enabled).toEqual([id]);
      await page.screenshot({ path: test.info().outputPath(`${id}-connected.png`) });
      const saved = await readFile(join(fixture.directory, "state/code60/desktop.json"), "utf8");
      expect(JSON.parse(saved).agentSetup.version).toBe(1);
      expect(saved).not.toMatch(/QA60|PRIVATE-STATE/);
      await assertProviderStateSecretFree(join(fixture.directory, "state"), { live: true });
      await stopped(fixture.processLog, join(fixture.directory, "state/code60/relay/workspace"));
      await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
      await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Relay", exact: true })).toBeVisible();
      await fixture.restart();
      const reopened = await fixture.open();
      await expect(reopened.page.locator(".agent-setup-dialog")).toHaveCount(0);
      expect(fixture.gateway.application.snapshot().agentSetup?.enabled).toEqual([id]);
      await fixture.gateway.stop();
      await stopped(fixture.processLog);
      await assertProviderStateSecretFree(join(fixture.directory, "state"));
    } finally {
      await fixture.close();
    }
  });
}

test("browser: paste-back cancellation, rejection, retry and controlling-page takeover", async ({
  browser,
}) => {
  const fixture = await browserApp(browser, [], false, true, syntheticProviderDownload);
  try {
    const first = await fixture.open();
    const wizard = first.page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Claude", exact: true }).click();
    await wizard.getByRole("button", { name: "Install Claude and sign in", exact: true }).click();
    await wizard.getByLabel("Authorization code", { exact: true }).fill("incorrect");
    await wizard.getByRole("button", { name: "Complete sign-in", exact: true }).click();
    await expect(wizard.getByRole("alert")).toContainText("sign-in did not complete");
    await wizard.getByRole("button", { name: "Sign in to Claude", exact: true }).click();
    await expect(wizard.getByLabel("Authorization code", { exact: true })).toHaveValue("");
    const second = await fixture.open();
    await second.page.getByRole("button", { name: "Take control", exact: true }).click();
    await expect(
      first.page.getByRole("button", { name: "Take control", exact: true }),
    ).toBeVisible();
    expect(fixture.gateway.application.snapshot().agentSetup?.session?.candidate).toBeNull();
    expect(fixture.gateway.application.snapshot().agentSetup?.session?.phase).toBe("select");
    await expect(
      second.page
        .locator(".agent-setup-dialog")
        .getByRole("button", { name: "Claude", exact: true }),
    ).toBeVisible();
    expect(fixture.gateway.application.snapshot().agentSetup?.complete).toBe(false);
  } finally {
    await fixture.close();
  }
});

test("browser: paired HTTP LAN browser installs and signs in without a secure-context override", async ({
  browser,
}) => {
  const fixture = await browserApp(browser, [], false, true, syntheticProviderDownload);
  const remote = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  try {
    const local = await fixture.open();
    await local.page.getByRole("button", { name: "Close provider setup", exact: true }).click();
    await local.page.getByRole("button", { name: "Web Server (Beta)", exact: true }).click();
    const settings = local.page.getByRole("main", { name: "Web Server (Beta)", exact: true });
    await expect(settings.getByRole("switch")).toBeEnabled();
    await settings.getByRole("switch").press("Space");
    await expect(settings.locator("p[role=status]")).toHaveText("Listening");
    const url = await settings.getByRole("link").getAttribute("href");
    const pairing = await settings.getByLabel("LAN pairing code", { exact: true }).textContent();
    if (!url || !pairing) throw new Error("Missing LAN pairing details");
    const page = await remote.newPage();
    await page.goto(url);
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
    await page.getByLabel("Pairing code", { exact: true }).fill(pairing);
    await page.getByRole("button", { name: "Connect to Code60", exact: true }).click();
    await page.getByRole("button", { name: "Take control", exact: true }).click();
    const wizard = page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Kiro", exact: true }).click();
    await wizard.getByRole("button", { name: "Install Kiro and sign in", exact: true }).click();
    await expect(wizard.getByLabel("Device code", { exact: true })).toHaveText("QA60-1234");
    await local.context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await wizard.getByRole("button", { name: "Copy code", exact: true }).click();
    const copied = await local.page.evaluate(() => navigator.clipboard.readText());
    if (copied !== "QA60-1234")
      await expect(wizard.getByRole("alert")).toContainText("Select and copy it instead");
    await remote.route("https://app.kiro.dev/**", async (route) => {
      if (route.request().method() === "POST") {
        await writeFile(join(fixture.directory, "authorize-kiro"), "1");
        await route.fulfill({ contentType: "text/html", body: "Authorized" });
      } else
        await route.fulfill({
          contentType: "text/html",
          body: '<form method="post"><label>Code<input name="code"></label><button>Authorize</button></form>',
        });
    });
    const popup = remote.waitForEvent("page");
    await wizard.getByRole("link", { name: "Open sign-in page", exact: true }).click();
    const provider = await popup;
    await provider.getByLabel("Code", { exact: true }).fill("QA60-1234");
    await provider.getByRole("button", { name: "Authorize", exact: true }).click();
    await expect(wizard.locator("p[role=status]")).toHaveText("Kiro connected");
    await page.screenshot({ path: test.info().outputPath("lan-provider-connected.png") });
    await local.page.getByRole("button", { name: "Take control", exact: true }).click();
    await expandNavigation(local.page, "Experiments");
    await local.page.locator("#tab-web-server").click();
    await expect(settings.getByRole("switch")).toBeEnabled();
    await settings.getByRole("switch").press("Space");
    await expect(settings.locator("p[role=status]")).toHaveText("Off");
    expect(fixture.gateway.application.snapshot().agentSetup?.enabled).toEqual(["kiro"]);
    expect((await fetch(fixture.gateway.origin)).status).toBe(200);
  } finally {
    await remote.close();
    await fixture.close();
  }
});
