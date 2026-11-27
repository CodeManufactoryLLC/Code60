import { execFile, execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, type Page, test } from "@playwright/test";
import { expandNavigation } from "./fixtures/browser-actions.js";
import { browserApp, createDatabase, onboard, openProject } from "./fixtures/browser-app.js";
import { commitFixture } from "./fixtures/git-repository.js";

test("browser: skips pairing by default and can require or skip it again without restarting work", async ({
  browser,
}) => {
  const fixture = await browserApp(browser, ["--relay", "--session-info"], false);
  const gate = join(fixture.directory, "finish-policy-smoke");
  const policy = (mode: string) =>
    promisify(execFile)(
      process.execPath,
      [resolve("dist/management/main.js"), "pairing", mode, "--yes"],
      { env: fixture.env, timeout: 15_000 },
    );
  try {
    const { page } = await fixture.open();
    await start(page, fixture.directory);
    await expect(page.getByLabel("Pairing code", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Backend connected", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Backend connected", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Pairing code", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    const chat = page.locator(".orchestration-chat-page:visible");
    const composer = chat.getByRole("textbox", { name: "Message to orchestrator", exact: true });
    await composer.fill(
      JSON.stringify([
        { message: "Waiting during pairing policy change" },
        { waitForFile: gate },
        { message: "Continued after pairing policy change" },
      ]),
    );
    await composer.press("Enter");
    await expect(chat).toContainText("Waiting during pairing policy change");
    const launches = await readdir(fixture.processLog);
    await policy("on");
    await expect(page.getByLabel("Pairing code", { exact: true })).toBeVisible();
    await page.getByLabel("Pairing code", { exact: true }).fill(fixture.gateway.proof());
    await page.getByRole("button", { name: "Connect to Code60", exact: true }).click();
    await expect(page.getByText("Backend connected", { exact: true })).toBeVisible();
    await policy("off");
    await expect(page.getByText("Backend connected", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Pairing code", { exact: true })).toHaveCount(0);
    expect(await readdir(fixture.processLog)).toEqual(launches);
    await writeFile(gate, "continue");
    await expect(chat).toContainText("Continued after pairing policy change");
    await expect(composer).toBeEditable();
    const second = await fixture.open();
    await expect(
      second.page.getByRole("button", { name: "Take control", exact: true }),
    ).toBeVisible();
    await second.page.getByRole("button", { name: "Take control", exact: true }).click();
    await expect(page.getByRole("button", { name: "Take control", exact: true })).toBeVisible();
    expect(await readFile(join(fixture.directory, "projects.sqlite"))).toBeTruthy();
    await fixture.restart();
    const reopened = await fixture.open();
    await expect(reopened.page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await expect(reopened.page.getByLabel("Pairing code", { exact: true })).toHaveCount(0);
    expect(JSON.parse((await policy("status")).stdout)).toEqual({ requirePairing: false });
  } finally {
    await writeFile(gate, "continue").catch(() => {});
    await fixture.close();
  }
});

async function start(page: Page, directory: string) {
  await onboard(page);
  await createDatabase(page, directory);
  await expect
    .poll(async () => (await page.evaluate(() => window.code60.snapshot())).database)
    .toBe(join(directory, "projects.sqlite"));
  await expect(page.getByRole("heading", { level: 1, name: "Relay", exact: true })).toBeVisible();
}
async function openFromHome(page: Page, name: string) {
  await page.getByRole("link", { name: "Code60", exact: true }).click();
  await page.getByRole("button", { name: `Open ${name}`, exact: true }).click();
}
async function app(page: Page, name: string) {
  await openFromHome(page, "Apps");
  await page.getByRole("button", { name: `Open ${name}`, exact: true }).click();
}

test("browser: approved conversation continues with no browser and reattaches without resubmitting", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  const gate = join(fixture.directory, "continue");
  const startReply = join(fixture.directory, "start-reply");
  try {
    const first = await fixture.open();
    await start(first.page, fixture.directory);
    await first.page.getByRole("button", { name: "Relay", exact: true }).click();
    const composer = first.page.getByRole("textbox", {
      name: "Message to orchestrator",
      exact: true,
    });
    const pulse = first.page.locator("#navigation-sidebar .relay-pulse");
    const toggle = first.page.getByRole("checkbox", { name: "relay animation", exact: true });
    await expect(toggle).not.toBeChecked();
    await expect(first.page.locator(".relay-pulse-row")).toHaveCount(0);
    await toggle.focus();
    await toggle.press("Space");
    await expect(toggle).toBeChecked();
    await pulse.focus();
    await expect(first.page.locator(".relay-pulse-label")).toHaveText("Relay: Idle");
    await expect(first.page.locator(".relay-pulse-label")).toBeVisible();
    for (const width of [320, 375, 1440]) {
      await first.page.setViewportSize({ width, height: width < 1440 ? 667 : 900 });
      const forward = await first.page.getByRole("button", { name: "Forward" }).boundingBox();
      const label = first.page.locator(".relay-dot-toggle label");
      const workspace = first.page.getByRole("button", { name: "Workspace", exact: true });
      await expect(workspace).toBeInViewport({ ratio: 1 });
      await expect(label.getByText("relay animation", { exact: true })).toHaveClass(
        /cds--visually-hidden/,
      );
      await label.hover();
      await expect(label).toHaveAttribute("title", "relay animation");
      const bounds = await label.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(forward!.x + forward!.width);
      await label.click();
      await expect(toggle).not.toBeChecked();
      await expect(first.page.locator(".relay-pulse-row")).toHaveCount(0);
      await label.click();
      await expect(toggle).toBeChecked();
      if (width < 1440)
        await first.page.getByRole("button", { name: "Open product navigation" }).click();
      await pulse.focus();
      await pulse.click({ trial: true }); // Measure after the mobile drawer finishes opening.
      const header = first.page.locator("#navigation-sidebar-content");
      const layout = await header.evaluate((content) => {
        const top = content.getBoundingClientRect();
        const dot = content.querySelector(".relay-pulse")?.getBoundingClientRect();
        const chat = content.querySelector("#nav-group-Chat")?.getBoundingClientRect();
        if (!dot || !chat) throw new Error("Relay and Chat must be present");
        return [
          chat.top - top.top,
          dot.x + dot.width / 2 - (top.x + top.width / 2),
          dot.y + dot.height / 2 - (top.top + chat.top) / 2,
        ];
      });
      expect(layout).toEqual([96, 0, 0]);
      const scene = header.locator(".relay-pulse-row");
      const room = scene.locator("svg.relay-pulse-room");
      await expect(room).toBeVisible();
      const scale = await room.evaluate((svg: SVGSVGElement) => {
        const matrix = svg.getScreenCTM();
        return matrix && [matrix.a, matrix.d];
      });
      expect(scale?.[0]).toBeGreaterThan(0);
      expect(scale?.[0]).toEqual(scale?.[1]);
      const surfaces = room.locator("path, rect");
      await expect(surfaces).toHaveCount(5);
      for (const surface of await surfaces.all()) {
        await expect(surface).toHaveCSS("stroke", "none");
        await expect(surface).toHaveCSS("fill", /url\(/);
      }
      await scene.screenshot({ path: test.info().outputPath(`relay-room-${width}.png`) });
      if (width < 1440)
        await first.page.getByRole("button", { name: "Close product navigation" }).click();
    }
    await composer.focus();
    await expect(pulse).toHaveAccessibleName("Relay: Listening");
    await composer.fill(
      JSON.stringify([
        { waitForFile: startReply },
        { message: "Before tab closed" },
        { waitForFile: gate },
        { message: "After tab closed" },
      ]),
    );
    await composer.press("Enter");
    const chat = first.page.locator(".orchestration-chat-page:visible");
    const status = chat.locator(".activity-display");
    const circle = status.locator(".cds--loading--small");
    await expect(pulse).toHaveAccessibleName("Relay: Thinking");
    await expect(pulse.locator(".relay-orbit")).not.toHaveCSS("animation-name", "none");
    await expect(circle).toBeVisible();
    await expect(circle).not.toHaveCSS("animation-name", "none");
    await expect(status).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(status).toHaveCSS("border-top-width", "0px");
    await expect(status.locator(".activity-name")).toHaveCSS("animation-name", "none");
    await first.page.emulateMedia({ colorScheme: "dark" });
    await status.hover();
    await expect(circle.locator(".cds--loading__svg")).toHaveCSS("fill", "none");
    await expect(status).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await first.page
      .locator(".relay-pulse-row")
      .screenshot({ path: test.info().outputPath("relay-room-dark.png") });
    await first.page.screenshot({ path: test.info().outputPath("chat-activity-circle-dark.png") });
    await status.press("Enter");
    await expect(status).toHaveAttribute("aria-expanded", "true");
    await status.press("Escape");
    await expect(status).toHaveAttribute("aria-expanded", "false");
    await first.page.emulateMedia({ reducedMotion: "reduce" });
    await expect(circle).toHaveCSS("animation-name", "none");
    await expect(pulse.locator(".relay-orbit")).toHaveCSS("animation-name", "none");
    await first.page.emulateMedia({ forcedColors: "active" });
    await expect(pulse.locator(".relay-pulse-core")).toHaveCSS("background-image", "none");
    await expect(first.page.locator(".relay-pulse-room")).toBeHidden();
    await expect(pulse.locator(".relay-orbit")).toBeVisible();
    await first.page.emulateMedia({ forcedColors: "none" });
    await writeFile(startReply, "release");
    await expect(pulse).toHaveAccessibleName("Relay: Speaking");
    await expect(chat.getByRole("article", { name: "Assistant" })).toContainText(
      "Before tab closed",
    );
    await expect(chat.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
    await expect(chat.locator(".cds-aichat--message--response")).toHaveCount(2);
    await expect(chat.locator('.activity-display[data-activity="responding"]')).toHaveCount(0);
    await expect(
      chat.locator(".embedded-chat .activity-details:not(.chat-turn-content *)"),
    ).toHaveCount(0);
    const launches = await readdir(fixture.processLog);
    await first.context.close();
    await writeFile(gate, "release");
    const second = await fixture.open();
    await second.page.getByRole("button", { name: "Take control", exact: true }).click();
    await expect(second.page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await second.page.getByRole("button", { name: "Relay", exact: true }).click();
    await expect(second.page.locator(".orchestration-chat-page:visible")).toContainText(
      "After tab closed",
    );
    expect(await readdir(fixture.processLog)).toEqual(launches);
    await expect(
      second.page.getByRole("textbox", { name: "Message to orchestrator", exact: true }),
    ).toBeEditable();
  } finally {
    await writeFile(gate, "release").catch(() => {});
    await fixture.close();
  }
});

test("browser: chat links require an explicit decision and open with an isolated opener", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const { page, context } = await fixture.open();
    await start(page, fixture.directory);
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    const composer = page.getByRole("textbox", { name: "Message to orchestrator", exact: true });
    const url = "https://example.test/fixture?view=modal";
    await context.route(url, (route) =>
      route.fulfill({ contentType: "text/html", body: "Fixture destination" }),
    );
    await composer.fill(JSON.stringify([{ message: `[Fixture destination](${url})` }]));
    await composer.press("Enter");
    const source = page.getByRole("link", { name: /Fixture destination: https/ });
    await source.click();
    const dialog = page.getByRole("dialog", { name: "Open web link?", exact: true });
    await expect(dialog).toContainText(url);
    await page.mouse.click(2, 2);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(source).toBeFocused();
    expect(context.pages()).toHaveLength(1);
    await source.press("Enter");
    const [destination] = await Promise.all([
      context.waitForEvent("page"),
      dialog.getByRole("button", { name: "Open link", exact: true }).click(),
    ]);
    await expect(destination).toHaveURL(url);
    expect(await destination.evaluate(() => window.opener === null)).toBe(true);
    await expect(dialog).toHaveCount(0);
  } finally {
    await fixture.close();
  }
});

test("browser: custom assistant, memory settings and manual update information survive refresh", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const { page } = await fixture.open();
    await start(page, fixture.directory);
    await page.getByRole("tab", { name: "Custom Assistants", exact: true }).click();
    await page.getByRole("button", { name: "New Assistant", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "New Assistant", exact: true });
    await editor.getByLabel("Name", { exact: true }).fill("Browser reviewer");
    await editor
      .getByLabel("Special instructions", { exact: true })
      .fill("Review the requested change with concise findings.");
    await page.route("**/api/operation", async (route) => {
      if (route.request().postDataJSON()?.operation === "custom-agent")
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "Fixture save rejected" }),
        });
      else await route.continue();
    });
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      editor.getByRole("alert").filter({ hasText: "Fixture save rejected" }),
    ).toBeVisible();
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Browser reviewer");
    await expect(editor.getByLabel("Special instructions", { exact: true })).toHaveValue(
      "Review the requested change with concise findings.",
    );
    await page.unroute("**/api/operation");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Open Browser reviewer", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Open Browser reviewer", exact: true }).click();
    const reviewer = page.getByRole("main", { name: "Browser reviewer", exact: true });
    await expect(reviewer).toBeVisible();
    const reviewerInput = reviewer.getByRole("textbox", {
      name: "Message to orchestrator",
      exact: true,
    });
    await reviewerInput.fill(JSON.stringify([{ message: "Reviewer response" }]));
    await reviewerInput.press("Enter");
    await expect(reviewer.getByRole("article", { name: "Assistant" })).toHaveText(
      /Reviewer response/,
    );
    await app(page, "Memory");
    const memory = page.getByRole("switch", { name: "Memory", exact: true });
    await memory.focus();
    await page.keyboard.press("Space");
    await expect(memory).not.toBeChecked();
    await page.reload();
    await app(page, "Memory");
    await expect(memory).not.toBeChecked();
    await memory.focus();
    await page.keyboard.press("Space");
    await expect(memory).toBeChecked();
    await app(page, "Updates");
    await expect(page.locator(".updates-page, #app-updates").first()).toContainText(
      "code60 update",
    );
    await expect(page.locator("#app-updates")).toContainText("Installed version:");
    await page.setViewportSize({ width: 900, height: 760 });
    await page.screenshot({ path: test.info().outputPath("browser-manual-update.png") });
    expect(await readFile(join(fixture.directory, "projects.sqlite"))).toBeTruthy();
  } finally {
    await fixture.close();
  }
});

