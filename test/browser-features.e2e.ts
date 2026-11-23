import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { browserApp, createDatabase, onboard, openProject } from "./fixtures/browser-app.js";
import { commitFixture } from "./fixtures/git-repository.js";

async function start(page: Page, directory: string) {
  await onboard(page);
  await createDatabase(page, directory);
  await page.getByRole("button", { name: "Start", exact: true }).click();
}
async function app(page: Page, name: string) {
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
    await second.page.getByRole("button", { name: "Start", exact: true }).click();
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
    await memory.uncheck();
    await expect(memory).not.toBeChecked();
    await page.reload();
    await app(page, "Memory");
    await expect(memory).not.toBeChecked();
    await memory.check();
    await expect(memory).toBeChecked();
    await app(page, "Update Manager");
    await expect(page.locator(".updates-page, #app-updates").first()).toContainText("manual");
    await page.setViewportSize({ width: 900, height: 760 });
    await page.screenshot({ path: test.info().outputPath("browser-manual-update.png") });
    expect(await readFile(join(fixture.directory, "projects.sqlite"))).toBeTruthy();
  } finally {
    await fixture.close();
  }
});

test("browser: scheduled job runs in an isolated worktree while the browser is closed", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const fixture = await browserApp(browser);
  const repo = join(fixture.directory, "scheduled-repo");
  const gate = join(fixture.directory, "release-schedule");
  await mkdir(repo);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8", timeout: 10_000 });
  git("init", "-q", "-b", "main");
  await writeFile(join(repo, "result.txt"), "original\n");
  git("add", ".");
  commitFixture(repo);
  const head = git("rev-parse", "HEAD");
  const index = await readFile(join(repo, ".git/index"));
  try {
    const first = await fixture.open();
    await start(first.page, fixture.directory);
    await app(first.page, "Scheduled Jobs");
    await first.page.getByRole("button", { name: "Scheduled Jobs actions", exact: true }).click();
    await first.page.getByRole("menuitem", { name: "New scheduled job", exact: true }).click();
    const form = first.page.getByRole("region", { name: "New scheduled job", exact: true });
    await form.getByLabel("Name", { exact: true }).fill("Browser background job");
    await form
      .getByLabel("Saved prompt", { exact: true })
      .fill(
        JSON.stringify([
          { waitForFile: gate },
          { write: { path: "result.txt", content: "scheduled result\n" } },
          { message: "Schedule completed offline" },
        ]),
      );
    await form.getByRole("button", { name: "Choose repository", exact: true }).click();
    const chooser = first.page.getByRole("dialog", { name: "Choose folder", exact: true });
    await chooser
      .getByRole("button", { name: `Open folder ${fixture.directory}`, exact: true })
      .click();
    await chooser.getByRole("button", { name: "Open folder scheduled-repo", exact: true }).click();
    await chooser.getByRole("button", { name: "Select this folder", exact: true }).click();
    await first.page
      .getByRole("dialog", { name: "Use this automation repository?", exact: true })
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    await form.getByRole("button", { name: "Create job", exact: true }).click();
    await first.page
      .getByRole("button", { name: "Run Browser background job", exact: true })
      .click();
    await expect(
      first.page.getByRole("button", { name: "Stop Browser background job", exact: true }),
    ).toBeVisible();
    await first.context.close();
    await writeFile(gate, "continue");
    const second = await fixture.open();
    await second.page.getByRole("button", { name: "Take control", exact: true }).click();
    await second.page.getByRole("button", { name: "Start", exact: true }).click();
    await app(second.page, "Scheduled Jobs");
    await expect(
      second.page.getByRole("button", { name: "Run Browser background job", exact: true }),
    ).toBeVisible();
    const history = (await fixture.gateway.scheduler?.request({ action: "history" })) as {
      status: string;
      runId?: string;
    }[];
    expect(history?.[0]?.status).toBe("finished");
    expect(history?.[0]?.runId).toBeTruthy();
    expect(await readFile(join(repo, "result.txt"), "utf8")).toBe("original\n");
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(await readFile(join(repo, ".git/index"))).toEqual(index);
    expect(git("worktree", "list", "--porcelain")).toContain("code60");
    await second.page.screenshot({ path: test.info().outputPath("browser-scheduled-history.png") });
  } finally {
    await writeFile(gate, "continue").catch(() => {});
    await fixture.close();
  }
});

test("browser: confirmed Stop Backend closes the runtime and preserves its database", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const { page } = await fixture.open();
    await start(page, fixture.directory);
    await page.getByRole("button", { name: "Stop Code60 Backend", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Stop Code60 Backend?", exact: true })
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
    await next.page.getByRole("button", { name: "Start", exact: true }).click();
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
