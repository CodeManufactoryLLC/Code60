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
    await expect(page.getByText("Code60 Gateway connected", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Code60 Gateway connected", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Pairing code", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    const chat = page.locator(".orchestration-chat-page:visible");
    const composer = chat.getByRole("combobox", { name: "Message to orchestrator", exact: true });
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
    await expect(page.getByText("Code60 Gateway connected", { exact: true })).toBeVisible();
    await policy("off");
    await expect(page.getByText("Code60 Gateway connected", { exact: true })).toBeVisible();
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
async function app(page: Page, name: string) {
  await expandNavigation(page, "Manage");
  await page.getByRole("tab", { name: "Apps", exact: true }).click();
  await page.getByRole("button", { name: `Open ${name}`, exact: true }).click();
}

test("browser: approved conversation continues with no browser and reattaches without resubmitting", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  const gate = join(fixture.directory, "continue");
  try {
    const first = await fixture.open();
    await start(first.page, fixture.directory);
    await first.page.getByRole("button", { name: "Relay", exact: true }).click();
    const composer = first.page.getByRole("combobox", {
      name: "Message to orchestrator",
      exact: true,
    });
    await composer.fill(
      JSON.stringify([
        { message: "Before tab closed" },
        { waitForFile: gate },
        { message: "After tab closed" },
      ]),
    );
    await composer.press("Enter");
    await expect(first.page.locator(".orchestration-chat-page:visible")).toContainText(
      "Before tab closed",
    );
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
      second.page.getByRole("combobox", { name: "Message to orchestrator", exact: true }),
    ).toBeEditable();
  } finally {
    await writeFile(gate, "release").catch(() => {});
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
    await page.getByRole("tab", { name: "Assistants", exact: true }).click();
    await page.getByRole("button", { name: "Open Custom Assistants", exact: true }).click();
    await page.getByRole("button", { name: "New Assistant", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "New Assistant", exact: true });
    await editor.getByLabel("Name", { exact: true }).fill("Browser reviewer");
    await editor
      .getByLabel("Special instructions", { exact: true })
      .fill("Review the requested change with concise findings.");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Open Browser reviewer", exact: true }),
    ).toBeVisible();
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
    await app(page, "Update Manager");
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
    await expandNavigation(page, "Manage");
    await page.getByRole("tab", { name: "Apps", exact: true }).click();
    await expect(page.locator(".page-panel:not([hidden])")).toHaveCount(1);
    await expect(page.locator("#panel-apps .navigation-list-row").first()).toBeVisible();
    await expect(page.locator("#panel-apps [data-slot='card']")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Product navigation" })).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("carbon-apps-light.png"),
      animations: "disabled",
    });
    // Compare the visible content with the workspace edge, including Carbon's
    // breakpoint margin and the column's half gutter.
    async function expectPageAlignment(heading: string, content: string) {
      for (const [width, inset] of [
        [390, 16],
        [768, 32],
        [1600, 40],
      ] as const) {
        await page.setViewportSize({ width, height: 1000 });
        const workspace = page.locator(".app-workspace");
        const title = page.locator(heading).filter({ visible: true }).first();
        const body = page.locator(content).filter({ visible: true }).first();
        await expect
          .poll(async () => {
            const left = (element: Element) => element.getBoundingClientRect().left;
            const edge = await workspace.evaluate(left);
            return [(await title.evaluate(left)) - edge, (await body.evaluate(left)) - edge];
          })
          .toEqual([inset, inset]);
      }
    }
    await expectPageAlignment("#panel-apps .content-page-title", "#panel-apps .navigation-list");
    const nav = page.getByRole("navigation", { name: "Product navigation" });
    const group = (name: string) => nav.getByRole("button", { name, exact: true });
    const manage = group("Manage");
    const apps = nav.getByRole("tab", { name: "Apps", exact: true });
    for (const name of ["Automation", "Inspect"])
      await expect(group(name)).toHaveAttribute("aria-expanded", "false");
    const fontSize = (el: Element) => parseFloat(getComputedStyle(el).fontSize);
    expect(
      await manage.locator(".cds--side-nav__submenu-title").evaluate(fontSize),
    ).toBeGreaterThan(await apps.locator(".page-tab-label").evaluate(fontSize));
    await apps.press("Escape");
    await expect(manage).toBeFocused();
    await expect(manage).toHaveAttribute("aria-expanded", "false");
    await expect(apps).toBeHidden();
    await expect(page.locator("#panel-apps")).toBeVisible();
    await manage.press("Space");
    await expect(apps).toBeVisible();
    await group("Automation").press("Enter");
    await expect(nav.getByRole("tab", { name: "Scheduled Jobs" })).toBeVisible();
    await group("Automation").click();
    await page.getByRole("button", { name: "Open Scheduled Jobs", exact: true }).click();
    await expect(group("Automation")).toHaveAttribute("aria-expanded", "true");
    await expect(nav.getByRole("tab", { name: "Scheduled Jobs" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("link", { name: "Skip to main content" }).press("Enter");
    await expect(page.locator("#panel-automations")).toBeFocused();
    await expectPageAlignment("#jobs-page-heading", "#panel-automations .cds--tabs");
    await app(page, "Command Builder");
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
    await appearance.getByRole("combobox", { name: "Theme", exact: true }).selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
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
      .getByRole("combobox", { name: "Message to orchestrator", exact: true });
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
    const appsTab = first.page.getByRole("tab", { name: "Apps", exact: true });
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
    ).toHaveCSS("background-color", "rgb(15, 98, 254)");
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
      .getByRole("button", { name: "Confirm", exact: true })
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
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await expect(content.getByText("No scheduled jobs.", { exact: true })).toBeVisible();
    await tab(second.page, "Execution history").click();
    await expect(table.getByRole("radio")).toHaveCount(2);
    await expandNavigation(second.page, "Manage");
    await second.page
      .getByRole("navigation", { name: "Product navigation" })
      .getByRole("tab", { name: "Apps", exact: true })
      .click();
    await second.page.mouse.move(1590, 10);
    await expect
      .poll(() =>
        second.page.getByRole("tab", { name: "Apps", exact: true }).evaluate((element) => {
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

test("browser: confirmed Stop Code60 Gateway closes the runtime and preserves its database", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const { page } = await fixture.open();
    await start(page, fixture.directory);
    await app(page, "System Manager");
    const service = page.getByRole("region", { name: "Code60 Gateway", exact: true });
    await expect(service.getByRole("status")).toContainText("Running");
    await page.getByRole("button", { name: "System Manager actions" }).click();
    await Promise.all([
      page.waitForResponse((response) => {
        if (!response.url().endsWith("/api/operation") || !response.ok()) return false;
        const request = response.request().postDataJSON();
        return request.operation === "automation" && request.value?.control === "status";
      }),
      page.getByRole("menuitem", { name: "Refresh Code60 Gateway", exact: true }).click(),
    ]);
    await expect(service).toHaveAttribute("aria-busy", "false");
    await expect(service.getByRole("status")).toContainText("Running");
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    await Promise.all([
      page.waitForRequest(
        (request) =>
          request.url().endsWith("/api/operation") &&
          request.postDataJSON()?.operation === "gateway-stop",
      ),
      page.getByRole("button", { name: "Stop Code60 Gateway", exact: true }).click(),
    ]);
    await page
      .getByRole("dialog", { name: "Stop Code60 Gateway?", exact: true })
      .getByRole("button", { name: "Confirm", exact: true })
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
    const composer = chat.getByRole("combobox", { name: "Message to orchestrator", exact: true });
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
    await page.reload();
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    await expect(
      chat.getByRole("region", { name: "Pending approvals", exact: true }),
    ).toContainText("Run fixture command");
    await chat.getByRole("button", { name: "Deny", exact: true }).click();
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
    await page.getByRole("tab", { name: "Search", exact: true }).click();
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
    await page.getByRole("tab", { name: "Search", exact: true }).click();
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
    await page.getByRole("tab", { name: "Search", exact: true }).click();
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
    await page.getByRole("tab", { name: "Search", exact: true }).click();
    await expect(page.getByRole("heading", { name: "No projects in this database" })).toBeVisible();
    await page.getByRole("button", { name: "Open projects", exact: true }).click();
    await openProject(page, fixture.directory, project);
    await page.getByRole("tab", { name: "Search", exact: true }).click();
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
    const composer = chat.getByRole("combobox", { name: "Message to orchestrator" });
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
    await expect(composer).toHaveValue("Server follow-up draft");
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
    await expect(page.getByRole("button", { name: "Work", exact: true })).toHaveAttribute(
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
  } finally {
    await fixture.close();
  }
});