test("browser: Carbon application navigation, appearance controls and retained drafts", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const { page } = await fixture.open();
    page.setDefaultTimeout(10_000);
    await start(page, fixture.directory);
    await openFromHome(page, "Apps");
    await expect(page.locator(".page-panel:not([hidden])")).toHaveCount(1);
    await expect(page.locator("#panel-apps .navigation-list-row").first()).toBeVisible();
    await expect(page.locator("#panel-apps [data-slot='card']")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Product navigation" })).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("carbon-apps-light.png"),
      animations: "disabled",
    });
    // Measure visible content from the workspace edge across both shell layouts.
    async function expectPageAlignment(heading: string, content: string) {
      for (const [width, inset] of [
        [390, 16],
        [672, 32],
        [673, 100],
        [768, 100],
        [1600, 100],
      ] as const) {
        await page.setViewportSize({ width, height: 1000 });
        const workspace = page.locator(".app-workspace");
        const title = page.locator(heading).filter({ visible: true }).first();
        const body = page.locator(content).filter({ visible: true }).first();
        await expect
          .poll(async () => {
            const left = (element: Element) => element.getBoundingClientRect().left;
            const bounds = await workspace.evaluate((el) => el.getBoundingClientRect().toJSON());
            const panelRight = await workspace
              .locator(".page-panel:not([hidden])")
              .evaluate((el) => el.getBoundingClientRect().right);
            return [
              (await title.evaluate(left)) - bounds.left,
              (await body.evaluate(left)) - bounds.left,
              bounds.right - panelRight,
            ];
          })
          .toEqual([inset, inset, inset]);
      }
    }
    await expectPageAlignment("#panel-apps .content-page-title", "#panel-apps .navigation-list");
    const nav = page.getByRole("navigation", { name: "Product navigation" });
    const group = (name: string) => nav.getByRole("button", { name, exact: true });
    await expandNavigation(page, "Connect");
    const connect = group("Connect");
    const mcp = nav.getByRole("tab", { name: "MCP Servers", exact: true });
    for (const name of ["Automate", "Experiments"])
      await expect(group(name)).toHaveAttribute("aria-expanded", "false");
    const fontSize = (el: Element) => parseFloat(getComputedStyle(el).fontSize);
    expect(
      await connect.locator(".cds--side-nav__submenu-title").evaluate(fontSize),
    ).toBeGreaterThan(await mcp.locator(".page-tab-label").evaluate(fontSize));
    // Responsive layout can settle before the sidebar's input fence is released.
    await expect(nav).toHaveJSProperty("inert", false);
    await mcp.press("Escape");
    await expect(connect).toBeFocused();
    await expect(connect).toHaveAttribute("aria-expanded", "false");
    await expect(mcp).toBeHidden();
    await expect(page.locator("#panel-apps")).toBeVisible();
    await connect.press("Space");
    await expect(mcp).toBeVisible();
    await mcp.click();
    await expandNavigation(page, "Customize");
    const alternate = nav
      .getByRole("tablist", { name: "Customize", exact: true })
      .getByRole("tab", { name: "MCP Servers" });
    await alternate.click();
    await expect(alternate).toHaveAttribute("aria-selected", "true");
    await expect(alternate).toBeFocused();
    await expect(page.locator("#panel-mcp-servers")).toBeVisible();
    await openFromHome(page, "Apps");
    await group("Automate").press("Enter");
    await expect(nav.getByRole("tab", { name: "Scheduled Jobs" })).toBeVisible();
    await group("Automate").click();
    await page.getByRole("button", { name: "Open Scheduled Jobs", exact: true }).click();
    await expect(group("Automate")).toHaveAttribute("aria-expanded", "true");
    await expect(nav.getByRole("tab", { name: "Scheduled Jobs" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("link", { name: "Skip to main content" }).press("Enter");
    await expect(page.locator("#panel-automations")).toBeFocused();
    await expectPageAlignment("#jobs-page-heading", "#panel-automations .cds--tabs");
    const customize = nav.getByRole("tablist", { name: "Customize", exact: true });
    await expect(customize.getByRole("tab")).toHaveText([
      "Internal Prompts",
      "Commands",
      "MCP Servers",
    ]);
    await customize.getByRole("tab", { name: "Internal Prompts", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Internal Prompts", level: 1, exact: true }),
    ).toBeVisible();
    const promptPanel = page.locator("#panel-prompts");
    await expect(promptPanel.locator(".prompt-system-toggle span:first-of-type")).toHaveText([
      "Command",
      "Context",
      "Contract",
      "Handoff",
      "Memory",
      "Plan",
      "Review",
      "Tactic",
      "Task",
      "Utility",
      "Worker",
    ]);
    await expect(promptPanel.locator(".prompt-editor-id-badge code")).toHaveText(
      "contract.operating",
    );
    const promptFilter = promptPanel.getByRole("searchbox", { name: "Filter prompts" });
    await promptFilter.fill("plan.accepted.project");
    await promptPanel.getByRole("button", { name: /plan\.accepted\.project/ }).click();
    await expect(promptPanel.locator(".prompt-editor-id-badge code")).toHaveText(
      "plan.accepted.project",
    );
    await promptPanel.getByLabel("Template", { exact: true }).fill("Run accepted plan {{planId}}.");
    await promptPanel.getByRole("button", { name: "Save", exact: true }).click();
    await expect(promptPanel.getByText("Source: Saved edit", { exact: true })).toBeVisible();
    await promptPanel.getByRole("button", { name: "Reset to default", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Reset template", exact: true })
      .click();
    await expect(promptPanel.getByText("Source: Saved edit", { exact: true })).toBeHidden();
    await promptFilter.fill("contract.relay-addendum");
    await promptPanel.getByRole("button", { name: /contract\.relay-addendum/ }).click();
    await expect(promptPanel.locator(".prompt-editor-id-badge code")).toHaveText(
      "contract.relay-addendum",
    );
    await expect(promptPanel.locator(".prompt-editor-readonly-note")).toContainText(
      "Read-only prompt",
    );
    await expect(promptPanel.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    await promptFilter.fill("");
    await customize.getByRole("tab", { name: "Commands", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Commands", level: 1, exact: true }),
    ).toBeVisible();
    const form = page.locator("#panel-commands form");
    await expectPageAlignment(
      "#panel-commands .content-page-title",
      "#panel-commands .prompt-editor-list",
    );
    await expect(form.locator("[aria-invalid=true]")).toHaveCount(0);
    await expect(form.getByRole("button", { name: "Discard changes" })).toBeDisabled();
    const name = form.getByLabel("Name", { exact: true });
    await name.fill("Invalid name");
    await name.press("Tab");
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(form.getByText("Use 1–64 lowercase letters, digits or hyphens")).toBeVisible();
    await name.fill("review");
    await expect(name).not.toHaveAttribute("aria-invalid", "true");
    await form.getByRole("button", { name: "Discard changes" }).click();
    await expect(name).toHaveValue("");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect(form.getByLabel("Title", { exact: true })).toBeFocused();
    await expect(form.locator("[aria-invalid=true]")).toHaveCount(3);
    await app(page, "Appearance");
    const appearance = page.locator("#panel-settings-appearance");
    await expect(appearance.getByRole("switch", { name: "Monochrome" })).toHaveCount(0);
    const picker = appearance.getByLabel("Accent color", { exact: true });
    const reset = appearance.getByRole("button", { name: "Reset to verdigris" });
    await expect(picker).toHaveValue("#43b3ae");
    await expect(reset).toBeDisabled();
    const otherTab = await page.context().newPage();
    await otherTab.goto(page.url());
    await expect(otherTab.locator("html")).toHaveCSS("--code60-accent", "#43b3ae");
    await picker.fill("#813051");
    await expect(otherTab.locator("html")).toHaveCSS("--code60-accent", "#813051");
    await otherTab.close();
    await expect(reset).toHaveCSS("color", "rgb(129, 48, 81)");
    await page.reload();
    await expect(picker).toHaveValue("#813051");
    await appearance.getByRole("combobox", { name: "Theme", exact: true }).selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
    await expect(reset).toHaveCSS("color", "rgb(194, 174, 180)");
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    const prompt = page.getByRole("textbox", { name: "Message to orchestrator", exact: true });
    await expect(prompt).toHaveCSS("--cds-link-primary", "#c2aeb4");
    await app(page, "Appearance");
    await page.emulateMedia({ forcedColors: "active" });
    await expect(page.locator("html")).toHaveCSS("--cds-link-primary", "LinkText");
    await page.emulateMedia({ forcedColors: "none" });
    await reset.click();
    await expect(picker).toHaveValue("#43b3ae");
    await expect(page.getByRole("navigation", { name: "Product navigation" })).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("carbon-appearance-dark.png"),
      animations: "disabled",
    });
    await appearance.getByRole("combobox", { name: "Theme", exact: true }).selectOption("light");
    await page.getByRole("tab", { name: "Text", exact: true }).click();
    const size = page
      .locator("#panel-settings-text")
      .getByRole("combobox", { name: "Interface text size", exact: true })
      .first();
    await size.selectOption("18");
    await size.press("Tab");
    await expect(size).toHaveValue("18");
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    const composer = page
      .locator(".orchestration-chat-page:visible")
      .getByRole("textbox", { name: "Message to orchestrator", exact: true });
    await expect(composer).toBeEditable();
    await expect
      .poll(() =>
        page
          .locator(".chat-workspace-body")
          .evaluate((body) =>
            Math.round(
              body.getBoundingClientRect().height -
                (body.parentElement?.getBoundingClientRect().height ?? 0),
            ),
          ),
      )
      .toBe(0);
    await composer.fill("Unsent Carbon migration draft");
    for (const [groupName, destinations] of [
      [
        "Contributor Tools",
        [
          ["Memory Tester", "episodic-memory"],
          ["Retrieval Tests", "rag"],
        ],
      ],
      [
        "Manage",
        [
          ["About", "settings-about"],
          ["Polling", "settings-polling-settings"],
          ["Updates", "settings-updates"],
        ],
      ],
      ["Personalize", [["Table Defaults", "settings-table-defaults"]]],
      ["Experiments", [["Web Server (Beta)", "web-server"]]],
    ] as const) {
      await expandNavigation(page, groupName);
      for (const [label, panelId] of destinations) {
        await nav.getByRole("tab", { name: label, exact: true }).click();
        await expect(page.locator(`#panel-${panelId}`)).toBeVisible();
        await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
      }
    }
    for (const groupName of ["Develop", "Automate"] as const)
      await expandNavigation(page, groupName);
    await page.setViewportSize({ width: 1600, height: 1280 });
    await page.screenshot({ path: test.info().outputPath("sidebar-groups.png") });
    await app(page, "Memory");
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    await expect(composer).toHaveValue("Unsent Carbon migration draft");
    expect(fixture.gateway.application.snapshot().runs).toHaveLength(0);
  } finally {
    await fixture.close();
  }
});

test("browser: Carbon scheduled jobs edit, run, evidence, cancellation and browser independence", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const fixture = await browserApp(browser);
  const repo = join(fixture.directory, "scheduled-repo");
  const gate = join(fixture.directory, "release-schedule");
  const cancelGate = join(fixture.directory, "cancel-schedule");
  await mkdir(repo);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8", timeout: 10_000 });
  git("init", "-q", "-b", "main");
  await writeFile(join(repo, "result.txt"), "original\n");
  await writeFile(join(repo, "unrelated.txt"), "base\n");
  git("add", ".");
  commitFixture(repo);
  await writeFile(join(repo, "unrelated.txt"), "staged\n");
  git("add", "unrelated.txt");
  await writeFile(join(repo, "unrelated.txt"), "unstaged\n");
  const head = git("rev-parse", "HEAD");
  const index = await readFile(join(repo, ".git/index"));
  const jobName = "Carbon scheduled checks";
  const savedPrompt = (wait: string) =>
    JSON.stringify([
      { waitForFile: wait },
      { write: { path: "result.txt", content: "scheduled result\n" } },
      { message: "Schedule completed offline" },
    ]);
  let ownedPids: number[] = [];
  const unchanged = async () => {
    expect(await readFile(join(repo, "result.txt"), "utf8")).toBe("original\n");
    expect(await readFile(join(repo, "unrelated.txt"), "utf8")).toBe("unstaged\n");
    expect(git("show", ":unrelated.txt")).toBe("staged\n");
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(await readFile(join(repo, ".git/index"))).toEqual(index);
  };
  try {
    const first = await fixture.open();
    first.page.setDefaultTimeout(10_000);
    await start(first.page, fixture.directory);
    await expandNavigation(first.page, "Manage");
    const appsTab = first.page.getByRole("tab", { name: "System Manager", exact: true });
    const tabStyles = () =>
      appsTab.evaluate((element) => {
        const style = getComputedStyle(element);
        return { font: style.font, background: style.backgroundColor, border: style.borderRadius };
      });
    await appsTab.click();
    await first.page.mouse.move(1590, 10);
    await expect(appsTab).toHaveCSS("background-color", "rgb(224, 224, 224)");
    const shellBefore = await tabStyles();
    await app(first.page, "Scheduled Jobs");
    const pageContent = first.page.locator(".carbon-scheduled-jobs:not(.carbon-job-modal-host)");
    await expect(pageContent.getByText("No scheduled jobs.", { exact: true })).toBeVisible();
    const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
    const menu = async (page: Page, action: string) => {
      await page.getByRole("button", { name: `Actions for ${jobName}`, exact: true }).click();
      return page.getByRole("menuitem", { name: action, exact: true });
    };
    await expect(
      pageContent.getByRole("heading", { name: "Scheduled Jobs", level: 1 }),
    ).toBeVisible();
    await tab(first.page, "Execution history").click();
    await expect(pageContent.getByText("No executions yet.", { exact: true })).toBeVisible();
    await tab(first.page, "Schedules").click();
    await expect(
      first.page.getByRole("button", { name: "Scheduled Jobs actions", exact: true }),
    ).toHaveCount(0);
    await expect(
      pageContent.getByRole("button", { name: "New scheduled job", exact: true }),
    ).toHaveCSS("background-color", "rgb(39, 112, 108)");
    await expect(
      pageContent.getByRole("button", { name: "New scheduled job", exact: true }),
    ).toHaveCSS("height", "48px");
    await pageContent.getByRole("button", { name: "New scheduled job", exact: true }).click();
    const form = first.page.getByRole("region", { name: "New scheduled job", exact: true });
    await expect(form.getByLabel("Name", { exact: true })).toBeFocused();
    await form.getByLabel("Name", { exact: true }).fill(jobName);
    await form.getByLabel("Saved prompt", { exact: true }).fill(savedPrompt(gate));
    await expect(form.getByLabel("Schedule enabled", { exact: true })).not.toBeChecked();
    await form.getByLabel("Frequency", { exact: true }).selectOption("weekly");
    await expect(form.getByLabel("Mon", { exact: true })).toBeChecked();
    await form.getByLabel("Mon", { exact: true }).focus();
    await first.page.keyboard.press("Space");
    await expect(form.getByLabel("Mon", { exact: true })).not.toBeChecked();
    await expect(form.getByText("Enter a valid schedule", { exact: true })).toBeVisible();
    await form.getByLabel("Frequency", { exact: true }).selectOption("interval");
    await form.getByLabel("Every (minutes)", { exact: true }).fill("0");
    await expect(form.getByText("Enter a valid schedule", { exact: true })).toBeVisible();
    await form.getByLabel("Frequency", { exact: true }).selectOption("daily");
    await form.getByRole("button", { name: "Choose repository", exact: true }).click();
    const chooser = first.page.getByRole("dialog", { name: "Choose folder", exact: true });
    await chooser.getByRole("option", { name: fixture.directory, exact: true }).dblclick();
    await chooser.getByRole("option", { name: "scheduled-repo", exact: true }).dblclick();
    await chooser.getByRole("button", { name: "Choose folder", exact: true }).click();
    await first.page
      .getByRole("dialog", { name: "Use this automation repository?", exact: true })
      .getByRole("button", { name: "Use repository", exact: true })
      .click();
    await expect(form.getByRole("button", { name: "Create job", exact: true })).toBeEnabled();
    await first.page.screenshot({ path: test.info().outputPath("carbon-job-form-light.png") });
    await form.getByRole("button", { name: "Create job", exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(pageContent.getByRole("button", { name: `Expand ${jobName}` })).toBeFocused();
    await pageContent.getByRole("button", { name: `Expand ${jobName}` }).click();
    await (await menu(first.page, "Edit job")).click();
    const edit = pageContent.getByRole("region", { name: "Edit scheduled job", exact: true });
    await expect(edit.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
    await edit.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      pageContent.getByRole("button", { name: `Actions for ${jobName}`, exact: true }),
    ).toBeFocused();
    await (await menu(first.page, "Edit job")).click();
    await edit.getByLabel("Local base branch").fill("missing-fixture-branch");
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(edit.getByText("Could not save job", { exact: true })).toBeVisible();
    await expect(edit.getByLabel("Local base branch")).toHaveValue("missing-fixture-branch");
    await expect(edit.getByLabel("Saved prompt")).toHaveValue(savedPrompt(gate));
    await edit.getByLabel("Local base branch").fill("main");
    await edit.getByLabel("Turn timeout", { exact: true }).fill("15m");
    await edit.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(edit).toHaveCount(0);
    await expect(pageContent).toContainText("15m");
    await unchanged();
    await first.page.getByRole("button", { name: `Run ${jobName}`, exact: true }).click();
    await expect(
      first.page.getByRole("button", { name: `Stop ${jobName}`, exact: true }),
    ).toBeVisible();
    await expect(await menu(first.page, "Delete")).toBeDisabled();
    await first.page.keyboard.press("Escape");
    await expect(pageContent.getByText("Paused", { exact: true })).toBeVisible();
    await first.context.close();
    await writeFile(gate, "continue");

    const second = await fixture.open();
    second.page.setDefaultTimeout(10_000);
    await second.page.getByRole("button", { name: "Take control", exact: true }).click();
    await expect(second.page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await app(second.page, "Scheduled Jobs");
    const content = second.page.locator(".carbon-scheduled-jobs:not(.carbon-job-modal-host)");
    await expect(
      second.page.getByRole("button", { name: `Run ${jobName}`, exact: true }),
    ).toBeVisible();
    await (await menu(second.page, "View history")).click();
    await expect(content.getByText(`Schedule: ${jobName}`)).toBeVisible();
    const table = content.getByRole("table", { name: "Execution history", exact: true });
    await expect(table).toContainText("finished");
    const history = (await fixture.gateway.scheduler?.request({ action: "history" })) as {
      status: string;
      runId: string;
    }[];
    expect(history).toHaveLength(1);
    expect(history[0]?.status).toBe("finished");
    const worker = fixture.gateway.application
      .snapshot()
      .runs.find((run) => run.record.id === history[0]?.runId);
    // Scheduled runs belong to the scheduler, rather than interactive application runs.
    expect(worker).toBeUndefined();
    const worktreeLines = git("worktree", "list", "--porcelain")
      .split("\n")
      .filter((line) => line.startsWith("worktree "));
    const output = await Promise.all(
      worktreeLines.slice(1).map((line) => readFile(join(line.slice(9), "result.txt"), "utf8")),
    );
    expect(output).toContain("scheduled result\n");
    await unchanged();
    await content
      .getByRole("searchbox", { name: "Search current history page", exact: true })
      .fill("no-match");
    await expect(table).toContainText("No executions match this search.");
    await content
      .getByRole("searchbox", { name: "Search current history page", exact: true })
      .fill("finished");
    await expect(table.getByRole("radio")).toHaveCount(1);
    await table.getByRole("radio").focus();
    await second.page.keyboard.press("Space");
    await expect(table.getByRole("radio")).toBeChecked();
    const transcriptButton = content.getByRole("button", { name: "Transcript", exact: true });
    await transcriptButton.click();
    const transcript = second.page.getByRole("dialog", {
      name: "Execution transcript",
      exact: true,
    });
    await expect(transcript).toContainText("Schedule completed offline");
    await expect(
      transcript.getByRole("button", { name: "Close Execution transcript", exact: true }),
    ).toBeFocused();
    await second.page.keyboard.press("Escape");
    await expect(transcript).toHaveCount(0);
    await expect(transcriptButton).toBeFocused();
    await content.getByRole("button", { name: "Changes", exact: true }).click();
    const changes = second.page.getByRole("dialog", {
      name: "Read-only execution evidence",
      exact: true,
    });
    await expect(changes).toContainText("result.txt");
    await second.page.screenshot({ path: test.info().outputPath("carbon-job-evidence.png") });
    await second.page.keyboard.press("Escape");
    await expect(changes).toHaveCount(0);
    await expect(content.getByRole("button", { name: "Changes", exact: true })).toBeFocused();
    await second.page.screenshot({ path: test.info().outputPath("carbon-jobs-history-light.png") });
    await tab(second.page, "Schedules").click();
    await (await menu(second.page, "Edit job")).click();
    const secondEdit = content.getByRole("region", { name: "Edit scheduled job", exact: true });
    await secondEdit.getByLabel("Saved prompt", { exact: true }).fill(savedPrompt(cancelGate));
    await secondEdit.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(secondEdit).toHaveCount(0);
    await second.page.getByRole("button", { name: `Run ${jobName}`, exact: true }).click();
    await second.page.getByRole("button", { name: `Stop ${jobName}`, exact: true }).click();
    await tab(second.page, "Execution history").click();
    await content
      .getByRole("searchbox", { name: "Search current history page", exact: true })
      .fill("");
    await expect(table).toContainText("cancelled");
    await unchanged();
    await content
      .getByRole("searchbox", { name: "Search current history page", exact: true })
      .fill("");
    await expect(table.getByRole("radio")).toHaveCount(2);
    await table
      .getByRole("columnheader", { name: /Started/ })
      .getByRole("button")
      .click();
    await expect(table.getByRole("columnheader", { name: /Started/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await content.getByRole("button", { name: "Show all schedules", exact: true }).click();
    // System mode follows the browser's resolved color scheme without altering saved appearance.
    await second.page.emulateMedia({ colorScheme: "dark" });
    await expect(content).toHaveCSS("background-color", "rgb(22, 22, 22)");
    await second.page.emulateMedia({ colorScheme: "light" });
    await expect(content).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await tab(second.page, "Schedules").click();
    await second.page.getByRole("button", { name: "Workspace", exact: true }).click();
    await second.page.getByLabel("Color theme", { exact: true }).selectOption("dark");
    await second.page.keyboard.press("Escape");
    await expect(content).toHaveCSS("background-color", "rgb(22, 22, 22)");
    await expect(content).toHaveCSS("color", "rgb(244, 244, 244)");
    await second.page.screenshot({
      path: test.info().outputPath("carbon-jobs-dark.png"),
      animations: "disabled",
    });
    await second.page.getByRole("button", { name: "Workspace", exact: true }).click();
    await second.page.getByLabel("Color theme", { exact: true }).selectOption("light");
    await second.page.keyboard.press("Escape");
    await second.page.setViewportSize({ width: 390, height: 844 });
    await second.page.getByRole("button", { name: "Open product navigation" }).click();
    await expect(
      second.page
        .getByRole("navigation", { name: "Product navigation" })
        .getByRole("tab", { name: "Scheduled Jobs", exact: true }),
    ).toBeVisible();
    await second.page.getByRole("button", { name: "Close product navigation" }).click();
    await second.page.screenshot({
      path: test.info().outputPath("carbon-jobs-mobile.png"),
      animations: "disabled",
    });
    await second.page.setViewportSize({ width: 800, height: 800 });
    await second.page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await expect(
      content.getByRole("button", { name: "New scheduled job", exact: true }),
    ).toBeVisible();
    await content
      .getByRole("button", { name: "New scheduled job", exact: true })
      .scrollIntoViewIfNeeded();
    await second.page.screenshot({
      path: test.info().outputPath("carbon-jobs-zoom-narrow.png"),
      animations: "disabled",
    });
    await second.page.evaluate(() => {
      document.documentElement.style.zoom = "";
    });
    await second.page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
    await expect(content.getByRole("button", { name: "New scheduled job", exact: true })).toHaveCSS(
      "transition-duration",
      "0s",
    );
    await second.page.screenshot({ path: test.info().outputPath("carbon-jobs-forced-colors.png") });
    await second.page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "none" });
    await second.page.setViewportSize({ width: 1600, height: 1000 });

    await (await menu(second.page, "Delete")).click();
    await second.page
      .getByRole("dialog", { name: "Delete automation?", exact: true })
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(
      second.page.getByRole("button", { name: `Run ${jobName}`, exact: true }),
    ).toBeVisible();
    await (await menu(second.page, "Delete")).click();
    await second.page
      .getByRole("dialog", { name: "Delete automation?", exact: true })
      .getByRole("button", { name: "Delete automation", exact: true })
      .click();
    await expect(content.getByText("No scheduled jobs.", { exact: true })).toBeVisible();
    await tab(second.page, "Execution history").click();
    await expect(table.getByRole("radio")).toHaveCount(2);
    await expandNavigation(second.page, "Manage");
    await second.page
      .getByRole("navigation", { name: "Product navigation" })
      .getByRole("tab", { name: "System Manager", exact: true })
      .click();
    await second.page.mouse.move(1590, 10);
    await expect
      .poll(() =>
        second.page
          .getByRole("tab", { name: "System Manager", exact: true })
          .evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              font: style.font,
              background: style.backgroundColor,
              border: style.borderRadius,
            };
          }),
      )
      .toEqual(shellBefore);
    ownedPids = await Promise.all(
      (await readdir(fixture.processLog)).map(
        async (name) =>
          JSON.parse(await readFile(join(fixture.processLog, name), "utf8")).pid as number,
      ),
    );
  } finally {
    await writeFile(gate, "continue").catch(() => {});
    await writeFile(cancelGate, "continue").catch(() => {});
    await fixture.close();
    for (const pid of ownedPids) expect(() => process.kill(pid, 0)).toThrow();
  }
});

test("browser: confirmed Stop Backend closes the runtime and preserves its database", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const { page } = await fixture.open();
    await start(page, fixture.directory);
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    await page.getByRole("button", { name: "Stop Code60 Backend", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Stop Code60 Backend?", exact: true })
      .getByRole("button", { name: "Stop backend", exact: true })
      .click();
    await expect
      .poll(async () =>
        fetch(fixture.gateway.origin).then(
          () => false,
          () => true,
        ),
      )
      .toBe(true);
    expect(
      (await readFile(join(fixture.directory, "projects.sqlite"))).subarray(0, 16).toString(),
    ).toBe("SQLite format 3\0");
    await fixture.restart();
    const next = await fixture.open();
    await expect(next.page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await expect(next.page.getByRole("button", { name: "Relay", exact: true })).toBeVisible();
    expect(fixture.gateway.application.snapshot().runs).toHaveLength(0);
  } finally {
    await fixture.close();
  }
});

test("browser: pending agent permission survives refresh and cancellation prevents later writes", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  const forbidden = join(fixture.directory, "must-not-exist.txt");
  try {
    const { page } = await fixture.open();
    await start(page, fixture.directory);
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    const chat = page.locator(".orchestration-chat-page:visible");
    const composer = chat.getByRole("textbox", { name: "Message to orchestrator", exact: true });
    const approval = chat.getByRole("button", { name: "Code60 auto-approval", exact: true });
    await expect(approval).toBeEnabled();
    if ((await approval.getAttribute("aria-pressed")) === "true") await approval.click();
    await composer.fill(
      JSON.stringify([
        { permission: { id: "browser-deny", title: "Run fixture command", kind: "execute" } },
      ]),
    );
    await composer.press("Enter");
    await expect(chat.getByRole("button", { name: "Deny", exact: true })).toBeVisible();
    const toggle = page.getByRole("checkbox", { name: "relay animation", exact: true });
    await page.locator(".relay-dot-toggle label").click();
    const pulse = page.locator("#navigation-sidebar .relay-pulse");
    await expect(pulse).toHaveAccessibleName("Relay: Attention");
    await app(page, "Appearance");
    await expect(pulse).toHaveAccessibleName("Relay: Attention");
    await page.reload();
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    await expect(
      chat.getByRole("region", { name: "Pending approvals", exact: true }),
    ).toContainText("Run fixture command");
    await expect(toggle).toBeChecked();
    await expect(pulse).toHaveAccessibleName("Relay: Attention");
    await chat.getByRole("button", { name: "Deny", exact: true }).click();
    await expect(pulse).toHaveAccessibleName("Relay: Complete");
    await expect(pulse).toHaveAccessibleName("Relay: Idle");
    await expect(chat).toContainText("permission browser-deny: opt-reject_once");
    await expect(chat.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await composer.fill(
      JSON.stringify([
        { message: "Waiting for cancellation" },
        { hang: "cancellable" },
        { write: { path: forbidden, content: "bad" } },
      ]),
    );
    await composer.press("Enter");
    await expect(chat).toContainText("Waiting for cancellation");
    await chat.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(composer).toBeEditable();
    await expect(chat.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
    await expect(readFile(forbidden)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await fixture.close();
  }
});

test("browser: navigation retains two projects and searches their real files", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  const repositories: string[] = [];
  for (const name of ["alpha", "beta"]) {
    const repo = join(fixture.directory, name);
    await mkdir(repo);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    await writeFile(join(repo, "README.md"), `${name} browser search evidence\n`);
    execFileSync("git", ["add", "."], { cwd: repo });
    commitFixture(repo);
    repositories.push(repo);
  }
  try {
    const { page } = await fixture.open();
    await start(page, fixture.directory);
    await openProject(page, fixture.directory, "alpha");
    await openProject(page, fixture.directory, "beta");
    const snapshot = await page.evaluate(() => window.code60.snapshot());
    expect(snapshot.openProjects?.map((project) => project.path).sort()).toEqual(
      repositories.sort(),
    );
    await openFromHome(page, "Search");
    const search = page.getByRole("main", { name: "Search", exact: true });
    await search
      .getByRole("searchbox", { name: "Query", exact: true })
      .fill("browser search evidence");
    await search.getByRole("button", { name: "Search", exact: true }).click();
    const results = search.getByRole("list", { name: "Search results", exact: true });
    await expect(results).toContainText("alpha");
    await expect(results).toContainText("beta");
    for (const repo of repositories) {
      expect(await readFile(join(repo, "README.md"), "utf8")).toContain("browser search evidence");
      expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe(
        "",
      );
    }
  } finally {
    await fixture.close();
  }
});

test("browser: resumes a verified destination per database and recovers a removed conversation without running it", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const { page } = await fixture.open();
    await start(page, fixture.directory);
    const scope = (name: string) =>
      `code60.resume.${JSON.stringify(join(fixture.directory, name))}`;
    const first = scope("projects.sqlite");
    await openFromHome(page, "Search");
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), first))
      .toBe(JSON.stringify({ page: "search" }));
    await page.reload();
    await expect(page.locator("#panel-search")).toBeVisible();
    const launches = await readdir(fixture.processLog);
    await page.evaluate(
      (key) =>
        localStorage.setItem(key, JSON.stringify({ page: "chat", chat: "removed-conversation" })),
      first,
    );
    await page.reload();
    await expect(page.getByRole("main", { name: "Relay", exact: true })).toBeVisible();
    await openFromHome(page, "Search");
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    await page.getByRole("button", { name: "Select or create database" }).click();
    await page.getByRole("button", { name: "Create database…", exact: true }).click();
    const chooser = page.getByRole("dialog", { name: "Create database", exact: true });
    await chooser.getByRole("option", { name: fixture.directory, exact: true }).dblclick();
    await chooser.getByLabel("Database filename", { exact: true }).fill("second.sqlite");
    await chooser.getByRole("button", { name: "Create database", exact: true }).click();
    await expect(chooser).toHaveCount(0);
    await expect(page.getByRole("main", { name: "Relay", exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), scope("second.sqlite")))
      .toContain('"page":"chat"');
    expect(await page.evaluate((key) => localStorage.getItem(key), first)).toBe(
      JSON.stringify({ page: "search" }),
    );
    expect(await readdir(fixture.processLog)).toEqual(launches);
  } finally {
    await fixture.close();
  }
});

