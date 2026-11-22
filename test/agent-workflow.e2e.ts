import { execFileSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type ElectronApplication, expect, type Locator, type Page, test } from "@playwright/test";
import { launchDesktop, removeDesktopFixture } from "./electron-launcher.js";
import { fileViewLabels } from "./file-panel-controls.js";
import { commitFixture } from "./fixtures/git-repository.js";
import { pageCommand } from "./page-header-controls.js";

const root = resolve(import.meta.dirname, "..");
// Automatic integration and message Undo each write several private checkpoint and
// journal records; on Windows every write launches the native owner/ACL helper and
// atomic replacement. Native ARM64 measured about 5 s for each step.
const nativeJournalTimeout = 5_000;

async function attachJsonEvidence(name: string, evidence: unknown) {
  const info = test.info();
  const path = info.outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify(evidence, null, 2));
  await info.attach(name, { path, contentType: "application/json" });
}

test("workflow: conversational browser modes, external errors, cancellation and restart", async () => {
  test.setTimeout(90_000);
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-browser-ui-")));
  const config = join(directory, "config/code60");
  const bin = join(directory, "bin");
  const log = join(directory, "browser.jsonl");
  const approval = join(directory, "extension-approved");
  await mkdir(config, { recursive: true });
  await mkdir(bin);
  await copyFile(join(root, "test/fixtures/fake-browser.mjs"), join(bin, "npx"));
  await chmod(join(bin, "npx"), 0o755);
  await writeFile(log, "");
  await writeFile(
    join(config, "config.json"),
    JSON.stringify({
      agents: {
        claude: {
          command: [process.execPath, join(root, "test/fixtures/fake-agent.mjs"), "--browser"],
        },
      },
    }),
  );
  type BrowserEvidence = {
    event: string;
    mode: string;
    pid: number;
    child: number;
    args: string[];
    cwd: string;
  };
  const evidence = async () =>
    (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as BrowserEvidence);
  const starts = async () => (await evidence()).filter((entry) => entry.event === "start");
  let application: ElectronApplication | undefined;
  const environment = {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    FAKE_BROWSER_LOG: log,
    FAKE_BROWSER_APPROVAL: approval,
  };
  try {
    application = await launchDesktop(
      directory,
      directory,
      join(directory, "unused.sqlite"),
      false,
      environment,
    );
    let page = await application.firstWindow();
    const wizard = page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Claude", exact: true }).click();
    await expect(wizard.getByRole("status")).toHaveText("Claude connected");
    await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    const send = async (text: string, expected?: string) => {
      const chat = page.locator(".orchestration-chat-page:visible");
      await expect
        .poll(() =>
          page.evaluate(() =>
            window.desktop.snapshot().then((snapshot) => snapshot.chat.run?.status),
          ),
        )
        .toBe("idle");
      const id = await page.evaluate(() =>
        window.desktop.snapshot().then((snapshot) => snapshot.chat.run?.id),
      );
      if (!id) throw new Error("Missing selected conversation");
      await expect(chat).toHaveAttribute("data-chat-id", id);
      await expect(chat).not.toHaveAttribute("inert");
      const composer = chat.getByRole("combobox", { name: "Message to orchestrator", exact: true });
      const before = await chat.locator(".event.message .chat-markdown").count();
      await expect(composer).toBeEditable();
      await composer.fill(text);
      await composer.press("Enter");
      if (expected) {
        await expect
          .poll(() => chat.locator(".event.message .chat-markdown").count())
          .toBeGreaterThan(before);
        await expect(chat.locator(".event.message .chat-markdown").last()).toContainText(expected);
        await expect(chat.getByRole("button", { name: "Send", exact: true })).toBeVisible();
      }
    };
    await send("Report the browser mode.", '"mode":"headless","connected":false');
    expect(await starts()).toEqual([]); // Setup, initial connection and status never launch Playwright.
    await send("Open https://example.com/default.", "Fixture navigation in headless");
    expect((await starts())[0]?.args).toEqual([
      "-y",
      "@playwright/mcp@0.0.84",
      "--isolated",
      "--headless",
      "--no-webmcp",
      "--output-max-size",
      "33554432",
      "--output-dir",
      expect.any(String),
    ]);
    const first = (await starts())[0] as BrowserEvidence;
    expect(alive(first.pid)).toBe(true);
    expect(alive(first.child)).toBe(true);
    await send(
      "Use visible browser to open https://example.com/visible.",
      "Fixture navigation in visible",
    );
    await expect.poll(() => alive(first.pid) || alive(first.child)).toBe(false);
    const visible = (await starts())[1] as BrowserEvidence;
    expect(visible.args).toEqual([
      "-y",
      "@playwright/mcp@0.0.84",
      "--isolated",
      "--no-webmcp",
      "--output-max-size",
      "33554432",
      "--output-dir",
      expect.any(String),
    ]);
    await send("Open https://example.com/still-visible.", "Fixture navigation in visible");
    expect(await starts()).toHaveLength(2); // A later request retains this conversation's preference.
    await page.getByRole("tab", { name: "Home", exact: true }).click();
    await page.getByRole("button", { name: "Open Custom Assistants", exact: true }).click();
    await page.getByRole("button", { name: "New Assistant", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "New Assistant", exact: true });
    await editor.getByLabel("Name", { exact: true }).fill("Browser helper");
    await editor.getByLabel("Special instructions", { exact: true }).fill("Help with websites.");
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Open Browser helper", exact: true }).click();
    await expect(page.getByRole("main", { name: "Agent", exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.desktop.snapshot().then((snapshot) => snapshot.chat.customAgentId),
        ),
      )
      .toBeTruthy();
    await send("Report the browser mode.", '"mode":"headless","connected":false');
    expect(alive(visible.pid)).toBe(true);
    expect(await starts()).toHaveLength(2);
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.desktop.snapshot().then((snapshot) => snapshot.chat.customAgentId ?? null),
        ),
      )
      .toBeNull();
    await send("Report the browser mode.", '"mode":"visible","connected":true');
    await send(
      "Use existing browser to open https://example.com/existing.",
      "Playwright extension unavailable",
    );
    await expect.poll(() => alive(visible.pid) || alive(visible.child)).toBe(false);
    const existing = (await starts())[2] as BrowserEvidence;
    expect(existing.args).toEqual([
      "-y",
      "@playwright/mcp@0.0.84",
      "--extension",
      "--no-webmcp",
      "--output-max-size",
      "33554432",
      "--output-dir",
      expect.any(String),
    ]);
    await send("Report the browser mode.", '"mode":"existing-browser"');
    expect(await starts()).toHaveLength(3); // An upstream isError never silently selects another mode.
    // Simulate the external extension becoming installed/approved, not an app mutation.
    await writeFile(approval, "approved");
    await send("Open https://example.com/approved.", "Fixture navigation in existing-browser");
    expect(await starts()).toHaveLength(3);
    await send("Close the browser.", '"connected":false');
    await expect.poll(() => alive(existing.pid) || alive(existing.child)).toBe(false);
    await send("Use visible browser to open https://example.com/slow.");
    await expect
      .poll(async () => (await evidence()).filter((entry) => entry.event === "call").length)
      .toBe(6);
    const slow = (await starts())[3] as BrowserEvidence;
    await page
      .locator(".orchestration-chat-page:visible")
      .getByRole("button", { name: "Stop", exact: true })
      .click();
    await expect.poll(() => alive(slow.pid) || alive(slow.child)).toBe(false);
    await page.screenshot({ path: test.info().outputPath("browser-cancelled.png") });
    await application.close();
    application = undefined;
    for (const entry of await starts()) expect(alive(entry.pid) || alive(entry.child)).toBe(false);
    const beforeRestart = (await starts()).length;
    const saved = JSON.parse(await readFile(join(directory, "state/code60/desktop.json"), "utf8"));
    expect(JSON.stringify(saved)).not.toContain("existing-browser");
    expect(JSON.stringify(saved)).not.toContain("visible");
    application = await launchDesktop(
      directory,
      directory,
      join(directory, "unused.sqlite"),
      false,
      environment,
    );
    page = await application.firstWindow();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await send("Report the browser mode.", '"mode":"headless","connected":false');
    expect(await starts()).toHaveLength(beforeRestart); // Restart retains history, not mode or browser processes.
    await send("Open https://example.com/after-restart.", "Fixture navigation in headless");
    const restarted = (await starts()).at(-1) as BrowserEvidence;
    expect(restarted.mode).toBe("headless");
    expect(alive(restarted.pid)).toBe(true); // finally must release this idle connection on quit.
  } finally {
    if (application) await application.close();
    for (const entry of await starts()) {
      await expect.poll(() => alive(entry.pid) || alive(entry.child)).toBe(false);
    }
    const artifact = test.info().outputPath("browser-processes.json");
    await writeFile(
      artifact,
      JSON.stringify(
        {
          events: await evidence(),
          cleanup: (await starts()).map(({ pid, child }) => ({
            pid,
            child,
            alive: alive(pid),
            childAlive: alive(child),
          })),
        },
        null,
        2,
      ),
    );
    await test
      .info()
      .attach("browser-process-cleanup", { path: artifact, contentType: "application/json" });
    await removeDesktopFixture(directory, { recursive: true, force: true });
  }
});
type NativeDialog = {
  kind: "save" | "open" | "message";
  title?: string;
  message?: string;
  detail?: string;
  properties?: string[];
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
  response?: number;
};
type DialogState = {
  expected: NativeDialog[];
  observed: Record<string, unknown>[];
  unexpected: Record<string, unknown>[];
  allowQuit: boolean;
};
type ProcessEvidence = { pid: number; parent: number; cwd: string };
type BreadcrumbFrameSample = {
  opacity: number;
  current: number;
  exits: number;
  height: number;
  trail: string;
  visibleChats: number;
  safePending: boolean;
};

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function checkAgentMessageSpacing(
  app: ElectronApplication,
  page: Page,
  chat: Locator,
  name: string,
  fontSize: number,
) {
  const messages = chat.locator(".event.message");
  await expect.poll(() => messages.count()).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const settled = async () => {
    await expect(chat.locator('[data-layout-animating="true"]')).toHaveCount(0);
    await expect
      .poll(() =>
        messages.evaluateAll((elements) =>
          elements.every((element) => {
            const outer = element.closest(".chat-message-layout");
            if (!outer) return true; // Worker messages are direct transcript children.
            const inner = outer.querySelector(".chat-message-layout-content");
            return (
              inner &&
              Math.abs(
                outer.getBoundingClientRect().height - inner.getBoundingClientRect().height,
              ) < 0.05
            );
          }),
        ),
      )
      .toBe(true);
  };
  const measure = () =>
    messages.evaluateAll((elements) =>
      elements.map((element) => {
        const markdown = element.querySelector(".chat-markdown");
        const bubble = element.querySelector(".agent-message-bubble");
        const controls = element.querySelector(".message-copy");
        const copy = controls?.querySelector("button");
        const outer = element.closest(".chat-message-layout");
        if (!markdown || !bubble || !controls || !copy)
          throw new Error("Missing message layout or Copy");
        const style = getComputedStyle(markdown);
        const bounds = markdown.getBoundingClientRect();
        const target = copy.getBoundingClientRect();
        // Parent items use display:contents turn containers, some empty after
        // activity is folded into its disclosure. Workers are direct children.
        let nextItem = outer ? outer.parentElement?.nextElementSibling : element.nextElementSibling;
        while (nextItem?.matches(".chat-turn-content") && !nextItem.firstElementChild)
          nextItem = nextItem.nextElementSibling;
        const candidate = nextItem?.matches(".chat-turn-content")
          ? nextItem.firstElementChild
          : nextItem;
        const next = candidate?.matches(".chat-message-layout, .event.message, .chat-activity")
          ? candidate
          : null;
        return {
          text: markdown.textContent,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          bubblePadding: getComputedStyle(bubble).padding,
          outerPadding: getComputedStyle(element).padding,
          width: bounds.width,
          height: bounds.height,
          copyWidth: target.width,
          copyHeight: target.height,
          trailingGap:
            (outer ?? element).getBoundingClientRect().bottom -
            controls.getBoundingClientRect().bottom +
            (outer ? 0 : Number.parseFloat(getComputedStyle(element).marginBottom)),
          adjacentGap: next
            ? next.getBoundingClientRect().top - controls.getBoundingClientRect().bottom
            : null,
        };
      }),
    );
  // Recreate the pre-PR margin on the same replies. Bubble and outer padding,
  // typography, viewport and display settings remain identical in both samples.
  await messages.evaluateAll((elements) => {
    for (const element of elements)
      if (element instanceof HTMLElement) element.style.marginBottom = "8px";
  });
  let before: Awaited<ReturnType<typeof measure>>;
  try {
    await settled();
    before = await measure();
    await chat.screenshot({ path: test.info().outputPath(`${name}-spacing-before.png`) });
  } finally {
    await messages.evaluateAll((elements) => {
      for (const element of elements)
        if (element instanceof HTMLElement) element.style.removeProperty("margin-bottom");
    });
  }
  await settled();
  const after = await measure();
  await chat.screenshot({ path: test.info().outputPath(`${name}-spacing-after.png`) });
  await test.info().attach(`${name}-message-spacing`, {
    body: JSON.stringify({ before, after }, null, 2),
    contentType: "application/json",
  });
  expect(after).toHaveLength(before.length);
  expect(before.filter((message) => message.adjacentGap !== null).length).toBeGreaterThan(0);
  for (const [index, message] of after.entries()) {
    const previous = before[index];
    if (!previous) throw new Error("Message set changed during spacing measurement");
    const { width, height, copyWidth, copyHeight, trailingGap, adjacentGap, ...content } = message;
    const {
      width: oldWidth,
      height: oldHeight,
      copyWidth: oldCopyWidth,
      copyHeight: oldCopyHeight,
      trailingGap: oldTrailingGap,
      adjacentGap: oldAdjacentGap,
      ...oldContent
    } = previous;
    expect(content).toEqual(oldContent);
    expect(message.fontSize).toBe(`${fontSize}px`);
    expect(message.bubblePadding).toBe("12px 18px");
    expect(message.outerPadding).toBe("0px 0px 16px");
    // 0.05 CSS px permits subpixel transform noise, not a visible size change.
    for (const [actual, expected] of [
      [width, oldWidth],
      [height, oldHeight],
      [copyWidth, oldCopyWidth],
      [copyHeight, oldCopyHeight],
      [oldTrailingGap, 24],
      [trailingGap, oldTrailingGap * 0.75],
    ] as const) {
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.05);
    }
    if (oldAdjacentGap !== null) {
      expect(adjacentGap).not.toBeNull();
      expect(Math.abs((adjacentGap as number) - oldAdjacentGap * 0.75)).toBeLessThanOrEqual(0.05);
    }
    expect(copyWidth).toBeGreaterThanOrEqual(24 - 0.05);
    expect(copyHeight).toBeGreaterThanOrEqual(24 - 0.05);
    // An earlier toast or copied reply cannot satisfy this activation.
    await app.evaluate(
      ({ clipboard }, sentinel) => clipboard.writeText(sentinel),
      `${name}-${index}-not-copied`,
    );
    const copy = messages.nth(index).getByRole("button", { name: "Copy message", exact: true });
    await copy.focus();
    await expect(copy).toBeVisible();
    await copy.press("Enter");
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(message.text);
  }
}

async function checkSidebarIconSpacing(entry: Locator) {
  // Opening lazily replaces the placeholder row. Sample all boxes in the same frame.
  await expect(async () => {
    await expect(entry).toBeVisible();
    const { icon, label, row } = await entry.evaluate((element) => ({
      icon: element.querySelector(".navigation-icon")?.getBoundingClientRect().toJSON(),
      label: element.querySelector(".chat-sidebar-label")?.getBoundingClientRect().toJSON(),
      row: element.getBoundingClientRect().toJSON(),
    }));
    if (!icon || !label) throw new Error("Missing sidebar icon or label");
    expect(icon.width).toBeGreaterThan(0);
    expect(icon.x).toBeGreaterThanOrEqual(row.x);
    expect(label.width).toBeGreaterThan(0);
    expect(icon.x + icon.width + 8).toBeLessThanOrEqual(label.x + 0.5);
    expect(label.x + label.width).toBeLessThanOrEqual(row.x + row.width + 0.5);
  }).toPass({ timeout: 5_000 });
}

