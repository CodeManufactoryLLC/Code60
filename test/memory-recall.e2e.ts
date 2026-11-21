import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  type BrowserContext,
  type ElectronApplication,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import type { MemorySource } from "../src/bridge/index.js";
import type { RunEvent } from "../src/core/index.js";
import { MemoryStore } from "../src/desktop/memory-store.js";
import { launchDesktop, removeDesktopFixture } from "./electron-launcher.js";
import { commitFixture } from "./fixtures/git-repository.js";

const root = resolve(import.meta.dirname, "..");
const memoryText = "The cache service is Redis. Run the memory recall worker fixture.";

/** Saved synthetic history only, not setup, controller state or live worker authority. */
function savedMemory(directory: string) {
  const store = new MemoryStore(join(directory, "state/code60/memory"));
  try {
    const owner = store.register("recall-fixture", "Saved memory evidence", null);
    const source: MemorySource = {
      id: randomUUID(),
      conversationId: owner.id,
      role: "human",
      at: new Date().toISOString(),
      ordinal: 0,
      start: 0,
      text: memoryText,
    };
    store.append(owner.id, "saved", [source], true);
    const citations = [
      { sourceId: source.id, start: 0, end: memoryText.length, quote: memoryText },
    ];
    const range = store.range(owner.id);
    store.publish(
      owner.id,
      range.cursor,
      range.boundary,
      {
        goal: "",
        constraints: [],
        decisions: [],
        attempts: [],
        questions: [],
        next: "",
        citations,
        memories: [
          {
            type: "semantic",
            text: memoryText,
            subject: "cache",
            condition: "",
            correction: false,
            citations,
          },
        ],
      },
      "fixture",
    );
    const record = store.browse({}).records[0];
    if (!record) throw new Error("Missing saved fixture memory");
    // Represents an already human-promoted record in the starting state.
    store.action({ type: "promote", id: record.id, revision: record.revision });
    return record.id;
  } finally {
    store.close();
  }
}