test("browser: inspects a search result alongside the query and recovers from no matches", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const project = "cedar-release";
    const path = join(fixture.directory, project);
    await mkdir(path);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: path });
    await writeFile(join(path, "README.md"), "# Cedar release\nReview the release checklist.\n");
    execFileSync("git", ["add", "README.md"], { cwd: path });
    commitFixture(path);
    const { page } = await fixture.open();
    await start(page, fixture.directory);
    await openFromHome(page, "Search");
    await expect(page.getByRole("heading", { name: "No projects in this database" })).toBeVisible();
    await page.getByRole("button", { name: "Open projects", exact: true }).click();
    await openProject(page, fixture.directory, project);
    await openFromHome(page, "Search");
    const panel = page.locator("#panel-search");
    const query = panel.getByRole("searchbox", { name: "Query", exact: true });
    await query.fill("cedar");
    await query.press("Enter");
    const result = panel.getByRole("list", { name: "Search results" }).getByRole("button").first();
    await result.click();
    const detail = panel.getByRole("region", { name: "Selected record" });
    await expect(detail).toContainText(/cedar/i);
    await expect(detail.getByRole("button", { name: "Open source" })).toBeVisible();
    await expect(query).toHaveValue("cedar");
    await page.screenshot({ path: test.info().outputPath("search-selected-record.png") });
    await panel.getByRole("button", { name: "Clear search input", exact: true }).click();
    await expect(query).toHaveValue("");
    await expect(query).toBeFocused();
    await expect(detail).toHaveCount(0);
    await query.fill("unmatched446247ceacd");
    await query.press("Enter");
    await expect(detail).toHaveCount(0);
    await panel.getByRole("button", { name: "Clear search", exact: true }).click();
    await expect(query).toHaveValue("");
    let unavailable = true;
    await page.route("**/api/operation", async (route) => {
      if (unavailable && route.request().postDataJSON().operation === "project-search") {
        unavailable = false;
        await route.fulfill({ status: 503, json: { error: "Fixture source offline" } });
      } else await route.continue();
    });
    await query.fill("cedar");
    await query.press("Enter");
    await expect(
      panel.getByRole("alert").filter({ hasText: "Fixture source offline" }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "Retry search" }).click();
    await expect(result).toBeVisible();
  } finally {
    await fixture.close();
  }
});