async function checkHeaderBreadcrumbs(page: Page) {
  const header = page.locator(".workspace-breadcrumbs");
  await expect(header.getByRole("navigation")).toHaveCount(0);
  await expect(header.getByRole("combobox")).toHaveCount(0);
  await expect(header.getByRole("heading")).toHaveCount(0);
  await expect(header).toHaveCSS("box-shadow", "none");
  await expect(header).toHaveCSS("border-radius", "5px");
  const title = page.locator(".content-page-title:visible");
  await expect(title).toHaveCount(1);
  await expect(title).toHaveCSS("font-size", "16px");
  await expect(title).toHaveCSS("font-weight", "700");
  await expect(title.locator(".navigation-icon")).toHaveCount(1);
  await expect(header.getByRole("button", { name: "Back", exact: true })).toBeVisible();
  await expect(header.getByRole("button", { name: /^Color theme:/ })).toBeVisible();
}

async function checkSidebarNavigation(page: Page, repo: string) {
  const project = page.getByRole("region", { name: `Project ${repo}`, exact: true });
  const newChat = project.getByRole("button", { name: /^New Session in / });
  const composer = page.getByRole("combobox", { name: "Message to orchestrator", exact: true });
  const entries = project.locator(".chat-sidebar-entry");
  let count = await entries.count();
  for (const name of ["First sidebar draft", "Second sidebar draft"]) {
    await newChat.click();
    await expect(entries).toHaveCount(++count);
    await expect(entries.last()).toHaveAttribute("aria-current", "true");
    await expect(composer).toBeEditable();
    await composer.fill(name);
  }

  // Two sessions in the SAME project must retain separate tab sets and selections.
  const panel = page.locator("#chat-file-panel");
  const tabs = panel.getByRole("tablist", { name: "File tabs", exact: true });
  const first = entries.nth(count - 2);
  const second = entries.nth(count - 1);
  await first.click();
  await expect(first).toHaveAttribute("aria-current", "true");
  await expect(composer).toHaveValue("First sidebar draft");
  const toggle = page.getByRole("button", { name: "Toggle files panel", exact: true });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await panel.getByRole("button", { name: "Open Files", exact: true }).click();
  await panel.getByRole("treeitem", { name: "docs", exact: true }).click();
  await expect(panel.getByRole("treeitem", { name: "nested.txt", exact: true })).toBeVisible();
  await panel.getByRole("treeitem", { name: "result.txt", exact: true }).click();
  await expect(panel.locator(".view-lines")).toContainText("original");
  await panel.getByRole("button", { name: "New file tab", exact: true }).click();
  await panel.getByRole("button", { name: "Open Memory Recall", exact: true }).click();
  await tabs.getByRole("tab", { name: "result.txt", exact: true }).click();
  await tabs.getByRole("tab", { name: "result.txt", exact: true }).press("Alt+ArrowLeft");
  await second.click();
  await expect(tabs.getByRole("tab")).toHaveCount(0);
  await panel.getByRole("button", { name: "Open Files", exact: true }).click();
  await panel.getByRole("treeitem", { name: "notes.txt", exact: true }).click();
  await expect(panel.locator(".view-lines")).toContainText("unstaged notes");
  await tabs.getByRole("button", { name: "Close File Explorer", exact: true }).click();
  await panel.getByRole("button", { name: "New file tab", exact: true }).click();
  await tabs.getByRole("tab", { name: "notes.txt", exact: true }).click();
  await first.click();
  await expect(tabs.getByRole("tab")).toHaveText(["result.txt", "File Explorer", "Memory Recall"]);
  await expect(tabs.getByRole("tab", { name: "result.txt", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(panel.locator(".view-lines")).toContainText("original");
  await tabs.getByRole("tab", { name: "File Explorer", exact: true }).click();
  await expect(panel.getByRole("treeitem", { name: "docs", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(panel.getByRole("treeitem", { name: "nested.txt", exact: true })).toBeVisible();
  await tabs.getByRole("tab", { name: "result.txt", exact: true }).click();
  await tabs.getByRole("button", { name: "Close Memory Recall", exact: true }).click();
  await second.click();
  await expect(tabs.getByRole("tab")).toHaveText(["notes.txt", "New tab"]);
  await expect(tabs.getByRole("tab", { name: "notes.txt", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(panel.locator(".view-lines")).toContainText("unstaged notes");
  await page.screenshot({ path: test.info().outputPath("session-panel-isolation.png") });
  await page.getByRole("button", { name: "Toggle files panel", exact: true }).click();

  for (const theme of ["light", "dark"]) {
    await page.locator("#tab-apps").click();
    await page.locator("#tab-settings-appearance").click();
    await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption(theme);
    await checkHeaderBreadcrumbs(page);
    const composerFill = theme === "light" ? "rgb(255, 255, 255)" : "rgb(22, 22, 22)";
    const headerFill = theme === "light" ? "rgb(255, 255, 255)" : "rgb(47, 29, 55)";
    await expect(page.locator(".workspace-breadcrumbs")).toHaveCSS("background-color", headerFill);
    await expect(page.locator("#panel-settings")).toHaveCSS(
      "background-color",
      theme === "light" ? "rgb(255, 255, 255)" : "rgb(32, 32, 32)",
    );
    await expect(page.locator(".sidebar")).toHaveCSS("border-width", "0px");
    await expect(page.locator(".sidebar")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(page.locator(".sidebar-navigation-card").first()).toHaveCSS(
      "background-color",
      theme === "light" ? "rgb(255, 255, 255)" : "rgb(32, 32, 32)",
    );
    await expect(page.locator("#panel-settings")).toHaveCSS("box-shadow", "none");
    for (const card of await page.locator(".sidebar-navigation-card").all())
      await expect(card).toHaveCSS("box-shadow", "none");
    for (const card of await page.locator(".sidebar-navigation-card").all())
      await expect(card).toHaveCSS("border-radius", "5px");
    await expect(page.locator(".sidebar-navigation-card")).toHaveCount(6);
    await expect(page.locator(".sidebar-navigation-card > .sidebar-card-header")).toHaveCount(6);
    for (const section of await page.locator(".sidebar-section + .sidebar-section").all())
      await expect(section).toHaveCSS("border-top-width", "1px");
    const canvas = theme === "light" ? "rgb(244, 248, 254)" : "rgb(17, 17, 17)";
    await expect(page.locator(".window-background")).toHaveCSS(
      "background-color",
      theme === "light" ? "rgb(244, 248, 254)" : canvas,
    );
    await expect(page.locator(".app")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.mouse.move(1000, 500);
    await expect(page.locator("#tab-settings-appearance")).toHaveCSS(
      "background-color",
      theme === "light" ? "rgb(147, 197, 253)" : "rgb(70, 70, 70)",
    );
    await expect
      .poll(() =>
        page
          .locator(".sidebar-section")
          .first()
          .evaluate((element) => getComputedStyle(element, "::before").backgroundColor),
      )
      .toBe(theme === "light" ? "rgb(84, 148, 253)" : headerFill);
    for (const section of await page.locator(".sidebar-section").all())
      expect(
        await section.evaluate((element) => getComputedStyle(element, "::before").backgroundColor),
      ).toBe(theme === "light" ? "rgb(84, 148, 253)" : headerFill);
    await expect(page.locator("#tab-home")).toHaveCSS(
      "color",
      theme === "light" ? "rgb(255, 255, 255)" : "rgb(215, 201, 221)",
    );
    await expect(page.locator("body")).toHaveCSS("font-weight", "400");
    await page.locator("#tab-home").scrollIntoViewIfNeeded();
    await page.mouse.move(1000, 500);
    const geometry = await page.evaluate(() => {
      const toggle = document.querySelector(".sidebar-toggle");
      const active = document.querySelector(".page-panel:not([hidden])");
      const card = active?.querySelector(".chat-conversations") ?? active;
      const strip = document.querySelector(".app > .window-drag-strip");
      const footer = document.querySelectorAll(".footer-sidebar > .icon-button");
      if (!toggle || !card || !strip || footer.length !== 2)
        throw new Error("Missing sidebar controls");
      const style = (element: Element) => ({
        color: getComputedStyle(element).color,
        opacity: getComputedStyle(element).opacity,
        glyphOpacity: getComputedStyle(element.querySelector("svg") ?? element).opacity,
      });
      const a = toggle.getBoundingClientRect();
      const b = card.getBoundingClientRect();

      return {
        inside: a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom,
        upperLeft: Math.abs(a.left - b.left - 8) <= 1 && Math.abs(a.top - b.top - 8) <= 1,
        styles: [toggle, ...footer].map(style),
      };
    });
    expect(geometry.inside).toBe(true);
    expect(geometry.upperLeft).toBe(true);
    expect(geometry.styles[0]).toEqual(geometry.styles[1]);
    expect(geometry.styles[0]).toEqual(geometry.styles[2]);

    // Observe the whole selection window, not just its settled appearance.
    await page.evaluate(() => {
      const sidebar = document.querySelector(".sidebar");
      if (!sidebar) throw new Error("Missing sidebar");
      const entries = [...sidebar.querySelectorAll(".chat-sidebar-entry")];
      const disabled: string[] = [];
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations)
          if (
            mutation.attributeName === "disabled" &&
            mutation.oldValue === null &&
            mutation.target instanceof Element &&
            mutation.target.matches(".chat-sidebar-entry, .project-chat-name")
          )
            disabled.push(mutation.target.id);
      });
      observer.observe(sidebar, {
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ["disabled"],
      });
      (
        window as typeof window & {
          sidebarObservation?: {
            observer: MutationObserver;
            entries: Element[];
            disabled: string[];
          };
        }
      ).sidebarObservation = { observer, entries, disabled };
    });
    try {
      for (const control of [
        project.locator(".project-chat-name"),
        project.locator(".chat-sidebar-entry").first(),
        project.locator(".chat-sidebar-entry").last(),
      ]) {
        await control.hover();
        const color = await control.evaluate((element) => getComputedStyle(element).color);
        await page.mouse.down();
        try {
          await expect(control).toHaveCSS("color", color);
        } finally {
          await page.mouse.up();
        }
        await expect(control).toHaveCSS("color", color);
        // Selection finishes through the real main-process path.
        await expect(control).toHaveAttribute("aria-current", /^(page|true)$/);
      }
      await expect(page.locator(".chat-conversations:visible")).toHaveCSS(
        "background-color",
        theme === "light" ? "rgb(255, 255, 255)" : "rgb(32, 32, 32)",
      );
      await expect(composer).toHaveValue("Second sidebar draft");
      await checkHeaderBreadcrumbs(page);
      // Different chat IDs have identical visible trails. Watch the real async
      // selection window, rather than checking only its fully settled frame.
      for (const [entry, draft] of [
        [entries.first(), "First sidebar draft"],
        [entries.last(), "Second sidebar draft"],
      ] as const) {
        await page.evaluate(() => {
          const card = document.querySelector<HTMLElement>(".workspace-breadcrumbs");
          if (!card) throw new Error("Missing breadcrumb card");
          for (const animation of card.getAnimations({ subtree: true })) animation.finish();
          const samples: BreadcrumbFrameSample[] = [];
          const scope = window as typeof window & {
            breadcrumbSamples?: { stop(): typeof samples };
          };
          let frame = 0;
          const sample = () => {
            const items = [
              ...document.querySelectorAll<HTMLElement>(
                ".content-page-heading:not(.content-page-header-fallback)",
              ),
            ].filter((item) => item.checkVisibility());
            const visible = [
              ...document.querySelectorAll<HTMLElement>(
                "#panel-chat .chat-conversations > .orchestration-chat-page:not([hidden])",
              ),
            ];
            samples.push({
              opacity: Math.min(...items.map((item) => Number(getComputedStyle(item).opacity))),
              current: items.length,
              exits: card.querySelectorAll(".breadcrumb-exit").length,
              height: card.getBoundingClientRect().height,
              trail: items
                .map((item) => `${item.textContent}:${getComputedStyle(item).opacity}`)
                .join("|"),
              visibleChats: visible.length,
              safePending: visible.every(
                (chat) =>
                  !chat.hasAttribute("data-navigation-pending") ||
                  (chat.inert &&
                    document.querySelector<HTMLElement>(
                      ".content-page-heading:not(.content-page-header-fallback)",
                    )?.inert === true),
              ),
            });
            frame = requestAnimationFrame(sample);
          };
          sample();
          scope.breadcrumbSamples = {
            stop: () => {
              cancelAnimationFrame(frame);
              delete scope.breadcrumbSamples;
              return samples;
            },
          };
        });
        await entry.click();
        await expect(entry).toHaveAttribute("aria-current", "true");
        await expect(composer).toHaveValue(draft);
        await expect(page.locator(".content-page-heading:visible .content-page-title")).toHaveText(
          (await entry.locator(".chat-sidebar-label").textContent()) ?? "",
        );
        await expect(page.locator(".workspace-breadcrumbs .page-selector-rename")).toHaveCount(0);
        await page.waitForFunction(() =>
          document
            .querySelector(".workspace-breadcrumbs")
            ?.getAnimations({ subtree: true })
            .every((animation) => animation.playState !== "running"),
        );
        const samples = await page.evaluate(() => {
          const scope = window as typeof window & {
            breadcrumbSamples?: {
              stop(): BreadcrumbFrameSample[];
            };
          };
          return scope.breadcrumbSamples?.stop() ?? [];
        });
        expect(samples.length).toBeGreaterThan(0);
        expect(
          samples.every((sample) => sample.opacity === 1),
          JSON.stringify(samples),
        ).toBe(true);
        expect(samples.every((sample) => sample.current === 1 && sample.exits === 0)).toBe(true);
        expect(samples.every((sample) => sample.visibleChats === 1 && sample.safePending)).toBe(
          true,
        );
        expect(
          Math.max(...samples.map((s) => s.height)) - Math.min(...samples.map((s) => s.height)),
        ).toBeLessThan(1);
      }
      await page.screenshot({ path: test.info().outputPath(`chat-breadcrumbs-${theme}.png`) });
      await expect(page.locator(".content-page-heading:visible > button")).toBeVisible();
      await expect(page.locator(".content-page-heading:visible > button")).toHaveCSS(
        "text-decoration-line",
        "none",
      );
      await expect(page.locator(".sidebar .chat-sidebar-status")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "New session", exact: true })).toHaveCount(0);
      const box = composer.locator("..");
      await page.locator(".sidebar-toggle").focus();
      await expect(box).toHaveCSS("border-width", "1px");
      await expect(box).toHaveCSS("background-color", composerFill);
      await expect(composer).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      const bounds = await box.boundingBox();
      await composer.focus();
      await expect(box).toHaveCSS(
        "background-color",
        theme === "light" ? "rgb(255, 255, 255)" : "rgb(32, 32, 32)",
      );
      expect(await box.boundingBox()).toEqual(bounds);
      await project.locator(".project-chat-toggle").press("ArrowLeft");
      await expect(project.locator(".project-chat-toggle")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      await page.locator("#tab-chat").press("ArrowLeft");
      await page.getByRole("button", { name: "Relay", exact: true }).click();
      await expect(page.locator(".relay-sidebar .chat-sidebar-entry")).toHaveAttribute(
        "aria-current",
        "true",
      );
      await expect(page.locator("#projects-card-toggle")).toHaveCount(0);
      await expect(page.locator("#chat-pages")).not.toHaveAttribute("hidden");
      await page.locator("#tab-chat").press("ArrowRight");
      await expect(project.locator(".project-chat-toggle")).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    } finally {
      const observed = await page.evaluate(() => {
        const scope = window as typeof window & {
          sidebarObservation?: {
            observer: MutationObserver;
            entries: Element[];
            disabled: string[];
          };
        };
        const observation = scope.sidebarObservation;
        if (!observation) throw new Error("Missing selection observation");
        observation.observer.disconnect();
        delete scope.sidebarObservation;
        return {
          disabled: observation.disabled,
          retained: observation.entries.every((entry) => entry.isConnected),
        };
      });
      expect(observed).toEqual({ disabled: [], retained: true });
    }
    await page.locator("#advanced-toggle").press("ArrowRight");
    await page.locator("#experiments-toggle").press("ArrowRight");
    await page.locator("#advanced-toggle").press("ArrowLeft");
    for (const id of ["advanced-pages", "experiment-pages"])
      await expect(page.locator(`#${id}`)).toHaveAttribute("inert", "");
    await expect(page.locator("#settings-pages")).not.toHaveAttribute("inert");
    await page.locator("#advanced-toggle").press("ArrowRight");
    await expect(page.locator("#advanced-toggle")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#experiments-toggle")).toHaveAttribute("aria-expanded", "false");
    await page.locator("#tables-toggle").press("ArrowRight");
    await page.locator("#tables-toggle").press("ArrowLeft");
    await expect(page.locator("#tables-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#app-pages")).not.toHaveAttribute("inert");
    await expect(page.locator("#table-pages")).toHaveAttribute("inert", "");
    await page.locator("#tab-apps").click();
    await page.mouse.move(1000, 500);
    await expect(page.locator("#tab-apps")).toHaveCSS(
      "background-color",
      theme === "light" ? "rgb(84, 148, 253)" : "rgb(47, 29, 55)",
    );
    await page.screenshot({ path: test.info().outputPath(`sidebar-navigation-${theme}.png`) });
    await project.locator(".project-chat-toggle").press("ArrowRight");
    const row = entries.last().locator("..");
    const actions = row.locator(".chat-sidebar-action");
    await expect(actions).toHaveCount(2);
    await expect(row.getByRole("button", { name: /^Actions for / })).toHaveCount(0);
    await page.locator(".sidebar-toggle").focus();
    await page.mouse.move(1000, 500);
    await expect(actions.first().locator(".sidebar-card-action")).toHaveCSS("opacity", "0");
    await row.hover();
    const reference = await project.locator(".sidebar-card-add").evaluate((element) => {
      const style = getComputedStyle(element);
      return Object.fromEntries(
        ["width", "height", "borderRadius", "backgroundColor", "border", "boxShadow"].map((key) => [
          key,
          style[key as keyof CSSStyleDeclaration],
        ]),
      );
    });
    for (const action of await actions.all()) {
      const circle = action.locator(".sidebar-card-action");
      await expect(circle).toHaveCSS("opacity", "1");
      expect(
        await circle.evaluate((element, keys) => {
          const style = getComputedStyle(element);
          return Object.fromEntries(
            keys.map((key) => [key, style[key as keyof CSSStyleDeclaration]]),
          );
        }, Object.keys(reference)),
      ).toEqual(reference);
    }
    await page.screenshot({ path: test.info().outputPath(`project-chat-actions-${theme}.png`) });
  }
  const row = entries.last().locator("..");
  const selected = entries.last();
  const id = (await selected.getAttribute("id"))?.replace("conversation-", "");
  await row.getByRole("button", { name: /^Rename chat: / }).focus();
  await expect(row.locator(".sidebar-card-action").first()).toHaveCSS("opacity", "1");
  await page.keyboard.press("Enter");
  const rename = page.getByRole("dialog", { name: "Rename chat", exact: true });
  await rename.getByRole("textbox", { name: "Chat name" }).fill("Sidebar control check");
  await rename.getByRole("button", { name: "Save", exact: true }).click();
  await expect(selected).toHaveAccessibleName("Sidebar control check");
  await selected.press("Enter");
  await expect(composer).toHaveValue("Second sidebar draft");
  await selected.press("Shift+F10");
  const menu = page.getByRole("menu", { name: "Chat actions", exact: true });
  await expect(menu.getByRole("menuitem")).toHaveText(["Open", "Rename", "Archive"]);
  await menu.press("Escape");
  await expect(selected).toBeFocused();
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  const archive = row.getByRole("button", {
    name: "Archive chat: Sidebar control check",
    exact: true,
  });
  await archive.focus();
  await expect(archive.locator(".sidebar-card-action")).toHaveCSS("box-shadow", "none");
  await expect(archive.locator(".sidebar-card-action")).toHaveCSS("transition-duration", "0s");
  await page.screenshot({ path: test.info().outputPath("project-chat-actions-forced-colors.png") });
  await archive.press("Space");
  await expect(
    project.getByRole("button", { name: "Sidebar control check", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Relay", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  const snapshot = await page.evaluate(() => window.desktop.snapshot());
  expect(
    snapshot.chats.find((chat) => chat.conversationId === id || chat.run?.id === id)?.archived,
  ).toBe(true);
  await page.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
  await page.locator(".sidebar-toggle").click();
  await expect(page.locator("#navigation-sidebar")).toHaveAttribute("inert", "");
  await page.locator(".sidebar-toggle").press("Enter");
  await expect(page.locator("#navigation-sidebar")).toHaveAttribute("aria-hidden", "false");
}

async function checkSidebarSpotlight(page: Page, repo: string, custom: boolean) {
  const relay = page.getByRole("button", { name: "Relay", exact: true, includeHidden: true });
  const relayName = relay.locator(".chat-sidebar-label");
  const project = page.getByRole("region", {
    name: `Project ${repo}`,
    exact: true,
    includeHidden: true,
  });
  const chat = () => page.locator(".orchestration-chat-page:visible");
  const composer = () =>
    chat().getByRole("combobox", { name: "Message to orchestrator", exact: true });
  const send = async (text: string) => {
    await expect(composer()).toBeEditable();
    await composer().fill(text);
    await expect(chat().getByRole("button", { name: "Send", exact: true })).toBeEnabled();
    await composer().press("Enter");
  };
  const hang = JSON.stringify([{ message: "Working until cancelled." }, { hang: "cancellable" }]);
  const ownerCancelGate = join(repo, "..", "spotlight-owner-cancel-release");
  const workerCancelGate = join(repo, "..", "spotlight-worker-cancel-release");
  const gatedHang = (cancelWaitForFile: string) =>
    JSON.stringify([
      { message: "Working until cancelled." },
      { hang: "cancellable", cancelWaitForFile },
    ]);
  await relay.click();
  await expect(relay).toHaveAttribute("aria-current", "true");
  const relayId = (await relay.getAttribute("id"))?.replace(/^conversation-/, "");
  if (!relayId) throw new Error("Missing Relay identity");
  await expect(chat()).toHaveAttribute("data-chat-id", relayId);
  await send(
    `Relay target: ${JSON.stringify({ cwd: repo, workspaceMode: "worktree", label: "Spotlight worker", prompt: gatedHang(workerCancelGate) })}`,
  );
  const worker = page.getByRole("button", { name: /^Spotlight worker \[/, includeHidden: true });
  const workerName = worker.locator(".chat-sidebar-label");
  await expect(workerName).toHaveAttribute("data-working", "true");
  await expect(composer()).toBeEditable();
  // Relay continues monitoring its owned worker after its own turn becomes idle.
  await expect(relayName).toHaveAttribute("data-working", "true");
  await expect(relay).toHaveAttribute("aria-description", /Monitoring subagents/);
  await expect(relay).toHaveAttribute("title", /Monitoring subagents/);
  await send(hang);
  let assistant = project.locator(".chat-sidebar-entry").last();
  if (custom) {
    assistant = page
      .locator("#custom-agent-pages")
      .getByRole("button", { name: "Workflow Agent", exact: true, includeHidden: true });
    await assistant.click();
  } else {
    const chatCount = await project.locator(".chat-sidebar-entry").count();
    await project.getByRole("button", { name: /^New Session in / }).click();
    await expect(project.locator(".chat-sidebar-entry")).toHaveCount(chatCount + 1);
    assistant = project.locator(".chat-sidebar-entry").last();
  }
  const assistantName = assistant.locator(".chat-sidebar-label");
  await expect(assistant).toHaveAttribute("aria-current", "true");
  const assistantId = (await assistant.getAttribute("id"))?.replace(/^conversation-/, "");
  if (!assistantId) throw new Error("Missing assistant identity");
  await expect(chat()).toHaveAttribute("data-chat-id", assistantId);
  await send(gatedHang(ownerCancelGate));
  await expect(assistantName).toHaveAttribute("data-working", "true");
  const names = [relayName, workerName, assistantName];
  for (const name of names) {
    await expect(name).toHaveCSS("animation-name", "activity-spotlight");
    await expect(name).toHaveCSS("animation-duration", "2.8s");
  }
  const activityName = chat().locator(".activity-display .activity-name");
  await expect(activityName).toHaveCSS("animation-name", "activity-spotlight");
  const spotlightStyle = (element: Element) => {
    const style = getComputedStyle(element);
    return [
      style.backgroundImage,
      style.backgroundSize,
      style.backgroundClip,
      style.color,
      style.animationName,
      style.animationDuration,
      style.animationTimingFunction,
      style.animationIterationCount,
    ];
  };
  const reference = await activityName.evaluate(spotlightStyle);
  for (const name of names) expect(await name.evaluate(spotlightStyle)).toEqual(reference);
  await page.screenshot({ path: test.info().outputPath("sidebar-spotlight.png") });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const name of names) await expect(name).toHaveCSS("animation-name", "none");
  await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "active" });
  for (const name of names) {
    await expect(name).toHaveCSS("animation-name", "none");
    await expect(name).not.toHaveCSS("color", "rgba(0, 0, 0, 0)");
  }
  await page.emulateMedia({ forcedColors: "none" });
  await page.locator(".sidebar-toggle").click();
  for (const name of names) await expect(name).toHaveCSS("animation-name", "none");
  await page.locator(".sidebar-toggle").click();
  for (const name of names) await expect(name).toHaveCSS("animation-name", "activity-spotlight");
  // Cancelling one owner never removes another owner's spotlight, even off selection.
  try {
    await chat().getByRole("button", { name: "Stop", exact: true }).click();
    await expect(assistantName).toHaveAttribute("data-working", "false");
    await expect(assistant).toHaveAttribute("aria-description", /Stopping/);
    await expect(assistantName).toHaveCSS("animation-name", "none");
    const cancelling = (await page.evaluate(() => window.desktop.snapshot())).chats.find(
      (entry) => entry.run?.id === assistantId,
    );
    if (!cancelling) throw new Error("Missing cancelling assistant");
    expect(cancelling.activity?.state).toBe("stopping");
    expect(cancelling.run).toMatchObject({ status: "running", stopping: false, cancelling: true });
    await expect(relayName).toHaveCSS("animation-name", "activity-spotlight");
    await expect(workerName).toHaveCSS("animation-name", "activity-spotlight");
  } finally {
    await writeFile(ownerCancelGate, "release\n");
  }
  await relay.click();
  await expect(chat()).toHaveAttribute("data-chat-id", relayId);
  await chat().getByRole("button", { name: "Stop", exact: true }).click();
  await expect(workerName).toHaveCSS("animation-name", "activity-spotlight");
  await worker.click();
  try {
    await page
      .locator(".worker-chat-page:visible")
      .getByRole("button", { name: "Stop", exact: true })
      .click();
    await expect(workerName).toHaveAttribute("data-working", "false");
    await expect(worker).toHaveAttribute("aria-description", /Stopping/);
    const workerId = (await worker.getAttribute("id"))?.replace(/^conversation-/, "");
    const cancelling = (await page.evaluate(() => window.desktop.snapshot())).runs.find(
      ({ record }) => record.id === workerId,
    );
    expect(cancelling?.view).toMatchObject({
      status: "running",
      stopping: false,
      cancelling: true,
    });
  } finally {
    await writeFile(workerCancelGate, "release\n");
  }
  for (const name of names) await expect(name).toHaveCSS("animation-name", "none");
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.desktop.snapshot())).runs.filter(
        (run) => run.view?.status === "running",
      ),
    )
    .toEqual([]);
}

for (const custom of [false, true]) {
  test(
    custom
      ? "workflow: custom assistant through plan, automatic edits, code references and message Undo"
      : "workflow: first use through plan, automatic edits, code references and message Undo",
    async () => {
      const info = test.info();
      test.setTimeout(120_000);
      const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-user-workflow-")));
      const repo = join(directory, "project with spaces");
      const database = join(directory, "projects.sqlite");
      const config = join(directory, "config/code60");
      const processLog = join(directory, "provider-processes");
      await mkdir(repo);
      await mkdir(config, { recursive: true });
      await mkdir(processLog);
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: repo, encoding: "utf8", timeout: 10_000 });
      git("init", "-q", "-b", "main");
      await writeFile(join(repo, "result.txt"), "original\n");
      await writeFile(join(repo, "notes.txt"), "committed notes\n");
      await mkdir(join(repo, "docs"));
      await writeFile(join(repo, "docs/nested.txt"), "nested fixture\n");
      git("add", "result.txt", "notes.txt", "docs/nested.txt");
      commitFixture(repo);
      await writeFile(join(repo, "notes.txt"), "staged notes\n");
      git("add", "notes.txt");
      await writeFile(join(repo, "notes.txt"), "unstaged notes\n");
      const before = {
        head: git("rev-parse", "HEAD"),
        staged: git("diff", "--cached", "--binary"),
        entries: git("ls-files", "--stage", "-z"),
        worktrees: git("worktree", "list", "--porcelain"),
      };
      const index = await readFile(join(repo, ".git/index"));
      const checkCheckout = async (result: string) => {
        expect(await readFile(join(repo, "result.txt"), "utf8")).toBe(result);
        expect(await readFile(join(repo, "notes.txt"), "utf8")).toBe("unstaged notes\n");
        expect(git("show", ":notes.txt")).toBe("staged notes\n");
        expect(git("diff", "--cached", "--binary")).toBe(before.staged);
        expect(git("ls-files", "--stage", "-z")).toBe(before.entries);
        expect(git("rev-parse", "HEAD")).toBe(before.head);
        expect(await readFile(join(repo, ".git/index"))).toEqual(index);
      };
      const processes = async (): Promise<ProcessEvidence[]> =>
        Promise.all(
          (await readdir(processLog)).map(async (file) =>
            JSON.parse(await readFile(join(processLog, file), "utf8")),
          ),
        );
      // Only the external provider executable is configured. No verified setup,
      // database, project selection, controller state, or plan is preseeded.
      await writeFile(
        join(config, "config.json"),
        JSON.stringify({
          agents: {
            claude: {
              command: [
                process.execPath,
                join(root, "test/fixtures/fake-agent.mjs"),
                "--relay",
                "--session-info",
                "--process-log",
                processLog,
              ],
            },
          },
        }),
      );
      await expect(readFile(join(directory, "state/code60/desktop.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      const requestText = `Plan a change in ${repo}\nCreate result.txt containing "human accepted target" followed by a newline. Use an isolated worktree and wait for my approval.`;
      const confirmation = (response: number): NativeDialog => ({
        kind: "message",
        title: "Undo this request?",
        message: "Undo this request?",
        detail: `Rewind to before “${requestText.slice(0, 240)}” and restore this request's changes in:\n${repo}\nYour unsent composer draft will be replaced with the original request.`,
        buttons: ["Cancel", "Confirm"],
        defaultId: 0,
        cancelId: 0,
        response,
      });
      const expected: NativeDialog[] = [
        {
          kind: "save",
          title: "Create database",
          properties: ["createDirectory", "showOverwriteConfirmation"],
        },
        { kind: "open", title: "Open project", properties: ["openDirectory", "createDirectory"] },
        {
          kind: "message",
          title: "Open project?",
          message: "Open this project?",
          detail: repo,
          buttons: ["Cancel", "Open project"],
          defaultId: 0,
          cancelId: 0,
          response: 1,
        },
        confirmation(0),
        confirmation(1),
      ];
      let application: ElectronApplication | undefined;
      const checks: string[] = [];
      try {
        application = await launchDesktop(directory, repo, database);
        await application.evaluate(
          ({ dialog }, { expected, repo, database }) => {
            const state: DialogState = { expected, observed: [], unexpected: [], allowQuit: false };
            (globalThis as typeof globalThis & { workflowDialogs: DialogState }).workflowDialogs =
              state;
            const consume = (kind: NativeDialog["kind"], options: Record<string, unknown>) => {
              const actual: Record<string, unknown> = { kind, ...options };
              state.observed.push(actual);
              if (
                state.allowQuit &&
                actual.message === "Quit Code60?" &&
                JSON.stringify(actual.buttons) === JSON.stringify(["Keep working", "Quit"]) &&
                actual.defaultId === 0 &&
                actual.cancelId === 0
              )
                return 1;
              const next = state.expected.shift();
              if (
                !next ||
                !Object.entries(next).every(
                  ([key, value]) =>
                    key === "response" || JSON.stringify(actual[key]) === JSON.stringify(value),
                )
              ) {
                state.unexpected.push(actual);
                throw new Error("Unexpected native workflow dialog");
              }
              return next.response ?? 0;
            };
            dialog.showSaveDialog = async (...args: unknown[]) => {
              consume("save", args.at(-1) as Record<string, unknown>);
              return { canceled: false, filePath: database };
            };
            dialog.showOpenDialog = async (...args: unknown[]) => {
              consume("open", args.at(-1) as Record<string, unknown>);
              return { canceled: false, filePaths: [repo] };
            };
            dialog.showMessageBox = async (...args: unknown[]) => ({
              response: consume("message", args.at(-1) as Record<string, unknown>),
              checkboxChecked: false,
            });
          },
          { expected, repo, database },
        );
        const dialogs = () =>
          application?.evaluate(
            () =>
              (globalThis as typeof globalThis & { workflowDialogs: DialogState }).workflowDialogs,
          );
        const page = await application.firstWindow();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const wizard = page.locator(".agent-setup-dialog");
        await expect(wizard).toBeVisible();
        await wizard.getByRole("button", { name: "Claude", exact: true }).click();
        await expect(wizard.getByRole("status")).toHaveText("Claude connected");
        const setup = JSON.parse(
          await readFile(join(directory, "state/code60/desktop.json"), "utf8"),
        );
        expect(setup.agentSetup).toMatchObject({ primary: "claude", enabled: ["claude"] });
        await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
        await page.getByRole("button", { name: "Connect to database", exact: true }).click();
        const selectDatabase = page.getByRole("dialog", { name: "Select database", exact: true });
        await selectDatabase.getByRole("button", { name: "Create database…", exact: true }).click();
        await expect(selectDatabase).toHaveCount(0);
        expect((await readFile(database)).subarray(0, 16).toString()).toBe("SQLite format 3\0");
        await page.getByRole("button", { name: "Start", exact: true }).click();
        await page.getByRole("tab", { name: "Projects", exact: true }).click();
        const projectsHome = page.locator("#panel-projects");
        await expect(projectsHome.locator(".table-controls > button")).toHaveCount(0);
        await expect(
          projectsHome.locator(".home-cards > .navigation-card > button").first(),
        ).toHaveAccessibleName("New Project");
        await projectsHome.getByRole("button", { name: "New Project", exact: true }).click();
        const openProject = page.getByRole("dialog", { name: "Open Project", exact: true });
        await openProject.getByRole("button", { name: "Open Folder", exact: true }).click();
        await expect(openProject).toHaveCount(0);
        await expect(
          page.getByRole("region", { name: `Project ${repo}`, exact: true }),
        ).toBeVisible();
        checks.push(
          "Fresh setup, database creation and project opening completed through visible controls.",
        );
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.setSize(1500, 1000),
        );
        await checkSidebarNavigation(page, repo);
        checks.push(
          "Sidebar geometry, footer-matched glyphs, recursive collapse, stable selection colors and non-dimming navigation passed in Light and Dark.",
        );

        if (custom) {
          await page
            .locator("#settings-pages")
            .getByRole("tab", { name: "Text", exact: true })
            .click();
          await page
            .getByRole("group", { name: "Agent Chat Messages", exact: true })
            .getByLabel("Font size")
            .fill("32");
        }

        const allProjectChats = (await page.evaluate(() => window.desktop.snapshot())).chats.filter(
          (chat) => chat.kind === "project",
        );
        const projectChats = allProjectChats.filter((chat) => !chat.archived);
        expect(projectChats.length).toBeGreaterThan(0);
        const providerStarts = (await processes()).length;
        const records = await Promise.all(
          projectChats.map((chat) =>
            readFile(
              join(chat.directory as string, ".code60/runs", chat.run?.id as string, "run.json"),
              "utf8",
            ),
          ),
        );
        for (const item of projectChats) {
          const row = page.locator(`#conversation-${item.run?.id}`);
          await row.click();
          await expect(row).toHaveAttribute("aria-current", "true");
          await row.press("Shift+F10");
          await page
            .getByRole("menu", { name: "Chat actions", exact: true })
            .getByRole("menuitem", { name: "Archive", exact: true })
            .click();
          await expect(row).toHaveCount(0);
        }
        const projectHome = page.locator("#panel-project .home-page:visible");
        await expect(projectHome).toContainText("No conversations");
        const newSession = projectHome.getByRole("button", { name: /^New Session in / });
        await expect(newSession).toContainText("New Session");
        await expect(
          page.locator(".orchestration-chat-page:visible, .worker-chat-page:visible"),
        ).toHaveCount(0);
        const closed = await page.evaluate(() => window.desktop.snapshot());
        expect(closed.chats.filter((chat) => chat.kind === "project")).toHaveLength(
          allProjectChats.length,
        );
        expect(
          closed.chats.filter((chat) => chat.kind === "project").every((chat) => chat.archived),
        ).toBe(true);
        expect((await processes()).length).toBe(providerStarts);
        expect(
          await Promise.all(
            projectChats.map((chat) =>
              readFile(
                join(chat.directory as string, ".code60/runs", chat.run?.id as string, "run.json"),
                "utf8",
              ),
            ),
          ),
        ).toEqual(records);
        await checkCheckout("original\n");
        expect(git("worktree", "list", "--porcelain")).toBe(before.worktrees);
        await newSession.focus();
        await newSession.press("Enter");
        await expect(
          page.locator(".orchestration-chat-page:visible").getByRole("combobox"),
        ).toBeEditable();
        const explicit = await page.evaluate(() => window.desktop.snapshot());
        expect(explicit.chat.projectId).toBe(projectChats[0]?.projectId);
        expect(explicit.chats.filter((chat) => chat.kind === "project")).toHaveLength(
          allProjectChats.length + 1,
        );
        await expect.poll(async () => (await processes()).length).toBe(providerStarts + 1);
        checks.push(
          "Closing the last project chat returned home without provider/session creation or record/Git changes; New Session explicitly created one chat.",
        );

        // Exercise the same production execution path for Relay and a custom owner.
        if (custom) {
          await page.getByRole("tab", { name: "Custom Assistants", exact: true }).click();
          await page.getByRole("button", { name: "New Assistant", exact: true }).click();
          const editor = page.getByRole("dialog", { name: "New Assistant", exact: true });
          await editor.getByLabel("Name", { exact: true }).fill("Workflow Agent");
          await editor
            .getByLabel("Special instructions", { exact: true })
            .fill("Use precise plans and preserve unrelated work.");
          await editor.getByRole("button", { name: "Save", exact: true }).click();
          await page.getByRole("button", { name: "Open Workflow Agent", exact: true }).click();
        } else await page.getByRole("button", { name: "Relay", exact: true }).click();
        await expect(
          page.getByRole("main", { name: custom ? "Agent" : "Relay", exact: true }),
        ).toBeVisible();
        const composer = page
          .locator(".orchestration-chat-page:visible")
          .getByRole("combobox", { name: "Message to orchestrator", exact: true });
        await expect(composer).toBeEditable();
        const modelPicker = page
          .locator(".orchestration-chat-page:visible")
          .getByRole("button", { name: "Model", exact: true });
        await expect(modelPicker).toHaveText("Fixture Model");
        await modelPicker.press("ArrowDown");
        const modelMenu = page.getByRole("menu", { name: "Model settings", exact: true });
        await expect(modelMenu.getByText("Fixture models", { exact: true })).toBeVisible();
        await modelMenu.getByRole("menuitemradio", { name: "Fixture Two", exact: true }).click();
        await expect(modelPicker).toHaveText("Fixture Two");
        // A confirmed option change dismisses an open picker, so reopen only after it settles.
        await expect(modelPicker).toHaveAttribute("aria-disabled", "false");
        await expect(modelMenu).toHaveCount(0);
        await modelPicker.click();
        await expect(
          modelMenu.getByRole("menuitemradio", { name: "Low", exact: true }),
        ).toHaveCount(0);
        await modelMenu.getByRole("menuitemradio", { name: "High", exact: true }).click();
        await expect
          .poll(async () => {
            const run = (await page.evaluate(() => window.desktop.snapshot())).chat.run;
            return run?.modeChanging
              ? "changing"
              : run?.sessionState?.settings?.controls.find((c) => c.id === "effort")?.currentValue;
          })
          .toBe("high");
        await expect(modelPicker).toHaveAttribute("aria-disabled", "false");
        await expect(modelMenu).toHaveCount(0);
        await modelPicker.click();
        await modelMenu
          .getByRole("menuitem", {
            name: "Save as default for new orchestrator sessions",
            exact: true,
          })
          .click();
        await expect
          .poll(
            async () =>
              JSON.parse(await readFile(join(directory, "state/code60/desktop.json"), "utf8"))
                .modelDefaults?.providers.claude?.orchestrator,
          )
          .toEqual([
            { configId: "model", value: "fixture-two", name: "Fixture Two" },
            { configId: "effort", value: "high", name: "High" },
          ]);
        checks.push(
          "Idle model/reasoning changes used grouped connector choices and persisted confirmed orchestrator defaults through the visible picker.",
        );
        await checkSidebarIconSpacing(
          page.locator(".sidebar").getByRole("button", {
            name: custom ? "Workflow Agent" : "Relay",
            exact: true,
          }),
        );
        await expect(page.getByRole("button", { name: "View Plan", exact: true })).toHaveCount(0);
        await composer.fill(requestText);
        await composer.press("Enter");
        const plan = page.getByRole("region", { name: "Plan", exact: true });
        await expect(
          plan.getByRole("heading", { name: "Relay target plan", exact: true }),
        ).toBeVisible();
        const bubble = page
          .locator(".orchestration-chat-page:visible .event.prompt:not(.automatic) pre")
          .last();
        await expect(bubble).toHaveCSS("border-radius", "5px");
        await expect(bubble).toHaveCSS("background-color", "rgb(53, 38, 62)");
        await expect(bubble).toHaveCSS("color", "rgb(247, 247, 242)");
        await expect(plan).toContainText(repo);
        await expect(composer).toBeEditable();
        expect((await page.evaluate(() => window.desktop.snapshot())).runs).toHaveLength(0);
        expect(git("worktree", "list", "--porcelain")).toBe(before.worktrees);
        await checkCheckout("original\n");
        checks.push(
          "Draft plan has no worker, worktree or checkout mutation before human acceptance.",
        );
        const planPanel = page.locator(custom ? '[id^="relay-plan-panel-"]' : "#relay-plan-panel");
        const existingPlans = (await page.evaluate(() => window.desktop.snapshot())).chat.plans;
        const documentText =
          (await plan.getByRole("article", { name: "Plan document" }).textContent()) ?? "";
        await planPanel.getByRole("combobox", { name: "Files view", exact: true }).press("Delete");
        await expect(plan).toHaveCount(0);
        await planPanel.getByRole("button", { name: "Open Memory Recall", exact: true }).click();
        const viewPlan = planPanel.getByRole("button", { name: "View Plan", exact: true });
        await viewPlan.focus();
        await viewPlan.press("Enter");
        await expect(plan.getByRole("article", { name: "Plan document" })).toHaveText(documentText);
        await expect(
          planPanel.getByRole("combobox", { name: "Files view", exact: true }),
        ).toBeFocused();
        await viewPlan.focus();
        await viewPlan.press("Space");
        await expect(
          planPanel.getByRole("combobox", { name: "Files view", exact: true }),
        ).toHaveText("Plan · Relay target plan");
        expect(
          (await fileViewLabels(page)).filter((label) => label === "Plan · Relay target plan"),
        ).toHaveLength(1);
        expect((await page.evaluate(() => window.desktop.snapshot())).chat.plans).toEqual(
          existingPlans,
        );
        expect((await page.evaluate(() => window.desktop.snapshot())).runs).toHaveLength(0);
        expect(git("worktree", "list", "--porcelain")).toBe(before.worktrees);
        await checkCheckout("original\n");
        checks.push(
          "Keyboard View Plan reopened the same closed Relay plan from another tab without generating, accepting or dispatching work.",
        );
        await plan.getByRole("button", { name: "Accept", exact: true }).click();
        await expect
          .poll(
            async () => {
              const snapshot = await page.evaluate(() => window.desktop.snapshot());
              return snapshot.runs.filter((run) => run.relay && run.view?.status === "idle").length;
            },
            { timeout: 30_000 },
          )
          .toBe(1);
        const completed = await page.evaluate(() => window.desktop.snapshot());
        const worker = completed.runs.find((run) => run.relay);
        if (!worker) throw new Error("Accepted plan did not create a worker");
        const workerRow = page.locator(`[id="conversation-${worker.record.id}"]`);
        await expect(workerRow).toBeVisible();
        await expect(workerRow).toHaveAttribute("data-role", "worker");
        await expect(workerRow.locator(".chat-unread")).toHaveCount(0);
        await expect(workerRow).toHaveAttribute("aria-description", /Worker\. Awaiting input/);
        // Parent changes are never inherited by workers without their own saved default.
        expect(worker.view?.sessionState?.model?.id).toBe("fixture-model");
        const parentTabsBeforeWorker = await planPanel.getByRole("tab").evaluateAll((tabs) =>
          tabs.map((tab) => ({
            label: tab.textContent,
            selected: tab.getAttribute("aria-selected"),
          })),
        );
        await page.locator(`[id="conversation-${worker.record.id}"]`).click();
        await expect(page.getByRole("button", { name: "View Plan", exact: true })).toHaveCount(0);
        await checkAgentMessageSpacing(
          application,
          page,
          page.locator(`#chat-${worker.record.id}`),
          "worker",
          custom ? 32 : 14,
        );
        const workerModel = page
          .locator(`#chat-${worker.record.id}`)
          .getByRole("button", { name: "Model", exact: true });
        await expect(workerModel).toHaveText("Fixture Model");
        const workerTabs = page.getByRole("tablist", { name: "File tabs", exact: true });
        await expect(workerTabs.getByRole("tab")).toHaveCount(0);
        await page.getByRole("button", { name: "New file tab", exact: true }).click();
        await page.getByRole("button", { name: "Open Memory Recall", exact: true }).click();
        await expect(
          workerTabs.getByRole("tab", { name: "Memory Recall", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        await workerModel.click();
        await modelMenu.getByRole("menuitemradio", { name: "Fixture Two", exact: true }).click();
        await expect(workerModel).toHaveText("Fixture Two");
        await expect(workerModel).toHaveAttribute("aria-disabled", "false");
        await workerModel.click();
        await modelMenu
          .getByRole("menuitem", { name: "Save as default for new worker sessions", exact: true })
          .click();
        await page.locator("#tab-providers").press("ArrowRight");
        await page.locator("#provider-claude").click();
        const defaults = page.getByRole("group", { name: "Default models", exact: true });
        await expect(defaults).toContainText("Orchestrator");
        await defaults
          .getByRole("button", { name: "Clear claude worker model default", exact: true })
          .click();
        await expect
          .poll(
            async () =>
              JSON.parse(await readFile(join(directory, "state/code60/desktop.json"), "utf8"))
                .modelDefaults?.providers.claude?.worker,
          )
          .toBeUndefined();
        await page.locator(`[id="conversation-${worker.record.id}"]`).click();
        await expect(workerModel).toHaveText("Fixture Two");
        await expect(
          workerTabs.getByRole("tab", { name: "Memory Recall", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        // Cached worker text can show before selection settles; a click meanwhile is ignored.
        await expect(page.locator("#navigation-sidebar")).not.toHaveAttribute("aria-busy", "true");
        await page
          .locator(".sidebar")
          .getByRole("button", { name: custom ? "Workflow Agent" : "Relay", exact: true })
          .click();
        await expect(page.locator("#navigation-sidebar")).not.toHaveAttribute("aria-busy", "true");
        // Worker pages share this class and model text, so prove the parent chat is shown.
        await expect(
          page.getByRole("main", { name: custom ? "Agent" : "Relay", exact: true }),
        ).toBeVisible();
        await expect(modelPicker).toHaveText("Fixture Two");
        expect(
          await planPanel.getByRole("tab").evaluateAll((tabs) =>
            tabs.map((tab) => ({
              label: tab.textContent,
              selected: tab.getAttribute("aria-selected"),
            })),
          ),
        ).toEqual(parentTabsBeforeWorker);
        const parentChat = page.locator(".orchestration-chat-page:visible");
        // Worker completion queues a separate autonomous parent turn. Wait for
        // its known reply and idle UI before capturing either layout sample.
        await expect(
          parentChat.locator(".chat-markdown").filter({ hasText: /^ok$/ }),
        ).toBeVisible();
        await expect(parentChat.getByRole("button", { name: "Send", exact: true })).toBeVisible();
        await checkAgentMessageSpacing(
          application,
          page,
          parentChat,
          custom ? "assistant" : "relay",
          custom ? 32 : 14,
        );
        checks.push(
          "Workers kept independent connector defaults; saving and clearing their role default preserved the live selection and the orchestrator default.",
        );
        await checkSidebarIconSpacing(page.locator(`[id="conversation-${worker.record.id}"]`));
        const worktree = await realpath(worker.record.worktree);
        expect(worktree).not.toBe(repo);
        expect(git("worktree", "list", "--porcelain").replaceAll("\\", "/")).toContain(
          `worktree ${worktree.replaceAll("\\", "/")}`,
        );
        expect(await readFile(join(worktree, "result.txt"), "utf8")).toBe(
          "human accepted target\n",
        );
        const workerProcesses = (await processes()).filter((entry) => entry.cwd === worktree);
        expect(workerProcesses).toHaveLength(1);
        expect(alive(workerProcesses[0]?.pid as number)).toBe(true);
        await expect(async () => {
          expect(await readFile(join(repo, "result.txt"), "utf8")).toBe("human accepted target\n");
        })
          .toPass({ timeout: nativeJournalTimeout })
          .catch(async (error) => {
            await info.attach("integration-failure", {
              body: JSON.stringify(await page.evaluate(() => window.desktop.snapshot()), null, 2),
              contentType: "application/json",
            });
            throw error;
          });
        await checkCheckout("human accepted target\n");
        expect((await dialogs())?.observed).toHaveLength(3);
        checks.push(
          "An accepted isolated worker integrated automatically without another approval, preserving staging and HEAD.",
        );

        // Browsing a project from either table must retain the displayed conversation's plan action.
        const savedPlan = await page.evaluate(() =>
          window.desktop.snapshot().then((s) => s.chat.plans?.at(-1)),
        );
        if (!savedPlan) throw new Error("Missing saved conversation plan");
        const workspaceRoot = (await page.evaluate(() => window.desktop.snapshot())).chat.directory;
        const planRoot = workspaceRoot ? join(workspaceRoot, "..", "documents") : undefined;
        if (!planRoot) throw new Error("Missing conversation storage");
        const savedRecord = await readFile(
          join(planRoot, ".code60/plans", `${savedPlan.id}.json`),
          "utf8",
        );
        for (const source of ["Sessions", "Worktrees"]) {
          const tables = page.locator("#tables-toggle");
          if ((await tables.getAttribute("aria-expanded")) === "false") await tables.click();
          await page.getByRole("tab", { name: source, exact: true }).click();
          const grid = page.locator(`#panel-${source.toLowerCase()} .sessions-grid`);
          await expect(grid.locator('[data-testid^="glide-cell-1-"]').first()).toBeAttached();
          const canvas = grid.getByTestId("data-grid-canvas");
          const box = await canvas.boundingBox();
          if (!box) throw new Error("Missing project table");
          await page.mouse.click(box.x + 70, box.y + 44, { button: "right" });
          await page.getByRole("menuitem", { name: "Browse project files", exact: true }).click();
          const projectPanel = page.locator("#chat-file-panel");
          await expect(projectPanel.getByLabel("File root")).toHaveValue(repo);
          await expect(projectPanel.getByRole("note", { name: "File target" })).toContainText(repo);
          await expect(projectPanel.getByRole("region", { name: "Plan", exact: true })).toHaveCount(
            0,
          );
          const snapshot = await page.evaluate(() => window.desktop.snapshot());
          expect(snapshot.chat.conversationId).toBe(completed.chat.conversationId);
          expect(
            snapshot.chats
              .filter((chat) => chat.kind === "project")
              .flatMap((chat) => chat.plans ?? []),
          ).not.toContainEqual(expect.objectContaining({ id: savedPlan.id }));
          await projectPanel.getByRole("treeitem", { name: "result.txt", exact: true }).click();
          await expect(projectPanel.locator(".view-lines")).toContainText("human accepted target");
          await page.locator(`[id="conversation-${worker.record.id}"]`).click();
          await expect(page.locator(`#chat-${worker.record.id}`)).toBeVisible();
          await page
            .locator(".sidebar")
            .getByRole("button", { name: custom ? "Workflow Agent" : "Relay", exact: true })
            .click();
          await expect(
            projectPanel.getByRole("tab", { name: "result.txt", exact: true }),
          ).toHaveAttribute("aria-selected", "true");
          await expect(projectPanel.locator(".view-lines")).toContainText("human accepted target");
          const openPlan = projectPanel.getByRole("button", { name: "View Plan", exact: true });
          await openPlan.focus();
          await openPlan.press(source === "Sessions" ? "Enter" : "Space");
          await expect(
            plan.getByRole("heading", { name: savedPlan.title, exact: true }),
          ).toBeVisible();
          await expect(projectPanel).toBeHidden();
          expect((await page.evaluate(() => window.desktop.snapshot())).chat.plans?.at(-1)).toEqual(
            savedPlan,
          );
          expect(
            await readFile(join(planRoot, ".code60/plans", `${savedPlan.id}.json`), "utf8"),
          ).toBe(savedRecord);
          await checkCheckout("human accepted target\n");
        }
        checks.push(
          "Sessions and Worktrees project-file browsing retained keyboard access to the displayed Relay/custom plan, with unchanged private record and project ownership.",
        );

        const panel = page.locator(custom ? '[id^="relay-plan-panel-"]' : "#relay-plan-panel");
        const changes = page
          .locator(".orchestration-chat-page:visible")
          .getByRole("button", { name: "1 file changed", exact: true });
        await expect(changes).toHaveCount(1);
        // Native displays can clamp the default window below the panel's
        // 1200px stacked-layout breakpoint, which hides its resize handle.
        await page.setViewportSize({ width: 1600, height: 1000 });
        await changes.click();
        const resize = panel.getByRole("button", { name: "Resize files panel", exact: true });
        for (let step = 0; step < 20; step++) await resize.press("ArrowLeft");
        await expect(panel.locator(".review-panel .review-diff-editor")).toContainText(
          "human accepted target",
        );
        await expect(panel.locator("form, .task-actions")).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Apply changes…", exact: true })).toHaveCount(
          0,
        );
        const draft = "An existing unsent draft.";
        await composer.fill(draft);
        const promptsBeforeAttachment = (
          await page.evaluate(() => window.desktop.snapshot())
        ).chat.events.filter((entry) => entry.event.type === "prompt").length;
        const editor = panel.locator(".modified .inputarea").last();
        await editor.press("Control+Home");
        await editor.press("Shift+End");
        await panel.getByRole("button", { name: "Add to chat", exact: true }).click();
        await expect(composer).toHaveValue(draft);
        await expect(
          page.getByRole("list", { name: "Attached code references", exact: true }),
        ).toContainText("result.txt:1-1 (modified)");
        expect(
          (await page.evaluate(() => window.desktop.snapshot())).chat.events.filter(
            (entry) => entry.event.type === "prompt",
          ),
        ).toHaveLength(promptsBeforeAttachment);
        checks.push(
          "Diff selection attached its exact version, side and lines without replacing or sending the draft.",
        );

        await page.reload();
        await page.setViewportSize({ width: 1600, height: 1000 });
        await page
          .getByRole("button", { name: custom ? "Workflow Agent" : "Relay", exact: true })
          .click();
        await expect(composer).toBeEditable();
        const restored = await page.evaluate(() => window.desktop.snapshot());
        expect(restored.runs.map((run) => run.record.id)).toEqual([worker.record.id]);
        await expect(workerRow.locator(".chat-unread")).toHaveCount(0);
        expect(restored.chat.conversationId).toBe(completed.chat.conversationId);
        await expect(composer).toHaveValue(draft);
        await expect(page.getByRole("list", { name: "Attached code references" })).toContainText(
          "result.txt:1-1 (modified)",
        );
        if ((await panel.getAttribute("aria-hidden")) === "true")
          await page.getByRole("button", { name: "Toggle files panel", exact: true }).click();
        const blank = panel.locator(".file-panel-empty");
        const actions = blank.locator(".file-panel-empty-actions");
        await expect(actions).toBeVisible();
        const blankBox = await blank.boundingBox();
        const actionsBox = await actions.boundingBox();
        if (!blankBox || !actionsBox) throw new Error("Missing blank-tab action bounds");
        expect(
          Math.abs(blankBox.x + blankBox.width / 2 - actionsBox.x - actionsBox.width / 2),
        ).toBeLessThan(2);
        expect(
          Math.abs(blankBox.y + blankBox.height / 2 - actionsBox.y - actionsBox.height / 2),
        ).toBeLessThan(2);
        const choices = await actions.getByRole("button").all();
        expect(choices.length).toBeGreaterThanOrEqual(2);
        let previousBottom: number | undefined;
        for (const choice of choices) {
          const box = await choice.boundingBox();
          if (!box) throw new Error("Missing blank-tab choice bounds");
          expect(Math.abs(box.x - actionsBox.x - 16)).toBeLessThan(2);
          if (previousBottom !== undefined) {
            expect(box.y - previousBottom).toBeGreaterThanOrEqual(0);
            expect(box.y - previousBottom).toBeLessThanOrEqual(12);
          }
          previousBottom = box.y + box.height;
        }
        await changes.click();
        for (let step = 0; step < 20; step++) await resize.press("ArrowLeft");
        await expect(panel.locator(".review-panel .review-diff-editor")).toContainText(
          "human accepted target",
        );
        await checkCheckout("human accepted target\n");
        checks.push(
          "Renderer reload retained the same worker, draft and pinned reference without duplicate dispatch; blank-tab actions stayed centered.",
        );

        const message = page
          .locator(".orchestration-chat-page:visible .event.prompt:not(.automatic)")
          .last();
        await message.hover();
        const undo = message.getByRole("button", { name: "Undo", exact: true });
        await undo.click();
        await expect.poll(async () => (await dialogs())?.observed.length).toBe(4);
        await expect(undo).toBeEnabled();
        await expect(composer).toHaveValue(draft);
        await checkCheckout("human accepted target\n");
        checks.push(
          "Declined Undo preserves the request, existing draft, working changes, staging and HEAD.",
        );
        await undo.click();
        await expect(composer).toHaveValue(requestText, { timeout: nativeJournalTimeout });
        await expect(page.getByRole("list", { name: "Attached code references" })).toHaveCount(0);
        await expect(message).toHaveCount(0);
        await checkCheckout("original\n");
        expect(await readFile(join(worktree, "result.txt"), "utf8")).toBe(
          "human accepted target\n",
        );
        expect(git("worktree", "list", "--porcelain").replaceAll("\\", "/")).toContain(
          `worktree ${worktree.replaceAll("\\", "/")}`,
        );
        expect((await processes()).filter((entry) => entry.cwd === worktree)).toEqual(
          workerProcesses,
        );
        expect(alive(workerProcesses[0]?.pid as number)).toBe(false);
        expect((await page.evaluate(() => window.desktop.snapshot())).runs).toHaveLength(0);
        expect(errors).toEqual([]);
        const native = await dialogs();
        expect(native?.expected).toEqual([]);
        expect(native?.unexpected).toEqual([]);
        expect(native?.observed).toHaveLength(5);
        checks.push(
          "Confirmed message Undo restores code and conversation, returns the unsent request, stops owned workers and preserves private evidence, unrelated edits, index bytes and HEAD.",
        );
        await checkSidebarSpotlight(page, repo, custom);
        await checkCheckout("original\n");
        expect(errors).toEqual([]);
        checks.push(
          "Concurrent Relay, assistant and worker names share the exact chat spotlight; accessibility, hidden navigation and independent cancellation preserve live ownership and checkout bytes.",
        );
        await attachJsonEvidence("workflow-checkpoints", {
          checks,
          native,
          worker: { id: worker.record.id, worktree },
          before,
        });
      } finally {
        // No broad process search/kill. Observe only this app and fixture-owned PIDs.
        const owned = new Set<number>();
        const appPid = application?.process().pid;
        if (appPid) owned.add(appPid);
        try {
          if (application) {
            const metrics = await application.evaluate(({ app }) => {
              const state = (globalThis as typeof globalThis & { workflowDialogs?: DialogState })
                .workflowDialogs;
              if (state) state.allowQuit = true; // Native confirmation boundary only.
              return app.getAppMetrics().map((entry) => entry.pid);
            });
            for (const pid of metrics) owned.add(pid);
          }
          for (const entry of await processes()) owned.add(entry.pid);
        } finally {
          // Still shut down if metrics or process evidence is unreadable/partly written.
          // A failed inspection retains the fixture rather than claiming clean exit.
          if (application) await application.close();
        }
        // Include helpers started between the last checkpoint and shutdown.
        for (const entry of await processes()) owned.add(entry.pid);
        await expect.poll(() => [...owned].filter(alive), { timeout: 10_000 }).toEqual([]);
        await attachJsonEvidence("owned-process-cleanup", {
          pids: [...owned],
          remaining: [],
          checks,
        });
        await removeDesktopFixture(directory, { recursive: true, force: true });
      }
    },
  );
}

test("workflow: reopening restores projects and saved chats on Relay without resuming work", async () => {
  test.setTimeout(120_000);
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-reopen-workflow-")));
  const config = join(directory, "config/code60");
  const processLog = join(directory, "provider-processes");
  const database = join(directory, "projects.sqlite");
  const projects = ["project-a", "project-b", "project-closed"].map((name) =>
    join(directory, name),
  );
  await mkdir(config, { recursive: true });
  await mkdir(processLog);
  const git = (repo: string, ...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8", timeout: 10_000 });
  for (const repo of projects) {
    await mkdir(repo);
    git(repo, "init", "-q", "-b", "main");
    await writeFile(join(repo, "evidence.txt"), "unchanged project\n");
    git(repo, "add", "evidence.txt");
    commitFixture(repo);
  }
  const baseline = await Promise.all(
    projects.map(async (repo) => ({
      repo,
      head: git(repo, "rev-parse", "HEAD"),
      index: await readFile(join(repo, ".git/index")),
      worktrees: git(repo, "worktree", "list", "--porcelain"),
    })),
  );
  await writeFile(
    join(config, "config.json"),
    JSON.stringify({
      agents: {
        claude: {
          command: [
            process.execPath,
            join(root, "test/fixtures/fake-agent.mjs"),
            "--process-log",
            processLog,
          ],
        },
      },
    }),
  );
  const processes = async (): Promise<ProcessEvidence[]> =>
    Promise.all(
      (await readdir(processLog)).map(async (file) =>
        JSON.parse(await readFile(join(processLog, file), "utf8")),
      ),
    );
  let application: ElectronApplication | undefined;
  const owned = new Set<number>();
  const native: Record<string, unknown>[] = [];
  const launch = async () => {
    application = await launchDesktop(directory, projects[0] as string, database);
    const pid = application.process().pid;
    if (pid) owned.add(pid);
    await application.evaluate(({ dialog }) => {
      const messages: Record<string, unknown>[] = [];
      (globalThis as typeof globalThis & { reopenDialogs: typeof messages }).reopenDialogs =
        messages;
      dialog.showMessageBox = async (...args: unknown[]) => {
        const options = args.at(-1) as Record<string, unknown>;
        messages.push(options);
        const message = options.message;
        const quit = message === "Quit Code60?";
        const open = message === "Open this project?";
        if (
          (!quit && !open && message !== "Stop folder?") ||
          options.type !== (open ? "question" : "warning") ||
          options.defaultId !== 0 ||
          options.cancelId !== 0 ||
          JSON.stringify(options.buttons) !==
            JSON.stringify(
              quit
                ? ["Keep working", "Quit"]
                : open
                  ? ["Cancel", "Open project"]
                  : ["Cancel", "Confirm"],
            )
        )
          throw new Error("Unexpected restart-workflow confirmation");
        return { response: 1, checkboxChecked: false };
      };
    });
    return application.firstWindow();
  };
  const nativeMessages = () =>
    application?.evaluate(
      () =>
        (globalThis as typeof globalThis & { reopenDialogs: Record<string, unknown>[] })
          .reopenDialogs,
    );
  try {
    let page = await launch();
    const wizard = page.locator(".agent-setup-dialog");
    // Fresh private state: verify setup through the visible provider connection.
    await page
      .locator(".agent-setup-dialog")
      .getByRole("button", { name: "Claude", exact: true })
      .click();
    await expect(page.locator(".agent-setup-dialog").getByRole("status")).toHaveText(
      "Claude connected",
    );
    await page.getByRole("button", { name: "Close provider setup", exact: true }).click();
    await expect(wizard).toHaveCount(0);
    await page.getByRole("button", { name: "Connect to database", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Select database", exact: true })
      .getByRole("button", { name: "Create database…", exact: true })
      .click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    const chats: { id: string; directory: string; title: string; text: string }[] = [];
    for (const [i, repo] of projects.entries()) {
      // Stub native boundaries only; opening and chat creation use visible controls.
      await application?.evaluate(({ dialog }, repo) => {
        dialog.showOpenDialog = async (...args: unknown[]) => {
          const options = args.at(-1) as Record<string, unknown>;
          if (
            options.title !== "Open project" ||
            JSON.stringify(options.properties) !==
              JSON.stringify(["openDirectory", "createDirectory"])
          )
            throw new Error("Unexpected project picker");
          return { canceled: false, filePaths: [repo] };
        };
      }, repo);
      await page.locator(".sidebar .project-sidebar-open").click();
      await page
        .getByRole("dialog", { name: "Open Project", exact: true })
        .getByRole("button", { name: "Open Folder", exact: true })
        .click();
      const group = page.getByRole("region", { name: `Project ${repo}`, exact: true });
      await expect(group).toBeVisible();
      const owner = (await page.evaluate(() => window.desktop.snapshot())).openProjects?.find(
        (project) => project.path === repo,
      );
      if (!owner) throw new Error("Missing opened project");
      await group.locator(".project-chat-name").click();
      const projectHome = page.locator(
        `#panel-project main[aria-labelledby="project-${owner.id}-title"]`,
      );
      await expect(projectHome).toBeVisible();
      await expect(projectHome.locator(".table-controls > button")).toHaveCount(0);
      const newChat = projectHome.locator(".home-cards > .navigation-card > button").first();
      await expect(newChat).toContainText("New Session");
      await newChat.focus();
      await newChat.press("Enter");
      await expect(group.getByRole("button", { name: "Chat 1", exact: true })).toHaveAttribute(
        "aria-current",
        "true",
      );
      const chat = page.locator(".orchestration-chat-page:visible");
      await expect(await pageCommand(page, "Rename")).toBeVisible();
      const composer = chat.getByRole("combobox", { name: "Message to orchestrator", exact: true });
      const text = `Saved exchange ${i + 1}`;
      await expect(composer).toBeEditable();
      await composer.fill(text);
      await expect(chat.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
      await composer.press("Enter");
      await expect(chat.locator(".event.message .chat-markdown").first()).toHaveText("ok");
      const title = `Saved project ${i + 1}`;
      await (await pageCommand(page, "Rename")).click();
      const rename = page.getByRole("dialog", { name: "Rename chat", exact: true });
      await rename.getByRole("textbox", { name: "Chat name", exact: true }).fill(title);
      await rename.getByRole("button", { name: "Save", exact: true }).click();
      await expect(group.getByRole("button", { name: title, exact: true })).toBeVisible();
      const snapshot = await page.evaluate(() => window.desktop.snapshot());
      chats.push({
        id: snapshot.chat.run?.id as string,
        directory: snapshot.chat.directory as string,
        title,
        text,
      });
      await composer.fill("Unsent draft must not survive quitting");
    }
    const firstGroup = page.getByRole("region", { name: `Project ${projects[0]}`, exact: true });
    await firstGroup.getByRole("button", { name: "New Session in project-a", exact: true }).click();
    await expect(firstGroup.getByRole("button", { name: "Chat 2", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );
    const archivedChat = page.locator(".orchestration-chat-page:visible");
    await expect(await pageCommand(page, "Rename")).toBeVisible();
    await expect(archivedChat.getByRole("combobox")).toBeEditable();
    await (await pageCommand(page, "Rename")).click();
    const rename = page.getByRole("dialog", { name: "Rename chat", exact: true });
    await rename.getByRole("textbox", { name: "Chat name", exact: true }).fill("Hidden saved chat");
    await rename.getByRole("button", { name: "Save", exact: true }).click();
    await firstGroup
      .getByRole("button", { name: "Archive chat: Hidden saved chat", exact: true })
      .click();
    await expect(
      firstGroup.getByRole("button", { name: "Hidden saved chat", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: `Close Project: ${projects[2]}`, exact: true }).click();
    await expect(
      page.getByRole("region", { name: `Project ${projects[2]}`, exact: true }),
    ).toBeVisible();
    const before = await page.evaluate(() => window.desktop.snapshot());
    native.push(...((await nativeMessages()) ?? []));
    expect(native.map((entry) => entry.message)).toEqual([
      "Open this project?",
      "Open this project?",
      "Open this project?",
      "Stop folder?",
    ]);
    expect(native.slice(0, 3).map((entry) => entry.detail)).toEqual(projects);
    expect(native[3]?.detail).toContain(projects[2]);
    const previousPids = new Set((await processes()).map((entry) => entry.pid));
    for (const pid of previousPids) owned.add(pid);
    await application?.close();
    application = undefined;
    for (const entry of await processes()) {
      previousPids.add(entry.pid);
      owned.add(entry.pid);
    }
    await expect.poll(() => [...owned].filter(alive)).toEqual([]);

    // Reproduce retained running history whose recorded owner PID is still alive.
    const historical = chats[0];
    if (!historical) throw new Error("Missing saved project conversation");
    const historicalFile = join(historical.directory, ".code60/runs", historical.id, "run.json");
    const historicalRecord = JSON.parse(await readFile(historicalFile, "utf8"));
    await writeFile(
      historicalFile,
      JSON.stringify({ ...historicalRecord, status: "running", ownerPid: process.pid }),
    );

    page = await launch();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.getByRole("button", { name: "Relay", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(
      page.getByRole("region", { name: `Project ${projects[0]}`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: `Project ${projects[1]}`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: `Project ${projects[2]}`, exact: true }),
    ).toBeVisible();
    const restored = await page.evaluate(() => window.desktop.snapshot());
    expect(restored.chats.find((entry) => entry.run?.id === historical.id)).toMatchObject({
      restored: true,
      run: { status: "running" },
      activity: { state: "idle", active: false },
    });
    for (const saved of chats.slice(0, 2)) {
      const name = page.locator(`[id="conversation-${saved.id}"] .chat-sidebar-label`);
      await expect(name).toHaveAttribute("data-working", "false");
      await expect(name).toHaveCSS("animation-name", "none");
    }
    expect(restored.openProjects?.map((entry) => entry.path)).toEqual(projects);
    expect(
      restored.openProjects?.some((entry) =>
        before.openProjects?.some((old) => old.id === entry.id),
      ),
    ).toBe(false);
    expect(restored.chat.kind).toBe("relay");
    expect(restored.chat.run?.turns).toBe(0);
    expect(restored.chats.find((entry) => entry.title === "Hidden saved chat")?.archived).toBe(
      true,
    );
    expect(
      restored.chats
        .filter((entry) => entry.kind === "project")
        .every((entry) => entry.restored && entry.workers?.length === 0 && entry.updates.paused),
    ).toBe(true);
    for (const saved of chats.slice(0, 2)) {
      await page.locator(`[id="conversation-${saved.id}"]`).click();
      const chat = page.locator(".orchestration-chat-page:visible");
      await expect(chat.locator(".event.prompt:not(.automatic) pre")).toHaveText(saved.text);
      await expect(chat.locator(".event.message .chat-markdown").first()).toHaveText("ok");
      await expect(
        chat.getByRole("combobox", { name: "Message to orchestrator", exact: true }),
      ).toHaveValue("");
      expect((await page.evaluate(() => window.desktop.snapshot())).chat.restored).toBe(true);
    }
    const newProcesses = (await processes()).filter((entry) => !previousPids.has(entry.pid));
    expect(newProcesses.some((entry) => chats.some((saved) => saved.directory === entry.cwd))).toBe(
      false,
    );
    for (const saved of chats) {
      const transcript = await readFile(
        join(saved.directory, ".code60/runs", saved.id, "events.jsonl"),
        "utf8",
      );
      expect(transcript).toContain(saved.text);
    }
    for (const before of baseline) {
      expect(git(before.repo, "rev-parse", "HEAD")).toBe(before.head);
      expect(await readFile(join(before.repo, ".git/index"))).toEqual(before.index);
      expect(git(before.repo, "worktree", "list", "--porcelain")).toBe(before.worktrees);
      expect(await readFile(join(before.repo, "evidence.txt"), "utf8")).toBe("unchanged project\n");
    }
    expect(await nativeMessages()).toEqual([]); // Restore never asks to open or execute again.
    await test.info().attach("reopen-checkpoints", {
      body: JSON.stringify({
        projects: restored.openProjects,
        chats: chats.map(({ id, title }) => ({ id, title })),
        newProcesses,
        native,
      }),
      contentType: "application/json",
    });
  } finally {
    try {
      for (const entry of await processes()) owned.add(entry.pid);
    } finally {
      if (application) await application.close();
    }
    for (const entry of await processes()) owned.add(entry.pid);
    await expect.poll(() => [...owned].filter(alive), { timeout: 10_000 }).toEqual([]);
    await removeDesktopFixture(directory, { recursive: true, force: true });
  }
});

test("workflow: custom assistants without a database, instruction edits, archive, restore and restart", async () => {
  test.setTimeout(90_000);
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-custom-ui-")));
  const config = join(directory, "config/code60");
  await mkdir(config, { recursive: true });
  await writeFile(
    join(config, "config.json"),
    JSON.stringify({
      agents: {
        claude: { command: [process.execPath, join(root, "test/fixtures/fake-agent.mjs")] },
      },
    }),
  );
  let application: ElectronApplication | undefined;
  try {
    application = await launchDesktop(directory, directory, join(directory, "unused.sqlite"));
    let page = await application.firstWindow();
    const wizard = page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Claude", exact: true }).click();
    await expect(wizard.getByRole("status")).toHaveText("Claude connected");
    await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    for (const name of ["Reviewer", "Writer"]) {
      await page.getByRole("tab", { name: "Home", exact: true }).click();
      const home = page.locator("#panel-home");
      const customAgents = home.getByRole("button", {
        name: "Open Custom Assistants",
        exact: true,
      });
      await expect(customAgents).toBeEnabled();
      await expect(home.locator(".home-card")).toHaveText([
        "Relay",
        "Custom Assistants",
        "Search",
        "Projects",
        "Apps",
        "Sessions",
      ]);
      await customAgents.click();
      await expect(page.locator("#panel-custom-agents")).toBeVisible();
      await page.getByRole("button", { name: "New Assistant", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "New Assistant", exact: true });
      await editor.getByLabel("Name", { exact: true }).fill(name);
      await editor.getByLabel("Special instructions", { exact: true }).fill(`Act as ${name}.`);
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect(editor).toHaveCount(0);
      await expect(
        page.locator("#custom-agent-pages").getByRole("button", { name, exact: true }),
      ).toBeVisible();
      await checkSidebarIconSpacing(
        page.locator("#custom-agent-pages").getByRole("button", { name, exact: true }),
      );
    }
    const cardMenu = async (name: string, keyboard = false) => {
      const trigger = page.getByRole("button", { name: `More actions for ${name}`, exact: true });
      if (keyboard) {
        await trigger.focus();
        await trigger.press("Enter");
      } else await trigger.click();
      const menu = page.getByRole("menu", { name: `Actions for ${name}`, exact: true });
      await expect(menu).toBeVisible();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      return menu;
    };
    await expect(page.locator(".custom-agent-actions")).toHaveCount(0);
    for (const theme of ["light", "dark"]) {
      await page.locator("#tab-apps").click();
      await page.locator("#tab-settings-appearance").click();
      await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption(theme);
      await page.getByRole("tab", { name: "Custom Assistants", exact: true }).click();
      const menu = await cardMenu("Reviewer", true);
      await expect(menu.getByRole("menuitem")).toHaveText(["Edit", "Archive"]);
      await expect(menu.getByRole("menuitem", { name: "Edit", exact: true })).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(menu.getByRole("menuitem", { name: "Archive", exact: true })).toBeFocused();
      await page.screenshot({ path: test.info().outputPath(`custom-card-menu-${theme}.png`) });
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "More actions for Reviewer", exact: true }),
      ).toBeFocused();
    }
    await cardMenu("Writer");
    await page.locator("#tab-home").click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.getByRole("tab", { name: "Custom Assistants", exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.locator("#tab-settings-text").click();
    await page
      .getByRole("group", { name: "Card Titles", exact: true })
      .getByLabel("Font size")
      .fill("32");
    await page.getByRole("tab", { name: "Custom Assistants", exact: true }).click();
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setMinimumSize(640, 480);
      window?.setSize(640, 800);
    });
    await page.locator(".sidebar-toggle").click();
    for (const forcedColors of ["none", "active"] as const) {
      await page.emulateMedia({ reducedMotion: "reduce", forcedColors });
      const menu = await cardMenu("Reviewer");
      const box = await menu.boundingBox();
      if (!box) throw new Error("Missing custom assistant menu bounds");
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(640);
      await page.screenshot({
        path: test.info().outputPath(`custom-card-menu-narrow-${forcedColors}.png`),
      });
      await page.keyboard.press("Escape");
    }
    await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "none" });
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(1280, 860),
    );
    await page.locator(".sidebar-toggle").click();
    const beforeOpen = await page.evaluate(() => window.desktop.snapshot());
    expect(beforeOpen.database).toBeNull();
    expect(beforeOpen.chats.filter((chat) => chat.customAgentId)).toHaveLength(0);
    await page.getByRole("button", { name: "Open Reviewer", exact: true }).click();
    await expect(page.getByRole("main", { name: "Agent", exact: true })).toBeVisible();
    const composer = page
      .locator(".orchestration-chat-page:visible")
      .getByRole("combobox", { name: "Message to orchestrator", exact: true });
    await expect(composer).toBeEditable();
    await checkSidebarIconSpacing(
      page.locator("#custom-agent-pages").getByRole("button", { name: "Reviewer", exact: true }),
    );
    await composer.fill("Reviewer unsent draft");
    await page.getByRole("tab", { name: "Custom Assistants", exact: true }).click();
    await page.getByRole("button", { name: "Open Writer", exact: true }).click();
    await expect(page.getByRole("main", { name: "Agent", exact: true })).toBeVisible();
    await expect(composer).toHaveValue("");
    await checkSidebarIconSpacing(
      page.locator("#custom-agent-pages").getByRole("button", { name: "Writer", exact: true }),
    );
    await composer.fill("Writer unsent draft");
    await page
      .locator("#custom-agent-pages")
      .getByRole("button", { name: "Reviewer", exact: true })
      .click();
    await expect(composer).toHaveValue("Reviewer unsent draft");
    await page
      .locator("#custom-agent-pages")
      .getByRole("button", { name: "Writer", exact: true })
      .click();
    await expect(composer).toHaveValue("Writer unsent draft");
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    await expect(composer).toHaveValue("");
    await composer.fill("Relay unsent draft");
    await page
      .locator("#custom-agent-pages")
      .getByRole("button", { name: "Reviewer", exact: true })
      .click();
    await expect(composer).toHaveValue("Reviewer unsent draft");
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    await expect(composer).toHaveValue("Relay unsent draft");
    await page
      .locator("#custom-agent-pages")
      .getByRole("button", { name: "Reviewer", exact: true })
      .click();
    await expect(composer).toHaveValue("Reviewer unsent draft");
    const reviewer = await page.evaluate(() => window.desktop.snapshot());
    const reviewerId = reviewer.chat.customAgentId;
    if (!reviewerId) throw new Error("Missing custom owner");
    const statePath = join(directory, "state/code60/custom-agents", reviewerId, "state.json");
    const saved = await readFile(statePath);
    await page.getByRole("tab", { name: "Custom Assistants", exact: true }).click();
    await (await cardMenu("Reviewer", true))
      .getByRole("menuitem", { name: "Edit", exact: true })
      .click();
    const edit = page.getByRole("dialog", { name: "Edit Assistant", exact: true });
    await expect(edit.getByLabel("Special instructions", { exact: true })).toHaveValue(
      "Act as Reviewer.",
    );
    await edit.getByLabel("Special instructions", { exact: true }).fill("Review carefully.");
    await edit.getByRole("button", { name: "Save", exact: true }).click();
    await expect(edit).toHaveCount(0);
    // Only native confirmation is stubbed. First decline, then confirm.
    await application.evaluate(({ dialog }) => {
      const answers = [0, 1];
      dialog.showMessageBox = async () => ({
        response: answers.shift() ?? 1,
        checkboxChecked: false,
      });
    });
    await (await cardMenu("Reviewer"))
      .getByRole("menuitem", { name: "Archive", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "More actions for Reviewer", exact: true }),
    ).toBeEnabled();
    expect(
      (await page.evaluate(() => window.desktop.snapshot())).customAgents?.find(
        (a) => a.id === reviewerId,
      )?.archived,
    ).toBe(false);
    await (await cardMenu("Reviewer"))
      .getByRole("menuitem", { name: "Archive", exact: true })
      .click();
    await expect(
      page.locator("#custom-agent-pages").getByRole("button", { name: "Reviewer", exact: true }),
    ).toHaveCount(0);
    expect(await readFile(statePath)).toEqual(saved);
    await (await pageCommand(page, "Archived")).click();
    await (await cardMenu("Reviewer"))
      .getByRole("menuitem", { name: "Restore", exact: true })
      .click();
    await (await pageCommand(page, "Active assistants")).click();
    await expect(
      page.locator("#custom-agent-pages").getByRole("button", { name: "Reviewer", exact: true }),
    ).toBeVisible();
    expect(
      (await page.evaluate(() => window.desktop.snapshot())).chats.filter((c) => c.customAgentId),
    ).toHaveLength(1);
    await application.close();
    application = await launchDesktop(directory, directory, join(directory, "unused.sqlite"));
    page = await application.firstWindow();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("tab", { name: "Custom Assistants", exact: true }).click();
    const restarted = await page.evaluate(() => window.desktop.snapshot());
    expect(restarted.customAgents).toHaveLength(2);
    expect(restarted.chats.filter((c) => c.customAgentId)).toHaveLength(0);
    expect(restarted.runs).toHaveLength(0);
    expect(restarted.database).toBeNull();
    expect(await readFile(statePath)).toEqual(saved);
    // Fault injection into an unopened fixture owner, not an application repair.
    await writeFile(statePath, "{bad");
    await page.getByRole("button", { name: "Open Reviewer", exact: true }).click();
    await expect(page.locator(".sidebar").getByRole("alert")).not.toHaveText("");
    await expect(page.locator("#panel-custom-agents")).toBeVisible();
    const recoveryEntry = page
      .locator("#custom-agent-pages")
      .getByRole("button", { name: "Reviewer", exact: true });
    await expect(recoveryEntry).toBeEnabled();
    expect(
      (await page.evaluate(() => window.desktop.snapshot())).chat.customAgentId,
    ).toBeUndefined();
    expect(await readFile(statePath, "utf8")).toBe("{bad");
    // Restore only synthetic evidence, then retry using the same visible entry.
    await writeFile(statePath, saved);
    await recoveryEntry.click();
    await expect(page.getByRole("main", { name: "Agent", exact: true })).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Message to orchestrator", exact: true }),
    ).toBeEditable();
    expect((await page.evaluate(() => window.desktop.snapshot())).chat.run?.turns).toBe(0);
  } finally {
    if (application) await application.close();
    await removeDesktopFixture(directory, { recursive: true, force: true });
  }
});

test("workflow: review live Relay and worker permissions with auto-approval off", async () => {
  test.setTimeout(90_000);
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-permissions-")));
  const config = join(directory, "config/code60");
  const target = join(directory, "worker-target");
  await mkdir(config, { recursive: true });
  await mkdir(target);
  await writeFile(
    join(config, "config.json"),
    JSON.stringify({
      agents: {
        claude: {
          command: [process.execPath, join(root, "test/fixtures/fake-agent.mjs"), "--relay"],
        },
      },
    }),
  );
  let application: ElectronApplication | undefined;
  try {
    application = await launchDesktop(directory, target, join(directory, "unused.sqlite"));
    const page = await application.firstWindow();
    const wizard = page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Claude", exact: true }).click();
    await expect(wizard.getByRole("status")).toHaveText("Claude connected");
    await wizard.getByRole("button", { name: "Close provider setup" }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    const relay = page.getByRole("button", { name: "Relay", exact: true });
    await relay.click();
    const chat = page.locator(".orchestration-chat-page:visible");
    const toggle = chat.getByRole("button", { name: "Code60 auto-approval", exact: true });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(directory, "state/code60/desktop.json"), "utf8"))
            .orchestrationAutoApproval,
      )
      .toBe(false);
    const send = async (text: string) => {
      const composer = chat.getByRole("combobox", { name: "Message to orchestrator" });
      await composer.fill(text);
      await chat.getByRole("button", { name: "Send", exact: true }).click();
    };
    const permission = (id: string) => ({ permission: { id, title: id, kind: "read" } });
    await send(JSON.stringify([permission("relay-read")]));
    const review = chat.getByRole("region", { name: "Pending approvals" });
    await expect(review).toContainText("relay-read");
    await page.locator("#tab-providers").click();
    await page.locator(".app-footer").getByRole("button", { name: "1 approvals waiting" }).click();
    await expect(review).toContainText("relay-read");
    await review.getByRole("button", { name: "Deny" }).click();
    await expect(chat.locator(".event.message").last()).toContainText("opt-reject_once");
    await send(
      `Relay target: ${JSON.stringify({
        cwd: target,
        workspaceMode: "direct",
        label: "Approval worker",
        prompt: JSON.stringify([
          permission("worker-read"),
          permission("next-read"),
          { write: { path: "done.txt", content: "done" } },
        ]),
      })}`,
    );
    const workerTab = page.locator(".sidebar").getByRole("button", { name: /^Approval worker/ });
    await workerTab.click();
    const worker = page.locator(".worker-chat-page:visible");
    await expect(worker.getByRole("region", { name: "Pending approvals" })).toContainText(
      "worker-read",
    );
    const workerToggle = worker.getByRole("button", { name: "Code60 auto-approval", exact: true });
    await expect(workerToggle).toHaveAttribute("aria-pressed", "false");
    await workerToggle.click();
    await expect(workerToggle).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(directory, "state/code60/desktop.json"), "utf8"))
            .orchestrationAutoApproval,
      )
      .toBe(true);
    await expect(readFile(join(target, "done.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    await worker.getByRole("button", { name: "Allow once" }).click();
    await expect
      .poll(() => readFile(join(target, "done.txt"), "utf8").catch(() => ""))
      .toBe("done");
    await expect(worker).toContainText("permission next-read: opt-allow_once");
  } finally {
    await application?.close();
    await removeDesktopFixture(directory, { recursive: true, force: true });
  }
});

test("workflow: completed project plans reopen latest after restart with narrow enlarged text", async () => {
  test.setTimeout(120_000);
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-project-plans-")));
  const repo = join(directory, "repo");
  const database = join(directory, "projects.sqlite");
  const config = join(directory, "config/code60");
  const processLog = join(directory, "processes");
  await mkdir(repo);
  await mkdir(config, { recursive: true });
  await mkdir(processLog);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8", timeout: 10_000 });
  git("init", "-q", "-b", "main");
  await writeFile(join(repo, "result.txt"), "original\n");
  await writeFile(join(repo, "notes.txt"), "unrelated\n");
  git("add", ".");
  commitFixture(repo);
  await writeFile(join(repo, "notes.txt"), "staged\n");
  git("add", "notes.txt");
  await writeFile(join(repo, "notes.txt"), "unstaged\n");
  const before = {
    head: git("rev-parse", "HEAD"),
    index: await readFile(join(repo, ".git/index")),
    staged: git("diff", "--cached", "--binary"),
    worktrees: git("worktree", "list", "--porcelain"),
  };
  await writeFile(
    join(config, "config.json"),
    JSON.stringify({
      agents: {
        claude: {
          command: [
            process.execPath,
            join(root, "test/fixtures/fake-agent.mjs"),
            "--plan",
            "--process-log",
            processLog,
          ],
        },
      },
    }),
  );
  const processes = async (): Promise<ProcessEvidence[]> =>
    Promise.all(
      (await readdir(processLog)).map(async (file) =>
        JSON.parse(await readFile(join(processLog, file), "utf8")),
      ),
    );
  const owned = new Set<number>();
  let application: ElectronApplication | undefined;
  const close = async () => {
    if (!application) return;
    const pid = application.process().pid;
    if (pid) owned.add(pid);
    for (const child of await application.evaluate(({ app }) =>
      app.getAppMetrics().map((entry) => entry.pid),
    ))
      owned.add(child);
    for (const entry of await processes()) owned.add(entry.pid);
    await application.close();
    application = undefined;
    for (const entry of await processes()) owned.add(entry.pid);
    await expect.poll(() => [...owned].filter(alive), { timeout: 10_000 }).toEqual([]);
  };
  try {
    await expect(readFile(join(directory, "state/code60/desktop.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    application = await launchDesktop(directory, repo, database);
    await application.evaluate(
      ({ dialog }, { repo, database }) => {
        const requests: Record<string, unknown>[] = [];
        (globalThis as typeof globalThis & { planDialogs: typeof requests }).planDialogs = requests;
        dialog.showSaveDialog = async (...args: unknown[]) => {
          requests.push({ kind: "save", ...(args.at(-1) as Record<string, unknown>) });
          return { canceled: false, filePath: database };
        };
        dialog.showOpenDialog = async (...args: unknown[]) => {
          requests.push({ kind: "open", ...(args.at(-1) as Record<string, unknown>) });
          return { canceled: false, filePaths: [repo] };
        };
        dialog.showMessageBox = async (...args: unknown[]) => {
          requests.push({ kind: "message", ...(args.at(-1) as Record<string, unknown>) });
          return { response: 1, checkboxChecked: false };
        };
      },
      { repo, database },
    );
    let page = await application.firstWindow();
    const wizard = page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Claude", exact: true }).click();
    await expect(wizard.getByRole("status")).toHaveText("Claude connected");
    await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
    await page.getByRole("button", { name: "Connect to database", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Select database", exact: true })
      .getByRole("button", { name: "Create database…", exact: true })
      .click();
    expect((await readFile(database)).subarray(0, 16).toString()).toBe("SQLite format 3\0");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("tab", { name: "Projects", exact: true }).click();
    await page
      .locator("#panel-projects")
      .getByRole("button", { name: "New Project", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Open Project", exact: true })
      .getByRole("button", { name: "Open Folder", exact: true })
      .click();
    await expect(page.getByRole("dialog", { name: "Open Project", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: `Project ${repo}`, exact: true })).toBeVisible();
    const native = await application.evaluate(
      () =>
        (globalThis as typeof globalThis & { planDialogs: Record<string, unknown>[] }).planDialogs,
    );
    expect(native).toEqual([
      expect.objectContaining({
        kind: "save",
        title: "Create database",
        properties: ["createDirectory", "showOverwriteConfirmation"],
      }),
      expect.objectContaining({
        kind: "open",
        title: "Open project",
        properties: ["openDirectory", "createDirectory"],
      }),
      expect.objectContaining({
        kind: "message",
        title: "Open project?",
        message: "Open this project?",
        detail: repo,
        buttons: ["Cancel", "Open project"],
        defaultId: 0,
        cancelId: 0,
      }),
    ]);
    await page
      .getByRole("region", { name: `Project ${repo}`, exact: true })
      .getByRole("button", { name: /^New Session in / })
      .click();
    await expect(
      page
        .locator(".orchestration-chat-page:visible")
        .getByRole("combobox", { name: "Message to orchestrator", exact: true }),
    ).toBeEditable();
    const chatId = (await page.evaluate(() => window.desktop.snapshot())).chat.run?.id;
    if (!chatId) throw new Error("Missing project conversation");
    const chat = page.locator(".orchestration-chat-page:visible");
    const composer = chat.getByRole("combobox", { name: "Message to orchestrator", exact: true });
    const plan = page.getByRole("region", { name: "Plan", exact: true });
    await expect(page.getByRole("button", { name: "View Plan", exact: true })).toHaveCount(0);
    for (const [index, request] of ["Plan a change", "Plan a second change"].entries()) {
      await expect(chat.getByRole("button", { name: "Send", exact: true })).toBeVisible();
      await composer.fill(request);
      await composer.press("Enter");
      await expect(
        plan.getByRole("heading", {
          name: index ? "Second planned change" : "Planned change",
          exact: true,
        }),
      ).toBeVisible();
      expect((await page.evaluate(() => window.desktop.snapshot())).runs).toHaveLength(index);
      if (!index) {
        expect(git("worktree", "list", "--porcelain")).toBe(before.worktrees);
        expect(await readFile(join(repo, "result.txt"), "utf8")).toBe("original\n");
      }
      await plan.getByRole("button", { name: "Accept", exact: true }).click();
      await expect(plan.getByText("2 out of 2", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => readFile(join(repo, "result.txt"), "utf8")).toBe("planned result\n");
    }
    const completed = (await page.evaluate(() => window.desktop.snapshot())).chat;
    expect(completed.plans).toHaveLength(2);
    const latest = completed.plans?.at(-1);
    if (!latest || !completed.directory) throw new Error("Missing latest completed plan");
    const recordPath = join(completed.directory, ".code60/plans", `${latest.id}.json`);
    const record = await readFile(recordPath, "utf8");
    const markdown = await readFile(join(completed.directory, "plans", `${latest.id}.md`), "utf8");
    expect(JSON.parse(record)).toMatchObject({
      creationOrder: 2,
      acceptedRevision: 1,
      state: "completed",
    });
    const worktrees = git("worktree", "list", "--porcelain");
    const panel = page.locator("#chat-file-panel");
    const geometry = [];
    await page.setViewportSize({ width: 1600, height: 1000 });
    for (const size of [14, 32, 64]) {
      await page.locator("#settings-pages").getByRole("tab", { name: "Text", exact: true }).click();
      await page
        .getByRole("group", { name: "Button Text", exact: true })
        .getByLabel("Font size")
        .fill(String(size));
      await page.locator(`[id="conversation-${chatId}"]`).click();
      const resize = panel.getByRole("button", { name: "Resize files panel", exact: true });
      const handle = await resize.boundingBox();
      const panelBox = await panel.boundingBox();
      if (!handle || !panelBox) throw new Error("Missing panel resize geometry");
      await page.mouse.move(handle.x + handle.width / 2, handle.y + 40);
      await page.mouse.down();
      await page.mouse.move(panelBox.x + panelBox.width - 120, handle.y + 40);
      await page.mouse.up();
      await resize.press("ArrowRight");
      await expect
        .poll(() => panel.evaluate((element) => Math.round(element.getBoundingClientRect().width)))
        .toBe(120);
      await panel.getByRole("combobox", { name: "Files view", exact: true }).press("Delete");
      const view = panel.getByRole("button", { name: "View Plan", exact: true });
      await expect(view).toHaveCSS("font-size", `${size}px`);
      const bounds = await view.evaluate((button) => {
        const range = document.createRange();
        range.selectNodeContents(button);
        const text = [...range.getClientRects()].map((r) => ({ x: r.x, right: r.right }));
        const pane = button.closest(".file-panel")?.getBoundingClientRect();
        const box = button.getBoundingClientRect();
        return {
          panelWidth: pane?.width,
          panelRight: pane?.right,
          x: box.x,
          right: box.right,
          height: box.height,
          scrollWidth: button.scrollWidth,
          clientWidth: button.clientWidth,
          text,
        };
      });
      expect(bounds.panelWidth).toBeCloseTo(120, 0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.panelRight ?? 0);
      expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
      for (const rect of bounds.text) {
        expect(rect.x).toBeGreaterThanOrEqual(bounds.x);
        expect(rect.right).toBeLessThanOrEqual(bounds.right);
      }
      geometry.push({ size, ...bounds });
      await view.focus();
      await view.press(size === 32 ? "Space" : "Enter");
      await expect(
        plan.getByRole("heading", { name: "Second planned change", exact: true }),
      ).toBeVisible();
      expect(await readFile(recordPath, "utf8")).toBe(record);
      if (size === 64)
        await page.screenshot({ path: test.info().outputPath("view-plan-120px-64px.png") });
    }
    await page.locator("#settings-pages").getByRole("tab", { name: "Text", exact: true }).click();
    await page
      .getByRole("group", { name: "Button Text", exact: true })
      .getByLabel("Font size")
      .fill("14");
    await page.locator(`[id="conversation-${chatId}"]`).click();
    await panel.getByRole("combobox", { name: "Files view", exact: true }).press("Delete");
    const previousPids = new Set((await processes()).map((entry) => entry.pid));
    const workerDirectories = (await page.evaluate(() => window.desktop.snapshot())).runs.map(
      (run) => run.record.worktree,
    );
    await close();
    // Rewrite older synthetic files last; their modification time cannot decide latest.
    const first = completed.plans?.[0];
    if (!first) throw new Error("Missing first plan");
    const oldPath = join(completed.directory, ".code60/plans", `${first.id}.json`);
    await writeFile(oldPath, await readFile(oldPath));
    application = await launchDesktop(directory, repo, database);
    page = await application.firstWindow();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.locator(`[id="conversation-${chatId}"]`).click();
    const toggle = page.getByRole("button", { name: "Toggle files panel", exact: true });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    const reopen = page
      .locator("#chat-file-panel")
      .getByRole("button", { name: "View Plan", exact: true });
    await reopen.focus();
    await reopen.press("Space");
    await expect(
      page
        .getByRole("region", { name: "Plan", exact: true })
        .getByRole("heading", { name: "Second planned change", exact: true }),
    ).toBeVisible();
    const restored = (await page.evaluate(() => window.desktop.snapshot())).chat;
    expect(restored.plans).toEqual(completed.plans);
    expect(restored.restored).toBe(true);
    expect(JSON.parse(await readFile(recordPath, "utf8"))).toEqual(JSON.parse(record));
    const newProcesses = (await processes()).filter((entry) => !previousPids.has(entry.pid));
    expect(newProcesses.some((entry) => workerDirectories.includes(entry.cwd))).toBe(false);
    expect(await readFile(join(completed.directory, "plans", `${latest.id}.md`), "utf8")).toBe(
      markdown,
    );
    expect(git("worktree", "list", "--porcelain")).toBe(worktrees);
    expect(git("rev-parse", "HEAD")).toBe(before.head);
    expect(git("diff", "--cached", "--binary")).toBe(before.staged);
    expect(await readFile(join(repo, ".git/index"))).toEqual(before.index);
    expect(await readFile(join(repo, "notes.txt"), "utf8")).toBe("unstaged\n");
    await attachJsonEvidence("project-plan-reopen-evidence", {
      geometry,
      native,
      newProcesses,
      plans: restored.plans,
      record: JSON.parse(record),
      worktrees,
      head: before.head,
    });
  } finally {
    await close();
    await attachJsonEvidence("project-plan-process-cleanup", { pids: [...owned], remaining: [] });
    await removeDesktopFixture(directory, { recursive: true, force: true });
  }
});

test("workflow: seventeen retained assistant file panels release inactive views and isolate same paths", async () => {
  test.setTimeout(180_000);
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-panel-capacity-")));
  const config = join(directory, "config/code60");
  const processLog = join(directory, "processes");
  await mkdir(config, { recursive: true });
  await mkdir(processLog);
  await writeFile(
    join(config, "config.json"),
    JSON.stringify({
      agents: {
        claude: {
          command: [
            process.execPath,
            join(root, "test/fixtures/fake-agent.mjs"),
            "--process-log",
            processLog,
          ],
        },
      },
    }),
  );
  let application: ElectronApplication | undefined;
  const pids = new Set<number>();
  const evidence: { conversationId: string; directory: string; content: string }[] = [];
  try {
    application = await launchDesktop(directory, directory, join(directory, "unused.sqlite"));
    const page = await application.firstWindow();
    const wizard = page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Claude", exact: true }).click();
    await expect(wizard.getByRole("status")).toHaveText("Claude connected");
    await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    const panel = page.locator(".project-file-panel-scope:not([hidden]) .file-panel");
    for (let index = 0; index < 17; index++) {
      const name = `Panel ${index + 1}`;
      await page.locator("#tab-home").click();
      await page.getByRole("button", { name: "Open Custom Assistants", exact: true }).click();
      await page.getByRole("button", { name: "New Assistant", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "New Assistant", exact: true });
      await editor.getByLabel("Name", { exact: true }).fill(name);
      await editor
        .getByLabel("Special instructions", { exact: true })
        .fill(`Fixture ${index + 1}.`);
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect(editor).toHaveCount(0);
      await page.getByRole("button", { name: `Open ${name}`, exact: true }).click();
      await expect(
        page.locator(".orchestration-chat-page:visible").getByRole("combobox"),
      ).toBeEditable();
      const snapshot = await page.evaluate(() => window.desktop.snapshot());
      const cwd = snapshot.chat.directory;
      const conversationId = snapshot.chat.conversationId;
      if (!cwd || !conversationId) throw new Error("Missing assistant workspace");
      const content = `owned panel ${index + 1}`;
      await writeFile(join(cwd, "same.txt"), content);
      evidence.push({ conversationId, directory: cwd, content });
      const toggle = page.getByRole("button", { name: "Toggle files panel", exact: true });
      if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      await panel.getByRole("button", { name: "Open Files", exact: true }).click();
      await panel.getByRole("treeitem", { name: "same.txt", exact: true }).click();
      await expect(panel.locator(".view-lines")).toContainText(content);
      await expect(
        page.getByRole("alert").filter({ hasText: "Too many Relay file views" }),
      ).toHaveCount(0);
      if (!index) {
        await panel.getByRole("tab", { name: "same.txt", exact: true }).press("Alt+ArrowLeft");
        await expect(panel.getByRole("tab")).toHaveText(["same.txt", "File Explorer"]);
      }
    }
    await page
      .locator("#custom-agent-pages")
      .getByRole("button", { name: "Panel 1", exact: true })
      .click();
    await expect(panel.getByRole("tab")).toHaveText(["same.txt", "File Explorer"]);
    await expect(panel.getByRole("tab", { name: "same.txt", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(panel.locator(".view-lines")).toContainText("owned panel 1");
    for (const entry of evidence)
      expect(await readFile(join(entry.directory, "same.txt"), "utf8")).toBe(entry.content);
    expect(new Set(evidence.map((entry) => entry.directory)).size).toBe(17);
    expect((await page.evaluate(() => window.desktop.snapshot())).runs).toHaveLength(0);
    expect((await page.evaluate(() => window.desktop.snapshot())).database).toBeNull();
    await attachJsonEvidence("seventeen-panels", evidence);
    await page.screenshot({ path: test.info().outputPath("seventeen-panels.png") });
  } finally {
    if (application) {
      if (application.process().pid) pids.add(application.process().pid as number);
      for (const pid of await application.evaluate(({ app }) =>
        app.getAppMetrics().map((metric) => metric.pid),
      ))
        pids.add(pid);
      for (const file of await readdir(processLog))
        pids.add(JSON.parse(await readFile(join(processLog, file), "utf8")).pid);
      await application.close();
      await expect.poll(() => [...pids].filter(alive), { timeout: 10_000 }).toEqual([]);
    }
    await removeDesktopFixture(directory, { recursive: true, force: true });
  }
});

test("workflow: session review arrivals preserve closed tabs and archived evidence stays reachable", async () => {
  test.setTimeout(90_000);
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-review-panels-")));
  const repo = join(directory, "repo"),
    database = join(directory, "projects.sqlite");
  const config = join(directory, "config/code60"),
    processLog = join(directory, "processes");
  await mkdir(repo);
  await mkdir(config, { recursive: true });
  await mkdir(processLog);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8", timeout: 10_000 });
  git("init", "-q", "-b", "main");
  await writeFile(join(repo, "task.txt"), "original\n");
  git("add", ".");
  commitFixture(repo);
  const head = git("rev-parse", "HEAD"),
    index = await readFile(join(repo, ".git/index"));
  await writeFile(
    join(config, "config.json"),
    JSON.stringify({
      agents: {
        claude: {
          command: [
            process.execPath,
            join(root, "test/fixtures/fake-agent.mjs"),
            "--review",
            "--process-log",
            processLog,
          ],
        },
      },
    }),
  );
  let application: ElectronApplication | undefined;
  const pids = new Set<number>();
  try {
    application = await launchDesktop(directory, repo, database);
    await application.evaluate(
      ({ dialog }, { repo, database }) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: database });
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [repo] });
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      },
      { repo, database },
    );
    const page = await application.firstWindow();
    const wizard = page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Claude", exact: true }).click();
    await expect(wizard.getByRole("status")).toHaveText("Claude connected");
    await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
    await page.getByRole("button", { name: "Connect to database", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Select database", exact: true })
      .getByRole("button", { name: "Create database…", exact: true })
      .click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    const relayId = (await page.evaluate(() => window.desktop.snapshot())).chat.run?.id;
    await page.getByRole("button", { name: "Add Project", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Open Project", exact: true })
      .getByRole("button", { name: "Open Folder", exact: true })
      .click();
    const group = page.getByRole("region", { name: `Project ${repo}`, exact: true });
    const create = group.getByRole("button", { name: /^New Session in / });
    const composer = page
      .locator(".orchestration-chat-page:visible")
      .getByRole("combobox", { name: "Message to orchestrator", exact: true });
    const panel = page.locator("#chat-file-panel");
    const send = async (request: string, reviewCount: number) => {
      await expect(composer).toBeVisible();
      await expect(composer).toBeEditable();
      await composer.fill(request);
      await composer.press("Enter");
      await expect
        .poll(async () => (await page.evaluate(() => window.desktop.snapshot())).reviews?.length, {
          timeout: 20_000,
        })
        .toBe(reviewCount)
        .catch(async (cause) => {
          await attachJsonEvidence(
            "review-arrival-failure",
            await page.evaluate(() => window.desktop.snapshot()),
          );
          throw cause;
        });
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.desktop.snapshot())).runs.filter(
              (run) => run.view?.status === "idle",
            ).length,
        )
        .toBe(reviewCount);
    };
    await create.click();
    await expect
      .poll(async () => (await page.evaluate(() => window.desktop.snapshot())).chat.kind)
      .toBe("project");
    await expect(
      group.locator('.chat-sidebar-entry[data-role="orchestrator"]').last(),
    ).toHaveAttribute("aria-current", "true");
    const a = (await page.evaluate(() => window.desktop.snapshot())).chat.run?.id;
    if (!a) throw new Error("Missing chat A");
    await expect(page.locator(`.orchestration-chat-page[data-chat-id="${a}"]`)).toBeVisible();
    await send("Implement task loop", 1);
    await create.click();
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.desktop.snapshot())).chats.filter(
            (chat) => chat.kind === "project",
          ).length,
      )
      .toBe(2);
    await expect(
      group.locator('.chat-sidebar-entry[data-role="orchestrator"]').last(),
    ).toHaveAttribute("aria-current", "true");
    const b = (await page.evaluate(() => window.desktop.snapshot())).chat.run?.id;
    if (!b) throw new Error("Missing chat B");
    await expect(page.locator(`.orchestration-chat-page[data-chat-id="${b}"]`)).toBeVisible();
    await send("Implement task loop", 2);
    const toggle = page.getByRole("button", { name: "Toggle files panel", exact: true });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await panel.getByRole("tab", { name: "Changes", exact: true }).press("Delete");
    await panel.getByRole("button", { name: "Open Files", exact: true }).click();
    await panel.getByRole("treeitem", { name: "task.txt", exact: true }).click();
    const savedTabs = await panel
      .getByRole("tab")
      .evaluateAll((tabs) =>
        tabs.map((tab) => ({ text: tab.textContent, selected: tab.getAttribute("aria-selected") })),
      );
    await group.locator(`[id="conversation-${a}"]`).click();
    await expect(page.locator(`.orchestration-chat-page[data-chat-id="${a}"]`)).toBeVisible();
    await expect
      .poll(async () => (await page.evaluate(() => window.desktop.snapshot())).chat.run?.id)
      .toBe(a);
    await send("Implement second task loop", 3);
    await group.locator(`[id="conversation-${b}"]`).click();
    await expect(page.locator(`.orchestration-chat-page[data-chat-id="${b}"]`)).toBeVisible();
    await expect
      .poll(() =>
        panel.getByRole("tab").evaluateAll((tabs) =>
          tabs.map((tab) => ({
            text: tab.textContent,
            selected: tab.getAttribute("aria-selected"),
          })),
        ),
      )
      .toEqual(savedTabs);
    await expect(panel.getByRole("tab", { name: "Changes", exact: true })).toHaveCount(0);
    const archive = async (id: string) => {
      await group.locator(`[id="conversation-${id}"]`).click({ button: "right" });
      await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
      await expect(group.locator(`[id="conversation-${id}"]`)).toHaveCount(0);
    };
    await archive(a);
    const openReview = async () => {
      const apps = page.locator("#apps-card-toggle");
      if ((await apps.getAttribute("aria-expanded")) === "false") await apps.click();
      const tables = page.locator("#tables-toggle");
      if ((await tables.getAttribute("aria-expanded")) === "false") await tables.click();
      await page.getByRole("tab", { name: "Sessions", exact: true }).click();
      const canvas = page.locator("#panel-sessions").getByTestId("data-grid-canvas");
      const box = await canvas.boundingBox();
      if (!box) throw new Error("Missing sessions grid");
      await page.mouse.click(box.x + 70, box.y + 44, { button: "right" });
      await page.getByRole("menuitem", { name: "Review changes", exact: true }).click();
      await expect(
        panel.locator(".review-panel .modified .view-lines:not([monaco-view-zone])"),
      ).toContainText("accepted task result");
      const snapshot = await page.evaluate(() => window.desktop.snapshot());
      expect(snapshot.chats.find((chat) => chat.run?.id === a)?.archived).toBe(true);
      expect(snapshot.chats.filter((chat) => chat.kind === "project")).toHaveLength(2);
      expect(git("rev-parse", "HEAD")).toBe(head);
      expect(await readFile(join(repo, ".git/index"))).toEqual(index);
      expect(await readFile(join(repo, "second.txt"), "utf8")).toBe("accepted task result\n");
    };
    await openReview();
    expect((await page.evaluate(() => window.desktop.snapshot())).chat.run?.id).toBe(b);
    await archive(b);
    await expect(page.locator("#panel-project")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Chat archived." })).toBeVisible();
    await openReview();
    const archived = await page.evaluate(() => window.desktop.snapshot());
    expect(archived.chat.kind).toBe("relay");
    expect(archived.chat.run?.id).toBe(relayId);
    expect(archived.chats.filter((chat) => chat.kind === "project" && !chat.archived)).toEqual([]);
    await attachJsonEvidence("archived-review-panels", {
      head,
      indexUnchanged: true,
      a,
      b,
      savedTabs,
      worktrees: git("worktree", "list", "--porcelain"),
    });
    // Supporting integration segment: delay only the read-only snapshot IPC
    // response. All navigation still uses production UI, bridge and controllers.
    await create.click();
    await expect(
      group.locator('.chat-sidebar-entry[data-role="orchestrator"]').last(),
    ).toHaveAttribute("aria-current", "true");
    const captured = await page.evaluate(() => window.desktop.snapshot());
    await application.evaluate(({ ipcMain }, captured) => {
      const gate = { requested: false, release: undefined as (() => void) | undefined };
      Object.assign(globalThis, { panelSnapshotGate: gate });
      ipcMain.removeHandler("desktop:snapshot");
      ipcMain.handle(
        "desktop:snapshot",
        () =>
          new Promise((resolve) => {
            gate.requested = true;
            gate.release = () => resolve(captured);
          }),
      );
    }, captured);
    await page.getByRole("tab", { name: "Sessions", exact: true }).click();
    const canvas = page.locator("#panel-sessions").getByTestId("data-grid-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Missing sessions grid");
    await page.mouse.click(box.x + 70, box.y + 44, { button: "right" });
    await page.getByRole("menuitem", { name: "Browse project files", exact: true }).click();
    await expect
      .poll(() =>
        application?.evaluate(
          () =>
            (globalThis as unknown as { panelSnapshotGate: { requested: boolean } })
              .panelSnapshotGate.requested,
        ),
      )
      .toBe(true);
    await page.locator(".sidebar").getByRole("button", { name: "Relay", exact: true }).click();
    await page.locator("#tab-home").click();
    await expect(page.locator("#panel-home")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "return to splash page", exact: true }),
    ).toBeDisabled();
    await application.evaluate(() =>
      (
        globalThis as unknown as { panelSnapshotGate: { release?: () => void } }
      ).panelSnapshotGate.release?.(),
    );
    // Wait for the command's finally block, not an arbitrary timeout.
    await expect(
      page.getByRole("button", { name: "return to splash page", exact: true }),
    ).toBeEnabled();
    await expect(page.locator("#panel-home")).toBeVisible();
    await expect(page.locator("#panel-chat")).toBeHidden();
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(await readFile(join(repo, ".git/index"))).toEqual(index);
    await attachJsonEvidence("delayed-browse-navigation", {
      released: true,
      destination: "Home",
      gitUnchanged: true,
    });
  } finally {
    if (application) {
      if (application.process().pid) pids.add(application.process().pid as number);
      for (const file of await readdir(processLog))
        pids.add(JSON.parse(await readFile(join(processLog, file), "utf8")).pid);
      await application.close();
      await expect.poll(() => [...pids].filter(alive), { timeout: 10_000 }).toEqual([]);
    }
    await removeDesktopFixture(directory, { recursive: true, force: true });
  }
});
