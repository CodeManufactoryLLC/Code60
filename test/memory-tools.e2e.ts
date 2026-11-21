import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { type ElectronApplication, expect, type Page, test } from "@playwright/test";
import { MemoryStore } from "../src/desktop/memory-store.js";
import { launchDesktop, removeDesktopFixture } from "./electron-launcher.js";
import { commitFixture } from "./fixtures/git-repository.js";

const root = resolve(import.meta.dirname, "..");
async function send(page: Page, text: string) {
  await expect
    .poll(async () => (await page.evaluate(() => window.desktop.snapshot())).chat.run?.status)
    .toBe("idle");
  const composer = page
    .getByRole("combobox", { name: "Message to orchestrator", exact: true })
    .filter({ visible: true });
  await expect(composer).toBeEditable();
  await composer.fill(text);
  const chat = page.locator(".orchestration-chat-page:visible");
  await expect(chat.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await composer.press("Enter");
  try {
    await expect(chat.locator(".event.prompt").last()).toContainText(text);
  } catch (error) {
    await test.info().attach("synthetic-chat-state", {
      body: JSON.stringify(await page.evaluate(() => window.desktop.snapshot())),
      contentType: "application/json",
    });
    await test.info().attach("synthetic-screen-text", {
      body: (await page.locator("body").textContent()) ?? "",
      contentType: "text/plain",
    });
    throw error;
  }
  await expect
    .poll(async () => (await page.evaluate(() => window.desktop.snapshot())).chat.run?.status)
    .toBe("idle");
  return chat;
}
async function memorySettings(page: Page) {
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  const toggle = page.locator("#settings-card-toggle");
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  await page.getByRole("tab", { name: "Memory", exact: true }).click();
}
for (const kind of ["Relay", "project"] as const) {
  test(`workflow: explicit memory tools persist scoped ${kind} records and respect Memory Off`, async () => {
    test.setTimeout(180_000);
    const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-memory-tools-")));
    const target = join(directory, "synthetic-project");
    const database = join(directory, "projects.sqlite");
    let application: ElectronApplication | undefined;
    try {
      await mkdir(target);
      await mkdir(join(directory, "config/code60"), { recursive: true });
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: target });
      await writeFile(join(target, "evidence.txt"), "unchanged checkout\n");
      execFileSync("git", ["add", "evidence.txt"], { cwd: target });
      commitFixture(target);
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: target, encoding: "utf8" });
      const head = git("rev-parse", "HEAD");
      const index = await readFile(join(target, ".git/index"));
      const worktrees = git("worktree", "list", "--porcelain");
      await writeFile(
        join(directory, "config/code60/config.json"),
        JSON.stringify({
          agents: {
            claude: {
              command: [process.execPath, join(root, "test/fixtures/fake-agent.mjs"), "--relay"],
            },
          },
        }),
      );
      application = await launchDesktop(directory, target, database);
      const page = await application.firstWindow();
      const wizard = page.locator(".agent-setup-dialog");
      await wizard.getByRole("button", { name: "Claude", exact: true }).click();
      await expect(wizard.getByRole("status")).toHaveText("Claude connected");
      await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
      if (kind === "project") {
        await page.getByRole("button", { name: "Connect to database", exact: true }).click();
        await page
          .getByRole("dialog", { name: "Select database", exact: true })
          .getByRole("button", { name: "Create database…", exact: true })
          .click();
      }
      await page.getByRole("button", { name: "Start", exact: true }).click();
      if (kind === "project") {
        await page.getByRole("tab", { name: "Projects", exact: true }).click();
        await page
          .locator("#panel-projects")
          .getByRole("button", { name: "New Project", exact: true })
          .click();
        await page
          .getByRole("dialog", { name: "Open Project", exact: true })
          .getByRole("button", { name: "Open Folder", exact: true })
          .click();
        await page
          .getByRole("region", { name: `Project ${target}`, exact: true })
          .getByRole("button", { name: `New Session in ${basename(target)}`, exact: true })
          .click();
      }
      await expect
        .poll(async () => (await page.evaluate(() => window.desktop.snapshot())).chat.kind)
        .toBe(kind === "Relay" ? "relay" : "project");
      await send(page, "The factory cache uses Redis for local tests.");
      const chat = await send(page, "Create and revise a memory from the previous exchange.");
      await expect(chat).toContainText("Memory workflow ok; conflict=conflict", {
        timeout: 60_000,
      });
      const record = await page.evaluate(async () =>
        (await window.desktop.browseMemories({})).records.find(
          (r) => r.subject === "factory-cache-explicit",
        ),
      );
      if (!record) throw new Error("Missing tool-created memory");
      expect(record).toMatchObject({
        revision: 2,
        text: "Factory cache uses Redis for local tests.",
        scope: kind === "Relay" ? "conversation" : "project",
        evidence: "agent-reported",
      });
      const detail = await page.evaluate((id) => window.desktop.memoryDetail({ id }), record.id);
      expect(detail.revisions.map((r) => r.revision)).toEqual([2, 1]);
      expect(detail.sources.some((s) => s.text.includes("factory cache"))).toBe(true);
      await memorySettings(page);
      await page
        .locator("#panel-settings-memory")
        .getByRole("button", { name: "Manage memories", exact: true })
        .click();
      await expect(page.locator("#panel-memories")).toContainText(record.text);
      await memorySettings(page);
      const toggle = page
        .locator("#panel-settings-memory")
        .getByRole("switch", { name: "Memory", exact: true });
      await toggle.uncheck();
      await expect(toggle).not.toBeChecked();
      if (kind === "Relay") await page.getByRole("button", { name: "Relay", exact: true }).click();
      else
        await page
          .getByRole("region", { name: `Project ${target}`, exact: true })
          .locator(".chat-sidebar-entry")
          .last()
          .click();
      const disabled = await send(page, "Retrieve memories while disabled.");
      await expect(disabled).toContainText("Explicit memory status: disabled");
      await page.screenshot({ path: test.info().outputPath("memory-tools-disabled.png") });
      await application.close();
      application = undefined;
      const store = new MemoryStore(join(directory, "state/code60/memory"));
      try {
        expect(store.detail(record.id).record).toMatchObject({
          id: record.id,
          revision: 2,
          text: record.text,
        });
        expect(store.settings().enabled).toBe(false);
      } finally {
        store.close();
      }
      expect(git("rev-parse", "HEAD")).toBe(head);
      expect(await readFile(join(target, ".git/index"))).toEqual(index);
      expect(git("worktree", "list", "--porcelain")).toBe(worktrees);
      expect(await readFile(join(target, "evidence.txt"), "utf8")).toBe("unchanged checkout\n");
      await test.info().attach("memory-persistence", {
        body: JSON.stringify({
          id: record.id,
          revision: 2,
          scope: record.scope,
          conflict: "conflict",
          disabled: true,
          checkoutUnchanged: true,
        }),
        contentType: "application/json",
      });
    } finally {
      await application?.close().catch(() => {});
      await removeDesktopFixture(directory, { recursive: true, force: true });
    }
  });
}