test("browser: concurrent project conversations retain their own streaming response and draft", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  const names = ["release-client", "release-server"];
  try {
    const { page } = await fixture.open();
    await start(page, fixture.directory);
    const chat = page.locator(".orchestration-chat-page:visible");
    const composer = chat.getByRole("textbox", { name: "Message to orchestrator" });
    const select = async (name: string) => {
      const entry = page
        .getByRole("region", { name: `Project ${join(fixture.directory, name)}`, exact: true })
        .locator(".chat-sidebar-entry")
        .first();
      await entry.click();
      await expect(entry).toHaveAttribute("aria-current", "true");
      const id = await entry.getAttribute("id");
      if (!id) throw new Error("Selected conversation is missing its navigation identity.");
      await expect(page.locator("#panel-chat")).toHaveAttribute("aria-labelledby", id);
      await expect(chat).not.toHaveAttribute("inert", "");
      await expect
        .poll(() => page.evaluate(async () => (await window.code60.snapshot()).directory))
        .toBe(join(fixture.directory, name));
    };
    for (const name of names) {
      const repo = join(fixture.directory, name);
      await mkdir(repo);
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
      await writeFile(join(repo, "README.md"), name);
      execFileSync("git", ["add", "README.md"], { cwd: repo });
      commitFixture(repo);
      await openProject(page, fixture.directory, name);
      await page
        .getByRole("button", { name: `New Session in ${name}`, exact: true })
        .first()
        .click();
    }
    for (const name of names) {
      await select(name);
      await composer.fill(
        JSON.stringify([
          { message: `Started ${name}` },
          { waitForFile: join(fixture.directory, `${name}.gate`) },
          { message: `Completed ${name}` },
        ]),
      );
      await composer.press("Enter");
      await expect(chat.getByText(`Started ${name}`, { exact: true })).toBeVisible();
    }
    await writeFile(join(fixture.directory, "release-server.gate"), "continue");
    await expect(chat.getByRole("article", { name: "Assistant" })).toContainText(
      "Completed release-server",
    );
    await composer.fill("Server follow-up draft");
    await select("release-client");
    await expect(chat.getByText("Started release-client", { exact: true })).toBeVisible();
    await expect(chat.getByRole("article", { name: "Assistant" })).not.toContainText(
      "Completed release-server",
    );
    await writeFile(join(fixture.directory, "release-client.gate"), "continue");
    await expect(chat.getByRole("article", { name: "Assistant" })).toContainText(
      "Completed release-client",
    );
    await select("release-server");
    await expect(composer).toHaveText("Server follow-up draft");
    const rename = page
      .getByRole("region", {
        name: `Project ${join(fixture.directory, "release-server")}`,
        exact: true,
      })
      .getByRole("button", { name: /^Rename chat:/ })
      .first();
    await rename.click();
    const dialog = page.getByRole("dialog", { name: "Rename chat" });
    await dialog.getByLabel("Chat name").press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Develop", exact: true })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(rename).toBeFocused();
    for (const name of names)
      expect(
        execFileSync("git", ["status", "--porcelain"], {
          cwd: join(fixture.directory, name),
          encoding: "utf8",
        }),
      ).toBe("");
  } finally {
    for (const name of names)
      await writeFile(join(fixture.directory, `${name}.gate`), "continue").catch(() => {});
    await fixture.close();
  }
});