function recallIds(events: readonly RunEvent[], runId: string) {
  return events
    .filter(
      (event) =>
        event.runId === runId && event.type === "note" && event.text.startsWith("Memory used ("),
    )
    .map((event) => JSON.parse(event.type === "note" ? (event.detail ?? "[]") : "[]") as string[]);
}
async function openRecall(page: Page, panel: Locator) {
  if (await panel.getByRole("tab", { name: "Memory Recall", exact: true }).count()) {
    await panel.getByRole("tab", { name: "Memory Recall", exact: true }).click();
  } else {
    if (
      (await panel.getByRole("button", { name: "Open Memory Recall", exact: true }).count()) === 0
    )
      await panel.getByRole("button", { name: "New file tab", exact: true }).click();
    await panel.getByRole("button", { name: "Open Memory Recall", exact: true }).click();
  }
  await expect(panel.getByRole("tab", { name: "Memory Recall", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".memory-recall:visible")).toHaveCount(1);
  await expect(page.locator(".memory-recall:visible")).toHaveCSS("scrollbar-gutter", "stable");
}
async function displayedIds(panel: Locator) {
  return panel
    .locator(".memory-recall-record")
    .evaluateAll((records) => records.map((record) => record.getAttribute("data-memory-id")));
}
async function send(page: Page, text: string) {
  const composer = page
    .getByRole("combobox", { name: "Message to orchestrator", exact: true })
    .filter({ visible: true });
  const chat = page.locator(".orchestration-chat-page").filter({ has: composer });
  await expect(composer).toBeVisible();
  await expect(composer).toBeEditable();
  await composer.fill(text);
  await expect(chat.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await composer.press("Enter");
  await expect(chat.locator(".event.prompt").last()).toContainText(text);
  await expect(composer).toBeEditable();
}
async function memoryOff(page: Page) {
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  const settingsToggle = page.locator("#settings-card-toggle");
  if ((await settingsToggle.getAttribute("aria-expanded")) === "false")
    await settingsToggle.click();
  await page.getByRole("tab", { name: "Memory", exact: true }).click();
  const toggle = page
    .locator("#panel-settings-memory")
    .getByRole("switch", { name: "Memory", exact: true });
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
}

for (const kind of ["Relay", "project"] as const) {
  test(`workflow: Memory Recall follows ${kind} chats and workers without new retrieval`, async () => {
    test.setTimeout(180_000);
    const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-recall-workflow-")));
    const target = join(directory, "synthetic-project");
    const database = join(directory, "projects.sqlite");
    const promptLog = join(directory, "provider-prompts");
    const processes = join(directory, "provider-processes");
    let application: ElectronApplication | undefined;
    let context: BrowserContext | undefined;
    let completed = false;
    try {
      await mkdir(target);
      await mkdir(promptLog);
      await mkdir(processes);
      await mkdir(join(directory, "config/code60"), { recursive: true });
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: target });
      await writeFile(join(target, "note.txt"), "unchanged checkout\n");
      execFileSync("git", ["add", "note.txt"], { cwd: target });
      commitFixture(target);
      const memoryId = savedMemory(directory);
      await writeFile(
        join(directory, "config/code60/config.json"),
        JSON.stringify({
          agents: {
            claude: {
              command: [
                process.execPath,
                join(root, "test/fixtures/fake-agent.mjs"),
                "--relay",
                "--plan",
                "--process-log",
                processes,
                "--prompt-log",
                promptLog,
              ],
            },
          },
        }),
      );
      application = await launchDesktop(directory, target, database);
      const page = await application.firstWindow();
      context = page.context();
      await context.tracing.start({ screenshots: true, snapshots: true });
      await page.setViewportSize({ width: 1600, height: 1000 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const wizard = page.locator(".agent-setup-dialog");
      await expect(wizard).toBeVisible();
      await wizard.getByRole("button", { name: "Claude", exact: true }).click();
      await expect(wizard.getByRole("status")).toHaveText("Claude connected");
      await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
      await page.getByRole("button", { name: "Start", exact: true }).click();
      let snapshot = await page.evaluate(() => window.desktop.snapshot());
      expect(snapshot.database).toBeNull();
      if (kind === "project") {
        await page
          .locator(".app-footer")
          .getByRole("button", { name: /database/i })
          .click();
        await page
          .getByRole("dialog", { name: "Select database", exact: true })
          .getByRole("button", { name: "Create database…", exact: true })
          .click();
        await page.locator(".sidebar .project-sidebar-open").click();
        await page
          .getByRole("dialog", { name: "Open Project", exact: true })
          .getByRole("button", { name: "Open Folder", exact: true })
          .click();
        const group = page.getByRole("region", { name: `Project ${target}`, exact: true });
        await group
          .getByRole("button", { name: `New Session in ${basename(target)}`, exact: true })
          .click();
        await expect(group.locator(".chat-sidebar-entry").last()).toHaveAttribute(
          "aria-current",
          "true",
        );
        await expect
          .poll(async () => (await page.evaluate(() => window.desktop.snapshot())).chat.kind)
          .toBe("project");
      }
      await send(page, "The cache service is Redis.");
      snapshot = await page.evaluate(() => window.desktop.snapshot());
      const chatId = snapshot.chat.run?.id;
      if (!chatId) throw new Error("Missing displayed chat");
      const events = snapshot.chat.events.map((entry) => entry.event);
      const recorded = recallIds(events, chatId);
      expect(recorded.flat()).toContain(memoryId);
      // Retrieval never opens the panel or selects a tab.
      const panel =
        kind === "Relay" ? page.locator("#relay-plan-panel") : page.locator("#chat-file-panel");
      if (kind === "Relay") await expect(panel).toHaveAttribute("aria-hidden", "true");
      const beforeRecord = await page.evaluate(
        (id) => window.desktop.memoryDetail({ id }),
        memoryId,
      );
      const runDirectory = snapshot.chat.directory;
      const promptCount = async () => {
        const logs = await Promise.all(
          (await readdir(promptLog)).map(
            async (file) =>
              JSON.parse(await readFile(join(promptLog, file), "utf8")) as Promise<{ cwd: string }>,
          ),
        );
        return logs.filter((log) => log.cwd === runDirectory).length;
      };
      const beforePrompts = await promptCount();
      if ((await panel.getAttribute("aria-hidden")) === "true")
        await page.getByRole("button", { name: "Toggle files panel", exact: true }).click();
      await openRecall(page, panel);
      await expect(panel.locator(".memory-recall-record")).toHaveCount(recorded.flat().length);
      expect(await displayedIds(panel)).toEqual(recorded.flat());
      await expect(panel.locator(".memory-recall")).toContainText(memoryText);
      await expect(panel.locator('.memory-recall-turn[data-current="true"]')).toContainText(
        "Current turn",
      );
      expect(await promptCount()).toBe(beforePrompts);
      const after = await page.evaluate(() => window.desktop.snapshot());
      expect(
        recallIds(
          after.chat.events.map((entry) => entry.event),
          chatId,
        ),
      ).toEqual(recorded);
      expect(
        (await page.evaluate((id) => window.desktop.memoryDetail({ id }), memoryId)).record
          .lastUsedAt,
      ).toBe(beforeRecord.record.lastUsedAt);
      await panel.getByText("Evidence quotes", { exact: true }).click();
      await expect(panel.locator("blockquote")).toContainText(memoryText);

      await panel.getByRole("button", { name: "New file tab", exact: true }).click();
      await panel.getByRole("button", { name: "Open Memory Recall", exact: true }).click();
      await expect(panel.getByRole("tab", { name: "Memory Recall", exact: true })).toHaveCount(1);
      const recallTab = panel.getByRole("tab", { name: "Memory Recall", exact: true });
      await recallTab.press("Alt+ArrowLeft");
      await expect(recallTab).toBeFocused();
      await recallTab.press("Delete");
      await expect(recallTab).toHaveCount(0);
      await openRecall(page, panel);
      await expect(panel.locator(".memory-recall")).toContainText(memoryText);

      if (kind === "Relay") {
        await panel.getByRole("button", { name: "New file tab", exact: true }).click();
        await panel.getByRole("button", { name: "Open Files", exact: true }).click();
        await expect(panel.getByLabel("File root")).toHaveValue("workspace");
        await panel.getByRole("button", { name: "New file tab", exact: true }).click();
        await panel.getByRole("button", { name: "Open Changes", exact: true }).click();
        await expect(panel.getByRole("tab", { name: "Changes", exact: true })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        await openRecall(page, panel);
        await send(
          page,
          `Relay target: ${JSON.stringify({
            cwd: target,
            workspaceMode: "direct",
            label: "Memory recall worker",
            prompt: JSON.stringify([
              { write: { path: "recall-result.txt", content: "The cache service is Redis.\n" } },
              { message: "The cache service is Redis." },
            ]),
          })}`,
        );
      } else {
        await send(page, "Plan a change");
        await expect(
          panel.getByRole("tab", { name: "Plan · Planned change", exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        const plan = panel.getByRole("region", { name: "Plan", exact: true });
        await expect(plan.locator(".plan-state")).toHaveText("Awaiting acceptance");
        expect((await page.evaluate(() => window.desktop.snapshot())).runs).toEqual([]);
        // Inspecting a draft grants no execution authority. Dismiss it before separate work.
        await plan.getByRole("button", { name: "Dismiss", exact: true }).click();
        await expect(plan.locator(".plan-state")).toHaveText("Dismissed");
        await send(page, "Start a memory recall worker");
      }
      // Native Windows worker startup (worktree plus provider spawn) measured 4.4-5.5 s.
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.desktop.snapshot())).runs.find(
              (run) => run.view?.status === "idle",
            )?.record.id,
          { timeout: 15_000 },
        )
        .toBeTruthy();
      snapshot = await page.evaluate(() => window.desktop.snapshot());
      const worker = snapshot.runs.find((run) => run.view?.status === "idle");
      if (!worker) throw new Error("Missing worker");
      await expect
        .poll(async () => readFile(join(worker.record.worktree, "recall-result.txt"), "utf8"))
        .toBe("The cache service is Redis.\n");
      if (kind === "project") {
        expect(worker.record.worktree).not.toBe(target);
        expect(await readFile(join(target, "note.txt"), "utf8")).toBe("unchanged checkout\n");
      } else expect(snapshot.database).toBeNull();
      await page.locator(`[id="conversation-${worker.record.id}"]`).click();
      await expect(page.locator(".worker-chat-page:visible")).toBeVisible();
      if ((await panel.getAttribute("aria-hidden")) === "true")
        await page.getByRole("button", { name: "Toggle files panel", exact: true }).click();
      await openRecall(page, panel);
      snapshot = await page.evaluate(() => window.desktop.snapshot());
      const workerRecalls = recallIds(
        snapshot.events.map((entry) => entry.event),
        worker.record.id,
      ).flat();
      expect(workerRecalls).toContain(memoryId);
      await expect(panel.locator(".memory-recall-record")).toHaveCount(workerRecalls.length);
      expect(await displayedIds(panel)).toEqual(workerRecalls);
      await expect(panel.locator(".memory-recall")).toContainText(memoryText);
      if (kind === "Relay")
        await page.locator(".sidebar").getByRole("button", { name: "Relay", exact: true }).click();
      else await page.locator(`[id="conversation-${chatId}"]`).click();
      await openRecall(page, panel);
      for (let index = 0; index < 6; index++)
        await send(page, `The cache service is Redis. Recall check ${index + 1}.`);
      await memoryOff(page);
      // Return through visible navigation, then dispatch a zero-hit turn with Memory Off.
      if (kind === "Relay") await page.getByRole("button", { name: "Relay", exact: true }).click();
      else await page.locator(`[id="conversation-${chatId}"]`).click();
      await openRecall(page, panel);
      await panel.getByRole("button", { name: "Older turns", exact: true }).click();
      await expect(panel.locator(".memory-recall-badge")).toHaveCount(0);
      await panel.getByRole("button", { name: "Newer turns", exact: true }).click();
      await expect(panel.locator(".memory-recall-badge")).toHaveCount(1);
      await send(page, "No memory recall for this turn.");
      await expect(panel.locator('.memory-recall-turn[data-current="true"]')).toContainText(
        "No memories recalled for this turn.",
      );
      await expect(panel.locator(".memory-recall-badge")).toHaveCount(1);
      const final = await page.evaluate(() => window.desktop.snapshot());
      const finalIds = recallIds(
        final.chat.events.map((entry) => entry.event),
        chatId,
      )
        .reverse()
        .slice(0, 4) // The newest five-turn page includes the current zero-hit turn.
        .flat();
      await expect(panel.locator(".memory-recall-record")).toHaveCount(finalIds.length);
      expect(await displayedIds(panel)).toEqual(finalIds);
      await page.getByRole("tab", { name: "Home", exact: true }).click();
      await expect(panel).toBeHidden();
      if (kind === "Relay") await page.getByRole("button", { name: "Relay", exact: true }).click();
      else await page.locator(`[id="conversation-${chatId}"]`).click();
      await expect(panel.locator('.memory-recall-turn[data-current="true"]')).toContainText(
        "No memories recalled for this turn.",
      );
      expect(errors).toEqual([]);
      await test.info().attach("recorded-recall-ids", {
        body: JSON.stringify({
          kind,
          chatId,
          worker: worker.record.id,
          recorded,
          workerRecalls,
          memoryId,
        }),
        contentType: "application/json",
      });
      completed = true;
    } finally {
      try {
        if (context) {
          if (!completed) {
            const path = test.info().outputPath("electron-trace.zip");
            await context.tracing.stop({ path });
            await test.info().attach("electron-trace", { path, contentType: "application/zip" });
          } else await context.tracing.stop();
        }
      } finally {
        const pids = await Promise.all(
          (await readdir(processes).catch(() => [])).map(
            async (file) =>
              (JSON.parse(await readFile(join(processes, file), "utf8")) as { pid: number }).pid,
          ),
        );
        await application?.close();
        await expect
          .poll(() =>
            pids.filter((pid) => {
              try {
                process.kill(pid, 0);
                return true;
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
                throw error;
              }
            }),
          )
          .toEqual([]);
        await removeDesktopFixture(directory, { recursive: true, force: true });
      }
    }
  });
}
