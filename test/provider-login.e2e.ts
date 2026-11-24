import { copyFile, mkdir, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { browserApp } from "./fixtures/browser-app.js";

const version = ".local/share/code60/providers/codex/0.171.0";
async function stopped(log: string, setupOnly = false) {
  const records = await Promise.all(
    (await readdir(log)).map(
      async (name) =>
        JSON.parse(await readFile(join(log, name), "utf8")) as {
          pid: number;
          kind?: string;
          cwd?: string;
        },
    ),
  );
  expect(records.length).toBeGreaterThan(0);
  await expect
    .poll(() =>
      records.filter(({ pid, kind, cwd }) => {
        if (
          setupOnly &&
          !["npm", "codex", "cli.mjs"].includes(kind ?? "") &&
          !cwd?.includes("code60-agent-probe-")
        )
          return false;
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

test("browser: fresh Codex install, private device login, ACP verification, save and restart", async ({
  browser,
}) => {
  const fixture = await browserApp(browser, [], false, true);
  try {
    const { page, context } = await fixture.open();
    const wizard = page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Codex", exact: true }).click();
    const install = wizard.getByRole("button", { name: "Install Codex and sign in", exact: true });
    await expect(install).toBeVisible();
    expect(await readdir(fixture.processLog)).toEqual([]);
    await install.click();
    const code = wizard.getByLabel("Device code", { exact: true });
    await expect(code).toHaveText("QA60-1234");
    const snapshot = await page.evaluate(() => window.code60.snapshot());
    expect(JSON.stringify(snapshot)).not.toMatch(/QA60-1234|auth\.openai\.com/);
    expect(snapshot.agentSetup?.complete).toBe(false);
    expect(snapshot.runs).toHaveLength(0);
    expect(
      await page.evaluate(() =>
        JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
      ),
    ).not.toMatch(/QA60-1234|auth\.openai/);
    expect((await stat(join(fixture.directory, version))).mode & 0o777).toBe(0o700);
    await page.screenshot({ path: test.info().outputPath("codex-device-login.png") });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await wizard.getByRole("button", { name: "Copy code", exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("QA60-1234");
    await context.route("https://auth.openai.com/**", async (route) => {
      if (new URL(route.request().url()).pathname.endsWith("/complete")) {
        expect(route.request().postData()).toBe("code=QA60-1234");
        await writeFile(join(fixture.directory, "authorize"), "synthetic authorization\n");
        await route.fulfill({ contentType: "text/html", body: "Signed in" });
      } else
        await route.fulfill({
          contentType: "text/html",
          body: '<form method="post" action="/codex/device/complete"><label>Device code<input name="code"></label><button>Authorize</button></form>',
        });
    });
    const popup = context.waitForEvent("page");
    await wizard.getByRole("link", { name: "Open sign-in page", exact: true }).click();
    const provider = await popup;
    await provider.getByLabel("Device code").fill((await code.textContent()) ?? "");
    await provider.getByRole("button", { name: "Authorize", exact: true }).click();
    await expect(wizard.locator("p[role=status]")).toHaveText("Codex connected");
    await expect(wizard.getByText("Connected", { exact: true })).toBeVisible();
    expect(fixture.gateway.application.snapshot().agentSetup?.enabled).toEqual(["codex"]);
    expect(await readFile(join(fixture.directory, ".codex/auth.json"), "utf8")).toBe(
      '{"synthetic":true}\n',
    );
    await stopped(fixture.processLog, true);
    await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Relay", exact: true })).toBeVisible();
    const states = await readFile(join(fixture.directory, "state/code60/desktop.json"), "utf8");
    expect(JSON.parse(states).agentSetup.version).toBe(1);
    expect(states).not.toMatch(/QA60|auth\.openai/);
    for (const name of await readdir(join(fixture.directory, "state"), { recursive: true })) {
      const file = await open(join(fixture.directory, "state", name), "r");
      try {
        if ((await file.stat()).isFile())
          expect(await file.readFile("utf8")).not.toMatch(
            /QA60-1234|PRIVATE_PROVIDER_ERROR|auth\.openai\.com\/codex\/device/,
          );
      } finally {
        await file.close();
      }
    }
    await fixture.restart();
    const reopened = await fixture.open();
    await expect(reopened.page.locator(".agent-setup-dialog")).toHaveCount(0);
    expect(fixture.gateway.application.snapshot().agentSetup?.complete).toBe(true);
    expect((await stat(join(fixture.directory, version, "bin/codex"))).isFile()).toBe(true);
    await fixture.gateway.stop();
    await stopped(fixture.processLog);
  } finally {
    await fixture.close();
  }
});

test("browser: Codex cancellation, disabled device login, retry and control takeover", async ({
  browser,
}) => {
  const fixture = await browserApp(browser, [], false, true);
  try {
    const first = await fixture.open();
    const wizard = first.page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Codex", exact: true }).click();
    await wizard.getByRole("button", { name: "Install Codex and sign in", exact: true }).click();
    await expect(wizard.getByLabel("Device code")).toHaveText("QA60-1234");
    await wizard.getByRole("button", { name: "Cancel attempt", exact: true }).click();
    await expect(wizard.getByRole("button", { name: "Codex", exact: true })).toBeVisible();
    await stopped(fixture.processLog);
    await wizard.getByRole("button", { name: "Codex", exact: true }).click();
    await wizard.getByRole("button", { name: "Sign in to Codex", exact: true }).click();
    await expect(wizard.getByLabel("Device code")).toHaveText("QA60-1234");
    await first.page.reload();
    await expect(wizard.getByRole("button", { name: "Codex", exact: true })).toBeVisible();
    await stopped(fixture.processLog);
    await writeFile(join(fixture.directory, "disabled-login"), "disabled\n");
    await wizard.getByRole("button", { name: "Codex", exact: true }).click();
    await wizard.getByRole("button", { name: "Sign in to Codex", exact: true }).click();
    await expect(wizard.getByRole("alert")).toContainText("device-code login is enabled");
    expect(await first.page.content()).not.toContain("PRIVATE_PROVIDER_ERROR");
    await stopped(fixture.processLog);
    // Retrying starts a new owned attempt. The observer never receives the challenge.
    await rm(join(fixture.directory, "disabled-login"));
    await wizard.getByRole("button", { name: "Sign in to Codex", exact: true }).click();
    await expect(wizard.getByLabel("Device code")).toHaveText("QA60-1234");
    const second = await fixture.open();
    await expect(
      second.page.getByRole("button", { name: "Take control", exact: true }),
    ).toBeVisible();
    expect(await second.page.content()).not.toContain("QA60-1234");
    await second.page.getByRole("button", { name: "Take control", exact: true }).click();
    await stopped(fixture.processLog);
    expect(fixture.gateway.application.snapshot().agentSetup?.complete).toBe(false);
    await expect
      .poll(() => fixture.gateway.application.snapshot().agentSetup?.session?.phase)
      .toBe("select");
  } finally {
    await fixture.close();
  }
});

test("browser: existing authenticated Codex connects without installation or login", async ({
  browser,
}) => {
  const fixture = await browserApp(browser, [], false, true);
  try {
    await copyFile("test/fixtures/fake-codex-tools.mjs", join(fixture.directory, "tools/codex"));
    await mkdir(join(fixture.directory, ".codex"), { mode: 0o700 });
    await writeFile(join(fixture.directory, ".codex/auth.json"), '{"synthetic":true}\n', {
      mode: 0o600,
    });
    const { page } = await fixture.open();
    const wizard = page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Codex", exact: true }).click();
    await expect(wizard.locator("p[role=status]")).toHaveText("Codex connected");
    expect(fixture.gateway.application.snapshot().agentSetup?.complete).toBe(true);
    expect(await readFile(join(fixture.directory, "tools/codex"), "utf8")).toContain(
      "External npm",
    );
    await expect(wizard.getByLabel("Device code")).toHaveCount(0);
    await stopped(fixture.processLog, true);
    await fixture.gateway.stop();
    await stopped(fixture.processLog);
  } finally {
    await fixture.close();
  }
});

test("browser: failed Codex installation retries and closing sign-in cleans up", async ({
  browser,
}) => {
  const fixture = await browserApp(browser, [], false, true);
  try {
    await writeFile(join(fixture.directory, "fail-install"), "synthetic failure\n");
    const { page } = await fixture.open();
    const wizard = page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Codex", exact: true }).click();
    await wizard.getByRole("button", { name: "Install Codex and sign in", exact: true }).click();
    await expect(wizard.getByRole("alert")).toContainText("Codex installation failed");
    await stopped(fixture.processLog);
    await rm(join(fixture.directory, "fail-install"));
    await wizard.getByRole("button", { name: "Install Codex and sign in", exact: true }).click();
    await expect(wizard.getByLabel("Device code")).toHaveText("QA60-1234");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(wizard.getByRole("link", { name: "Open sign-in page" })).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath("codex-login-narrow.png") });
    await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
    await expect(wizard).toHaveCount(0);
    await stopped(fixture.processLog);
    await page.getByRole("button", { name: "Set up agents", exact: true }).click();
    await wizard.getByRole("button", { name: "Codex", exact: true }).click();
    await wizard.getByRole("button", { name: "Sign in to Codex", exact: true }).click();
    await expect(wizard.getByLabel("Device code")).toHaveText("QA60-1234");
    await page.keyboard.press("Escape");
    await expect(wizard).toHaveCount(0);
    await stopped(fixture.processLog);
    expect(fixture.gateway.application.snapshot().agentSetup?.complete).toBe(false);
  } finally {
    await fixture.close();
  }
});