test("browser: pages retained diagnostic records through the gateway", async ({ browser }) => {
  const fixture = await browserApp(browser);
  try {
    const { DesktopLogStore } = await import("../src/application/index.js");
    const store = new DesktopLogStore(join(fixture.directory, "state", "code60", "logs"));
    try {
      for (let n = 0; n < 125; n++)
        store.sink({ event: "app.ready", outcome: "succeeded", operationId: crypto.randomUUID() });
      expect(await store.flush(10000)).toBe(true);
    } finally {
      await store.close();
    }
    const { page } = await fixture.open();
    await start(page, fixture.directory);
    await app(page, "Data Viewer");
    await page.getByRole("button", { name: "Open Logs", exact: true }).click();
    const logs = page.locator("#panel-logs");
    await logs.getByLabel("Log project scope").selectOption("all");
    const search = logs.getByRole("searchbox", { name: "Search retained logs" });
    await search.fill("Desktop startup completed");
    await search.press("Enter");
    const older = logs.getByRole("button", { name: "Older page", exact: true });
    await expect(older).toBeEnabled();
    await older.click();
    await expect(logs).toContainText("Page 2");
    await expect(logs.getByRole("table")).toContainText("Desktop startup completed");
    await logs.getByRole("button", { name: "Newer page", exact: true }).click();
    await expect(logs).toContainText("Page 1");
    await logs.getByRole("table").getByRole("radio").first().press("Space");
    const record = page.getByRole("dialog", { name: "Log record", exact: true });
    await expect(record.getByRole("button", { name: "Copy record", exact: true })).toBeVisible();
    await page.mouse.click(2, 2);
    await expect(record).toHaveCount(0);
  } finally {
    await fixture.close();
  }
});

test("browser: manage providers on a single page", async ({ browser }) => {
  const fixture = await browserApp(browser);
  try {
    const configPath = join(fixture.directory, "config/code60/config.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.agents.droid = config.agents.claude;
    await writeFile(configPath, JSON.stringify(config));
    await fixture.restart();
    const { page } = await fixture.open();
    await onboard(page);
    await expandNavigation(page, "Connect");
    const nav = page.getByRole("tablist", { name: "Connect", exact: true });
    await expect(nav.getByRole("tab")).toHaveText(["MCP Servers", "Providers"]);
    await nav.getByRole("tab", { name: "Providers", exact: true }).click();
    const providers = page.getByRole("main", { name: "Providers", exact: true });
    const names = providers.getByRole("heading", { level: 2 });
    await expect(names).toHaveText(["Claude (Primary)"]);
    await providers.getByRole("button", { name: "Add Provider" }).click();
    const wizard = page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Droid", exact: true }).click();
    await expect(wizard.getByRole("status")).toHaveText("Droid connected");
    await wizard.getByRole("button", { name: "Close provider setup" }).click();
    await expect(names).toHaveText(["Claude (Primary)", "Droid"]);
    await providers.getByRole("button", { name: "More actions for Droid" }).click();
    await page.getByRole("menuitem", { name: "Set as Primary" }).click();
    await expect(names).toHaveText(["Claude", "Droid (Primary)"]);
    await providers.getByRole("button", { name: "More actions for Claude" }).click();
    await page.getByRole("menuitem", { name: "Disconnect" }).click();
    await expect(names).toHaveText(["Droid (Primary)"]);
    const saved = JSON.parse(
      await readFile(join(fixture.directory, "state/code60/desktop.json"), "utf8"),
    );
    expect(saved.agentSetup).toMatchObject({ primary: "droid", enabled: ["droid"] });
  } finally {
    await fixture.close();
  }
});

test("browser: Open Project modal fits its content and keeps actions in view", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const name = "sample-project-with-a-long-name-for-the-recent-projects-list";
    const repo = join(fixture.directory, name);
    await mkdir(repo);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    commitFixture(repo);
    const { page } = await fixture.open();
    await start(page, fixture.directory);
    await expandNavigation(page, "Develop");
    await page.getByRole("tab", { name: "Projects", exact: true }).click();
    const launch = page.locator("#panel-projects").getByRole("button", { name: "New Project" });
    await launch.click();
    const dialog = page.getByRole("dialog", { name: "Open Project", exact: true });
    await expect(dialog.getByText("No recent projects.")).toBeVisible();
    for (const [width, height] of [
      [1440, 900],
      [375, 667],
    ] as const) {
      await page.setViewportSize({ width, height });
      await dialog.screenshot({
        path: test.info().outputPath(`empty-${width}.png`),
        animations: "disabled",
      });
      const bounds = await dialog.boundingBox();
      const cancel = await dialog
        .getByRole("button", { name: "Cancel", exact: true })
        .boundingBox();
      const open = await dialog
        .getByRole("button", { name: "Open Folder", exact: true })
        .boundingBox();
      if (!bounds || !cancel || !open) throw new Error("Missing project picker controls");
      expect(bounds.height).toBeLessThan(300);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(Math.abs(cancel.y - open.y)).toBeLessThan(1);
      expect(Math.abs(cancel.width - open.width)).toBeLessThan(1);
      expect(Math.abs(cancel.x - bounds.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(open.y + open.height - bounds.y - bounds.height)).toBeLessThanOrEqual(2);
    }
    await page.keyboard.press("Escape");
    await expect(launch).toBeFocused();
    await page.setViewportSize({ width: 1440, height: 900 });
    await openProject(page, fixture.directory, name);
    await page.getByRole("tab", { name: "Projects", exact: true }).click();
    await launch.click();
    const row = dialog.getByRole("listitem").filter({ hasText: repo });
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(row).toBeVisible();
    const item = row.getByRole("button").first();
    await expect(item).toBeFocused();
    for (const locator of [dialog, row, item]) {
      expect(await locator.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    await dialog.screenshot({
      path: test.info().outputPath("recent-375.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 375, height: 240 });
    const content = dialog.locator(".cds--modal-content");
    expect(await content.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await content.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(dialog.getByRole("button", { name: "Open Folder", exact: true })).toBeInViewport({
      ratio: 1,
    });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })).toBe(
      "",
    );
  } finally {
    await fixture.close();
  }
});

test("browser: Carbon project commands retain arguments after a rejected send and render once", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const { page } = await fixture.open();
    const external = new Set<string>();
    const violations: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).origin !== fixture.gateway.origin) external.add(request.url());
    });
    await page.exposeFunction("recordChatPolicyViolation", (directive: string) =>
      violations.push(directive),
    );
    await page.evaluate(() =>
      document.addEventListener("securitypolicyviolation", (event) => {
        (
          window as unknown as { recordChatPolicyViolation(directive: string): void }
        ).recordChatPolicyViolation(event.effectiveDirective);
      }),
    );
    await start(page, fixture.directory);
    await expandNavigation(page, "Customize");
    await page.getByRole("tab", { name: "Commands", exact: true }).click();
    const commands = page.locator(".commands-page");
    await commands.getByRole("button", { name: "New command", exact: true }).click();
    await commands.getByLabel("Title", { exact: true }).fill("Review fixture");
    await commands.getByLabel("Name", { exact: true }).fill("review-fixture");
    await commands.getByLabel("Prompt", { exact: true }).fill("Review the requested fixture.");
    await commands.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      commands.getByRole("button", { name: /review-fixture.*Review fixture/ }),
    ).toBeVisible();
    const repo = join(fixture.directory, "command-project");
    await mkdir(repo);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    await writeFile(join(repo, "README.md"), "command test");
    execFileSync("git", ["add", "README.md"], { cwd: repo });
    commitFixture(repo);
    await openProject(page, fixture.directory, "command-project");
    await page
      .getByRole("button", { name: "New Session in command-project", exact: true })
      .first()
      .click();
    const chat = page.locator(".orchestration-chat-page:visible");
    await expect(page.getByRole("tabpanel", { name: "Chat 1", exact: true })).toBeVisible();
    await expect(chat.getByRole("button", { name: "Tactics", exact: true })).toBeEnabled();
    const input = chat.getByRole("textbox", { name: "Message to orchestrator" });
    await expect(input).toBeEditable();
    const session = chat.getByRole("region", { name: "Session information" });
    const model = session.getByRole("button", { name: "Model", exact: true });
    const mode = session.getByRole("button", { name: "Harness mode", exact: true });
    const usage = session.getByRole("img", { name: /Context:/ });
    for (const [trigger, label] of [
      [model, "Model settings"],
      [mode, "Harness modes"],
    ] as const) {
      await trigger.press("ArrowDown");
      const menu = page.getByRole("menu", { name: label, exact: true });
      await expect(menu).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();
    }
    await input.click();
    const promptFrame = chat.locator('[part~="prompt-container"]');
    await expect(promptFrame).toHaveCSS("outline-style", "none");
    await expect(promptFrame).toHaveCSS("box-shadow", "none");
    const tactics = chat.getByRole("button", { name: "Tactics", exact: true });
    await tactics.focus();
    await expect(tactics).toBeFocused();
    await expect(chat.getByRole("region", { name: "Chat composer" })).toHaveCSS(
      "outline-style",
      "none",
    );
    await input.click();
    await input.pressSequentially("/review-fix");
    const option = chat.getByRole("option").filter({ hasText: "review-fixture" });
    await expect(option).toBeVisible();
    await option.click();
    await page.keyboard.type(" project arguments");
    const attempts: { text: string; command?: string }[] = [];
    await page.route("**/api/operation", async (route) => {
      const body = route.request().postDataJSON();
      if (body.operation === "orchestration-chat" && body.value.type === "send") {
        attempts.push(body.value);
        if (attempts.length === 1) {
          await route.fulfill({ status: 503, json: { error: "Fixture send unavailable" } });
          return;
        }
      }
      await route.continue();
    });
    await input.press("Enter");
    await expect(chat.getByRole("alert")).toContainText("Fixture send unavailable");
    await expect(input).toContainText("project arguments");
    await expect(chat.locator("article.event.prompt")).toHaveCount(0);
    await chat.getByRole("button", { name: "Send", exact: true }).click();
    await expect(chat.locator("article.event.prompt")).toHaveCount(1);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.command).toBe("review-fixture");
    expect(attempts[0]?.text).toMatch(/^\$review-fixture\s+project arguments$/);
    expect(attempts[1]).toEqual(attempts[0]);
    await page.reload();
    await expect(chat.locator("article.event.prompt")).toHaveCount(1);
    await expect(chat.getByRole("button", { name: /open chat history/i })).toHaveCount(0);
    for (const [name, width, height, colorScheme, forcedColors] of [
      ["light", 1440, 900, "light", "none"],
      ["tablet", 900, 700, "light", "none"],
      ["dark", 375, 667, "dark", "none"],
      ["short", 375, 300, "light", "none"],
      ["forced", 375, 667, "dark", "active"],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme, forcedColors });
      await expect(chat.locator('.transcript-content[data-variant="agent"]').first()).toHaveCSS(
        "background-color",
        "rgba(0, 0, 0, 0)",
      );
      const closeNavigation = page.getByRole("button", { name: "Close product navigation" });
      if (await closeNavigation.isVisible()) await closeNavigation.click();
      await expect(input).toBeInViewport();
      await input.click({ trial: true });
      const frame = (await promptFrame.boundingBox())!;
      const editor = (await input.boundingBox())!;
      expect(frame.height).toBeGreaterThanOrEqual(96);
      for (const control of [model, usage, mode]) {
        const box = (await control.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(frame.x);
        expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width);
        expect(box.y).toBeGreaterThanOrEqual(editor.y + editor.height - 1);
        expect(frame.y + frame.height - box.y - box.height).toBeLessThanOrEqual(24);
        expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height);
      }
      const lastControl = (await mode.boundingBox())!;
      expect(frame.x + frame.width - lastControl.x - lastControl.width).toBeLessThan(72);
      const surface = chat.locator(".embedded-chat-element");
      const panelToggle = page.locator("#workspace-panel-actions").getByRole("button");
      const assertChatEdges = () =>
        expect
          .poll(() =>
            surface.evaluate((element) => {
              const box = element.getBoundingClientRect();
              const column = document.querySelector(".app-workspace")!.getBoundingClientRect();
              const header = document.querySelector(".product-header")!.getBoundingClientRect();
              const inspector = document.querySelector(
                '.file-panel[data-minimized="false"]:not([inert])',
              );
              const right = inspector?.getBoundingClientRect().left ?? window.innerWidth;
              return [
                box.left - column.left,
                box.top - header.bottom,
                box.right - right,
                box.bottom - window.innerHeight,
              ].map((difference) => Math.round(difference) || 0);
            }),
          )
          .toEqual([0, 0, 0, 0]);
      await assertChatEdges();
      if (name === "light" || name === "tablet" || name === "dark") {
        await panelToggle.click();
        await expect(panelToggle).toHaveAttribute("aria-expanded", "true");
        await expect(page.locator('.file-panel[data-minimized="false"]:visible')).toBeInViewport();
        if (width > 672) {
          await assertChatEdges();
          await page.screenshot({
            animations: "disabled",
            path: test.info().outputPath(`carbon-chat-${name}-inspector.png`),
          });
        } else {
          await expect(input).toBeHidden();
        }
        await panelToggle.click();
        await expect(panelToggle).toHaveAttribute("aria-expanded", "false");
      }
      await page.screenshot({
        animations: "disabled",
        path: test.info().outputPath(`carbon-chat-${name}.png`),
      });
    }
    expect([...external]).toEqual([]);
    expect(violations).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test("browser: the worker prompt line owns its permission decision and follow-up", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const { page } = await fixture.open();
    await start(page, fixture.directory);
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    const relay = page.locator(".orchestration-chat-page:visible");
    const approval = relay.getByRole("button", { name: "Code60 auto-approval", exact: true });
    if ((await approval.getAttribute("aria-pressed")) === "true") await approval.click();
    const target = join(fixture.directory, "worker-target");
    await mkdir(target);
    const request =
      "Relay target: " +
      JSON.stringify({
        cwd: target,
        workspaceMode: "direct",
        label: "Permission worker",
        prompt: JSON.stringify([
          { permission: { id: "worker-approval", title: "Write worker evidence", kind: "edit" } },
          { write: { path: "approved.txt", content: "worker approved" } },
        ]),
      });
    const parentInput = relay.getByRole("textbox", { name: "Message to orchestrator" });
    await parentInput.fill(request);
    await parentInput.press("Enter");
    await page.getByRole("button", { name: /^Permission worker \[/ }).click();
    const worker = page.locator(".worker-chat-page:visible");
    const allow = worker.getByRole("button", { name: "Allow once", exact: true });
    await expect(allow).toBeVisible();
    const waiting = worker.locator('.worker-chat-subtitle[data-status="waiting"]');
    await expect(waiting.locator(".cds--loading--small")).toBeVisible();
    await expect(waiting).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(readFile(join(target, "approved.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    await allow.click();
    await expect
      .poll(() => readFile(join(target, "approved.txt"), "utf8").catch(() => ""))
      .toBe("worker approved");
    const input = worker.getByRole("textbox", { name: "Message", exact: true });
    await expect(input).toBeEditable();
    await input.fill(JSON.stringify([{ message: "Only this worker received the follow-up." }]));
    await input.press("Enter");
    await expect(worker.getByRole("article", { name: "Assistant" }).last()).toContainText(
      "Only this worker received the follow-up.",
    );
  } finally {
    await fixture.close();
  }
});

test("browser: removes focus highlight borders across Carbon controls, shadow chat, and settings", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const { page } = await fixture.open();
    await start(page, fixture.directory);
    await page.evaluate(() => localStorage.setItem("code60.focusHighlight", "on"));
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Relay", exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.dataset.focusHighlight),
    ).toBeUndefined();

    const expectNoFocusBorder = async (label: string) => {
      const samples = await page.evaluate(
        () =>
          new Promise<
            {
              frame: number;
              tag: string;
              className: string;
              outlineStyle: string;
              outlineWidth: string;
              outlineColor: string;
              boxShadow: string;
            }[]
          >((resolve) => {
            const results: {
              frame: number;
              tag: string;
              className: string;
              outlineStyle: string;
              outlineWidth: string;
              outlineColor: string;
              boxShadow: string;
            }[] = [];
            let frame = 0;
            const capture = () => {
              let active: Element | null = document.activeElement;
              while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
              if (active) {
                const style = getComputedStyle(active);
                results.push({
                  frame,
                  tag: active.tagName.toLowerCase(),
                  className: typeof active.className === "string" ? active.className : "",
                  outlineStyle: style.outlineStyle,
                  outlineWidth: style.outlineWidth,
                  outlineColor: style.outlineColor,
                  boxShadow: style.boxShadow,
                });
              }
              frame += 1;
              if (frame < 8) requestAnimationFrame(capture);
              else resolve(results);
            };
            capture();
          }),
      );
      expect(samples.length, `${label}: expected an active element`).toBeGreaterThan(0);
      for (const state of samples) {
        const outlineInvisible =
          state.outlineStyle === "none" ||
          state.outlineWidth === "0px" ||
          state.outlineColor === "rgba(0, 0, 0, 0)";
        expect(
          outlineInvisible,
          `${label} frame ${state.frame} outline: ${JSON.stringify(state)}`,
        ).toBe(true);
        expect(state.boxShadow, `${label} frame ${state.frame} box-shadow`).not.toMatch(
          /inset 0px 0px 0px [12]px/,
        );
      }
    };

    const verifySurface = async (scheme: "light" | "dark") => {
      await expandNavigation(page, "Personalize");
      const appearanceTab = page.getByRole("tab", { name: "Appearance", exact: true });
      await appearanceTab.click();
      await expectNoFocusBorder(`${scheme} sidebar Appearance tab (click)`);
      await appearanceTab.focus();
      await expectNoFocusBorder(`${scheme} sidebar Appearance tab (focus)`);

      const appearancePanel = page.locator("#panel-settings-appearance");
      await expect(appearancePanel).toBeVisible();
      await expect(
        appearancePanel.getByRole("switch", { name: "Focus highlight border" }),
      ).toHaveCount(0);

      const themeSelect = appearancePanel.getByLabel("Theme", { exact: true });
      await themeSelect.selectOption(scheme);
      await expect(page.locator("html")).toHaveAttribute("data-color-scheme", scheme);
      await themeSelect.focus();
      await expectNoFocusBorder(`${scheme} Theme select`);

      const signalsSwitch = appearancePanel.getByRole("switch", { name: "Signal colors" });
      await signalsSwitch.focus();
      await signalsSwitch.press("Space");
      await expectNoFocusBorder(`${scheme} Signal colors switch`);
      const switchAfterOutline = await appearancePanel
        .locator(".cds--toggle__switch")
        .first()
        .evaluate((el) => {
          const after = getComputedStyle(el, "::after");
          return {
            style: after.outlineStyle,
            width: after.outlineWidth,
            color: after.outlineColor,
          };
        });
      expect(
        switchAfterOutline.style === "none" ||
          switchAfterOutline.width === "0px" ||
          switchAfterOutline.color === "rgba(0, 0, 0, 0)",
        `${scheme} Carbon switch ::after outline: ${JSON.stringify(switchAfterOutline)}`,
      ).toBe(true);
      await signalsSwitch.press("Space");

      const headerBrand = page.getByRole("link", { name: "Code60", exact: true });
      await headerBrand.focus();
      await expectNoFocusBorder(`${scheme} header brand link`);

      const commandsButton = page.getByRole("button", { name: "Commands", exact: true });
      await commandsButton.click();
      const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
      await expect(palette).toBeVisible();
      const paletteInput = palette.getByRole("combobox");
      await paletteInput.fill("Focus highlight");
      await expect(palette.getByRole("option", { name: /Focus highlight/i })).toHaveCount(0);
      await expectNoFocusBorder(`${scheme} command palette input`);
      await page.keyboard.press("Escape");
      await expect(palette).toBeHidden();

      const workspaceButton = page.getByRole("button", { name: "Workspace", exact: true });
      await workspaceButton.click();
      const workspaceDialog = page.getByRole("dialog", { name: "Workspace", exact: true });
      await expect(workspaceDialog).toBeVisible();
      const closeModal = workspaceDialog.locator(".cds--modal-close");
      await closeModal.focus();
      await expectNoFocusBorder(`${scheme} modal close button`);
      await page.keyboard.press("Escape");
      await expect(workspaceDialog).toBeHidden();

      await page.getByRole("button", { name: "Relay", exact: true }).click();
      const chat = page.locator(".orchestration-chat-page:visible");
      const input = chat.getByRole("textbox", { name: "Message to orchestrator", exact: true });
      await input.click();
      await expectNoFocusBorder(`${scheme} AI Chat composer input`);
      await input.fill("Focus check");
      const sendButton = chat.getByRole("button", { name: "Send", exact: true });
      await sendButton.focus();
      await expectNoFocusBorder(`${scheme} AI Chat shadow Send button`);
      const modelButton = chat.getByRole("button", { name: "Model", exact: true });
      await modelButton.focus();
      await expectNoFocusBorder(`${scheme} chat Model button`);
      const approvalButton = chat.getByRole("button", {
        name: "Code60 auto-approval",
        exact: true,
      });
      await approvalButton.focus();
      await expectNoFocusBorder(`${scheme} chat auto-approval button`);
      const filesToggle = page.getByRole("button", { name: "Toggle files panel", exact: true });
      await filesToggle.focus();
      await expectNoFocusBorder(`${scheme} Toggle files panel button`);
      await input.fill("");

      await page.keyboard.press("Tab");
      await expectNoFocusBorder(`${scheme} keyboard Tab focus`);
    };

    await verifySurface("light");
    await verifySurface("dark");
  } finally {
    await fixture.close();
  }
});

test("browser: scheduled workflow branches from baseBranch, runs with autoApprove, and opens interactively in Workflows", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const fixture = await browserApp(browser);
  const repo = join(fixture.directory, "scheduled-workflow-repo");
  await mkdir(repo);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8", timeout: 10_000 });
  git("init", "-q", "-b", "main");
  await writeFile(join(repo, "README.md"), "# Committed base\n");
  git("add", ".");
  commitFixture(repo);
  // Leave an uncommitted dirty file; scheduled workflows must branch from refs/heads/main.
  await writeFile(join(repo, "UNCOMMITTED.txt"), "local-only\n");
  const head = git("rev-parse", "HEAD");
  const jobName = "Nightly workflow check";
  try {
    const view = await fixture.open();
    view.page.setDefaultTimeout(15_000);
    await start(view.page, fixture.directory);
    await app(view.page, "Scheduled Jobs");
    const content = view.page.locator(".carbon-scheduled-jobs:not(.carbon-job-modal-host)");
    await content.getByRole("button", { name: "New scheduled job", exact: true }).click();
    const form = view.page.getByRole("region", { name: "New scheduled job", exact: true });
    await form.getByLabel("Name", { exact: true }).fill(jobName);
    await form.getByLabel("Job type", { exact: true }).selectOption("workflow");
    await form.getByRole("button", { name: "Choose repository", exact: true }).click();
    const chooser = view.page.getByRole("dialog", { name: "Choose folder", exact: true });
    await chooser.getByRole("option", { name: fixture.directory, exact: true }).dblclick();
    await chooser.getByRole("option", { name: "scheduled-workflow-repo", exact: true }).dblclick();
    await chooser.getByRole("button", { name: "Choose folder", exact: true }).click();
    await view.page
      .getByRole("dialog", { name: "Use this automation repository?", exact: true })
      .getByRole("button", { name: "Use repository", exact: true })
      .click();
    await expect(form.getByLabel("Automatically approve harness permissions")).toBeChecked();
    await form.getByLabel("Task name", { exact: true }).fill("Build check");
    await form
      .getByLabel("Implementation instructions", { exact: true })
      .fill("Update README with verification note");
    await form
      .getByLabel("Verification criteria", { exact: true })
      .fill("README exists and looks valid");
    await form.getByRole("button", { name: "Create job", exact: true }).click();
    await expect(form).toHaveCount(0);

    // Verify Workflow badge on row and expanded workflow facts.
    const row = content.locator("tr", { hasText: jobName }).first();
    await expect(row).toContainText("Workflow");
    await content.getByRole("button", { name: `Expand ${jobName}` }).click();
    await expect(content).toContainText("Workflow tasks (1)");
    await expect(content).toContainText("Auto-approve");

    // Run immediately and verify completion in Execution history.
    await content.getByRole("button", { name: `Run ${jobName}`, exact: true }).click();
    await content.getByRole("button", { name: `Actions for ${jobName}`, exact: true }).click();
    await view.page.getByRole("menuitem", { name: "View history", exact: true }).click();
    const table = content.getByRole("table", { name: "Execution history", exact: true });
    await expect(table).toContainText("Workflow (1/1)", { timeout: 30_000 });
    await expect(table).toContainText("finished", { timeout: 30_000 });

    // Select execution and jump directly into Apps -> Workflows via "Open in Workflows".
    await table.getByRole("radio").first().focus();
    await view.page.keyboard.press("Space");
    await expect(table.getByRole("radio").first()).toBeChecked();
    await content.getByRole("button", { name: "Open in Workflows", exact: true }).click();

    const workflowsPage = view.page.locator(".workflows-page");
    await expect(workflowsPage).toBeVisible();
    await expect(workflowsPage.locator(".workflow-scheduled-origin")).toContainText("Scheduled");
    await expect(workflowsPage.locator(".workflow-scheduled-origin")).toContainText(jobName);
    await expect(workflowsPage.locator(".workflow-scheduled-origin")).toContainText("main");
    await expect(workflowsPage).toContainText("Completed");

    // Source checkout remains untouched and worktree does not include uncommitted dirty files.
    expect(git("rev-parse", "HEAD")).toBe(head);
    const worktrees = git("worktree", "list", "--porcelain")
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice(9));
    expect(worktrees.length).toBe(2);
    await expect(readFile(join(worktrees[1] ?? "", "UNCOMMITTED.txt"), "utf8")).rejects.toThrow();
  } finally {
    await fixture.close();
  }
});

test("browser: redesigned Carbon Commands menu supports search, recovery, keyboard navigation, and Carbon layout", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const fixture = await browserApp(browser);
  try {
    const view = await fixture.open();
    const { page } = view;
    page.setDefaultTimeout(15_000);
    await start(page, fixture.directory);

    const commandsButton = page.getByRole("button", { name: "Commands", exact: true });
    await expect(commandsButton).toHaveAttribute("aria-haspopup", "dialog");
    await commandsButton.click();

    const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
    await expect(palette).toBeVisible();

    const search = palette.getByRole("combobox", { name: "Search commands", exact: true });
    await expect(search).toBeFocused();

    // Verify Carbon layout: pinned body (no double scroll), full-width borderless options, no solid-red danger button.
    const layout = await palette.evaluate((el) => {
      const content = el.querySelector<HTMLElement>(".cds--modal-content");
      const list = el.querySelector<HTMLElement>(".command-palette-list");
      const firstOption = el.querySelector<HTMLElement>(".command-palette-option");
      const dangerOption = el.querySelector<HTMLElement>(
        '.command-palette-option[data-danger="true"]',
      );
      return {
        contentOverflow: content ? getComputedStyle(content).overflowY : null,
        listOverflow: list ? getComputedStyle(list).overflowY : null,
        listWidth: list?.clientWidth ?? 0,
        optionWidth: firstOption?.getBoundingClientRect().width ?? 0,
        optionBorderTop: firstOption ? getComputedStyle(firstOption).borderTopWidth : null,
        optionRadius: firstOption ? getComputedStyle(firstOption).borderRadius : null,
        dangerBg: dangerOption ? getComputedStyle(dangerOption).backgroundColor : null,
      };
    });
    expect(layout.contentOverflow).toBe("hidden");
    expect(layout.listOverflow).toBe("auto");
    expect(layout.optionWidth).toBeGreaterThanOrEqual(layout.listWidth - 2);
    expect(layout.optionBorderTop).toBe("0px");
    expect(layout.optionRadius).toBe("0px");
    expect(layout.dangerBg).toBe("rgba(0, 0, 0, 0)");

    // Disabled commands explain why they are unavailable.
    const stopAll = palette.getByRole("option", { name: /Stop all runs/ });
    await expect(stopAll).toBeDisabled();
    await expect(stopAll).toContainText("No active runs");

    // Resting state keeps the result count visually quiet; filtering shows match highlight and count.
    const count = palette.locator(".command-palette-count");
    await expect(count).toHaveText("");
    await search.fill("Dark");
    await expect(count).toHaveText("1 result");
    const darkOption = palette.getByRole("option", { name: /Theme: Dark/ });
    await expect(darkOption).toHaveAttribute("aria-selected", "true");
    await expect(darkOption.locator("mark")).toHaveText("Dark");

    // Pressing Enter runs the active command and closes the palette.
    await page.keyboard.press("Enter");
    await expect(palette).toBeHidden();
    await expect(page.locator(":root")).toHaveAttribute("data-color-scheme", "dark");

    // Reopen via keyboard shortcut (Meta+K / Control+K).
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    await expect(palette).toBeVisible();
    await expect(search).toBeFocused();

    // Empty state offers Clear search recovery returning focus to the combobox.
    await search.fill("zzznomatch");
    await expect(count).toHaveText("0 results");
    await expect(palette.getByText("No matching commands.")).toBeVisible();
    await palette
      .locator(".command-palette-empty")
      .getByRole("button", { name: "Clear search" })
      .click();
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(count).toHaveText("");

    // Escape closes immediately even when search text is present.
    await search.fill("Light");
    await expect(palette.getByRole("option", { name: /Theme: Light/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();

    // Restore Light theme via arrow navigation + Enter.
    await commandsButton.click();
    await expect(palette).toBeVisible();
    await search.fill("Theme:");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await expect(palette.getByRole("option", { name: /Theme: Light/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("Enter");
    await expect(palette).toBeHidden();
    await expect(page.locator(":root")).toHaveAttribute("data-color-scheme", "light");
  } finally {
    await fixture.close();
  }
});
