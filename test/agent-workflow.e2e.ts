import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type ElectronApplication, expect, type Locator, type Page, test } from "@playwright/test";
import { launchDesktop, removeDesktopFixture } from "./electron-launcher.js";
import { commitFixture } from "./fixtures/git-repository.js";

const root = resolve(import.meta.dirname, "..");
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

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
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
  await expect(header.getByRole("navigation", { name: "Breadcrumb", exact: true })).toHaveCount(1);
  await expect(header.getByRole("heading")).toHaveCount(1);
  await expect(header.getByRole("heading")).toHaveCSS("font-size", "16px");
  await expect(header.getByRole("heading")).toHaveCSS("font-weight", "300");
  const slot = page.locator(".page-title-placeholder");
  await expect(slot).toHaveCount(1);
  await expect(slot).toHaveAttribute("aria-hidden", "true");
  await expect(slot).toHaveAttribute("inert", "");
  await expect(slot).toHaveCSS("visibility", "hidden");
  await expect(slot).toHaveCSS("font-size", "64px");
  await expect(slot.locator("button, h1, h2, [id]")).toHaveCount(0);
  const geometry = await slot.evaluate((element) => {
    const header = document.querySelector(".workspace-header");
    const heading = header?.querySelector("h1, h2");
    if (!header || !heading) throw new Error("Missing header heading");
    return {
      slot: element.getBoundingClientRect().top,
      header: header.getBoundingClientRect().bottom,
      ids: heading.id ? document.querySelectorAll(`#${CSS.escape(heading.id)}`).length : null,
    };
  });
  expect(geometry.slot).toBeGreaterThanOrEqual(geometry.header);
  if (geometry.ids !== null) expect(geometry.ids).toBe(1);
}

async function checkSidebarNavigation(page: Page, repo: string) {
  const project = page.getByRole("region", { name: `Project ${repo}`, exact: true });
  const newChat = project.getByRole("button", { name: /^New chat in / });
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

  for (const theme of ["light", "dark"]) {
    await page.locator("#tab-settings").click();
    await page.locator("#tab-settings-appearance").click();
    await page.getByRole("combobox", { name: "Theme", exact: true }).selectOption(theme);
    await checkHeaderBreadcrumbs(page);
    const gray = theme === "light" ? "rgb(243, 243, 243)" : "rgb(48, 48, 48)";
    await expect(page.locator(".sidebar")).toHaveCSS("border-width", "0px");
    await expect(page.locator(".sidebar")).toHaveCSS(
      "background-color",
      theme === "light" ? "rgb(255, 255, 255)" : "rgb(37, 37, 37)",
    );
    await expect(page.locator("body")).toHaveCSS("font-weight", "300");
    await page.locator("#tab-home").scrollIntoViewIfNeeded();
    await page.mouse.move(1000, 500);
    const geometry = await page.evaluate(() => {
      const toggle = document.querySelector(".sidebar-toggle");
      const home = document.querySelector("#tab-home .navigation-icon");
      const strip = document.querySelector(".app > .window-drag-strip");
      const footer = document.querySelectorAll(".footer-sidebar > .icon-button");
      if (!toggle || !home || !strip || footer.length !== 2)
        throw new Error("Missing sidebar controls");
      const style = (element: Element) => ({
        color: getComputedStyle(element).color,
        opacity: getComputedStyle(element).opacity,
        glyphOpacity: getComputedStyle(element.querySelector("svg") ?? element).opacity,
      });
      const a = toggle.getBoundingClientRect();
      const b = home.getBoundingClientRect();
      const nativeRow = strip.getBoundingClientRect();
      return {
        above: a.bottom <= b.top,
        nativeClearance: a.left >= 80,
        centered: Math.abs((a.top + a.bottom - nativeRow.top - nativeRow.bottom) / 2) < 1,
        styles: [toggle, ...footer].map(style),
      };
    });
    expect(geometry.above).toBe(true);
    expect(geometry.nativeClearance).toBe(true);
    expect(geometry.centered).toBe(true);
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
      await expect(composer).toHaveValue("Second sidebar draft");
      await checkHeaderBreadcrumbs(page);
      await expect(page.locator(".workspace-breadcrumbs .chat-title")).toBeVisible();
      await expect(page.locator(".workspace-breadcrumbs .chat-title")).toHaveCSS(
        "text-decoration-line",
        "underline",
      );
      await expect(page.locator(".sidebar .chat-sidebar-status")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "New session", exact: true })).toHaveCount(0);
      const box = composer.locator("..");
      await page.locator(".sidebar-toggle").focus();
      await expect(box).toHaveCSS("border-width", "0px");
      await expect(box).toHaveCSS("background-color", gray);
      const bounds = await box.boundingBox();
      await composer.focus();
      await expect(box).toHaveCSS(
        "background-color",
        theme === "light" ? "rgb(233, 233, 233)" : "rgb(56, 56, 56)",
      );
      expect(await box.boundingBox()).toEqual(bounds);
      await project.locator(".project-chat-name").press("ArrowLeft");
      await expect(project.locator(".project-chat-name")).toHaveAttribute("aria-expanded", "false");
      await page.locator("#tab-chat").press("ArrowLeft");
      await page.getByRole("button", { name: "Relay", exact: true }).click();
      await expect(page.locator(".relay-sidebar .chat-sidebar-entry")).toHaveAttribute(
        "aria-current",
        "true",
      );
      await expect(page.locator("#tab-chat")).toHaveAttribute("aria-expanded", "false");
      await page.locator("#tab-chat").press("ArrowRight");
      await expect(project.locator(".project-chat-name")).toHaveAttribute("aria-expanded", "false");
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
    await page.locator("#tab-settings").press("ArrowRight");
    await page.locator("#advanced-toggle").press("ArrowRight");
    await page.locator("#experiments-toggle").press("ArrowRight");
    await page.locator("#tab-settings").press("ArrowLeft");
    for (const id of ["settings-pages", "advanced-pages", "experiment-pages"])
      await expect(page.locator(`#${id}`)).toHaveAttribute("inert", "");
    await page.locator("#tab-settings").press("ArrowRight");
    for (const id of ["advanced-toggle", "experiments-toggle"])
      await expect(page.locator(`#${id}`)).toHaveAttribute("aria-expanded", "false");
    await page.locator("#tab-apps").press("ArrowRight");
    await page.locator("#tables-toggle").press("ArrowRight");
    await page.locator("#tab-apps").press("ArrowLeft");
    await expect(page.locator("#tables-toggle")).toHaveAttribute("aria-expanded", "false");
    await page.locator("#tab-apps").press("ArrowRight");
    await expect(page.locator("#table-pages")).toHaveAttribute("inert", "");
    await page.screenshot({ path: test.info().outputPath(`sidebar-navigation-${theme}.png`) });
    await project.locator(".project-chat-name").press("ArrowRight");
  }
  await page.locator(".sidebar-toggle").click();
  await expect(page.locator("#navigation-sidebar")).toHaveAttribute("inert", "");
  await page.locator(".sidebar-toggle").press("Enter");
  await expect(page.locator("#navigation-sidebar")).toHaveAttribute("aria-hidden", "false");
}

for (const custom of [false, true]) {
  test(
    custom
      ? "workflow: custom agent through plan, automatic edits, code references and message Undo"
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
      git("add", "result.txt", "notes.txt");
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
        await wizard.getByRole("button", { name: "Close agent setup", exact: true }).click();
        await page.getByRole("button", { name: "Connect to database", exact: true }).click();
        const selectDatabase = page.getByRole("dialog", { name: "Select database", exact: true });
        await selectDatabase.getByRole("button", { name: "Create database…", exact: true }).click();
        await expect(selectDatabase).toHaveCount(0);
        expect((await readFile(database)).subarray(0, 16).toString()).toBe("SQLite format 3\0");
        await page.getByRole("button", { name: "Start", exact: true }).click();
        await page.getByRole("tab", { name: "Projects", exact: true }).click();
        const projectsHome = page.locator("#panel-projects");
        await expect(projectsHome.locator(".table-controls > button")).toHaveCount(0);
        await expect(projectsHome.locator(".home-cards > button").first()).toHaveAccessibleName(
          "New Project",
        );
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
        await checkSidebarNavigation(page, repo);
        checks.push(
          "Sidebar geometry, footer-matched glyphs, recursive collapse, stable selection colors and non-dimming navigation passed in Light and Dark.",
        );

        // Exercise the same production execution path for Relay and a custom owner.
        if (custom) {
          await page.getByRole("tab", { name: "Custom Agents", exact: true }).click();
          await page.getByRole("button", { name: "New Agent", exact: true }).click();
          const editor = page.getByRole("dialog", { name: "New Agent", exact: true });
          await editor.getByLabel("Name", { exact: true }).fill("Workflow Agent");
          await editor
            .getByLabel("Special instructions", { exact: true })
            .fill("Use precise plans and preserve unrelated work.");
          await editor.getByRole("button", { name: "Save", exact: true }).click();
          await page.getByRole("button", { name: "Open Workflow Agent", exact: true }).click();
        } else await page.getByRole("button", { name: "Relay", exact: true }).click();
        await expect(
          page.getByRole("main", { name: custom ? "Workflow Agent" : "Relay", exact: true }),
        ).toBeVisible();
        const composer = page
          .locator(".orchestration-chat-page:visible")
          .getByRole("combobox", { name: "Message to orchestrator", exact: true });
        await expect(composer).toBeEditable();
        await checkSidebarIconSpacing(
          page.locator(".sidebar").getByRole("button", {
            name: custom ? "Workflow Agent" : "Relay",
            exact: true,
          }),
        );
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
        await expect(bubble).toHaveCSS("background-color", "rgb(27, 58, 92)");
        await expect(bubble).toHaveCSS("color", "rgb(255, 255, 255)");
        await expect(plan).toContainText(repo);
        await expect(composer).toBeEditable();
        expect((await page.evaluate(() => window.desktop.snapshot())).runs).toHaveLength(0);
        expect(git("worktree", "list", "--porcelain")).toBe(before.worktrees);
        await checkCheckout("original\n");
        checks.push(
          "Draft plan has no worker, worktree or checkout mutation before human acceptance.",
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
        await expect
          .poll(() => readFile(join(repo, "result.txt"), "utf8"))
          .toBe("human accepted target\n");
        await checkCheckout("human accepted target\n");
        expect((await dialogs())?.observed).toHaveLength(3);
        checks.push(
          "An accepted isolated worker integrated automatically without another approval, preserving staging and HEAD.",
        );

        const panel = page.locator(custom ? '[id^="relay-plan-panel-"]' : "#relay-plan-panel");
        const changes = page
          .locator(".orchestration-chat-page:visible")
          .getByRole("button", { name: "1 file changed", exact: true });
        await expect(changes).toHaveCount(1);
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
        await expect(composer).toHaveValue(requestText);
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
        await info.attach("workflow-checkpoints", {
          body: JSON.stringify(
            { checks, native, worker: { id: worker.record.id, worktree }, before },
            null,
            2,
          ),
          contentType: "application/json",
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
        await info.attach("owned-process-cleanup", {
          body: JSON.stringify({ pids: [...owned], remaining: [], checks }),
          contentType: "application/json",
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
          (!quit && !open && message !== "Close project?") ||
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
    await page.getByRole("button", { name: "Close agent setup", exact: true }).click();
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
      const newChat = projectHome.locator(".home-cards > button").first();
      await expect(newChat).toContainText("New Chat");
      await newChat.focus();
      await newChat.press("Enter");
      await expect(group.getByRole("button", { name: "Chat 1", exact: true })).toHaveAttribute(
        "aria-current",
        "true",
      );
      const chat = page.locator(".orchestration-chat-page:visible");
      await expect(
        page
          .locator(".workspace-breadcrumbs")
          .getByRole("button", { name: "Rename chat: Chat 1", exact: true }),
      ).toBeVisible();
      const composer = chat.getByRole("combobox", { name: "Message to orchestrator", exact: true });
      const text = `Saved exchange ${i + 1}`;
      await expect(composer).toBeEditable();
      await composer.fill(text);
      await expect(chat.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
      await composer.press("Enter");
      await expect(chat.locator(".event.message .chat-markdown").first()).toHaveText("ok");
      const title = `Saved project ${i + 1}`;
      await page
        .locator(".workspace-breadcrumbs")
        .getByRole("button", { name: /^Rename chat:/ })
        .click();
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
    await firstGroup.getByRole("button", { name: "New chat in project-a", exact: true }).click();
    await expect(firstGroup.getByRole("button", { name: "Chat 2", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );
    const archivedChat = page.locator(".orchestration-chat-page:visible");
    await expect(
      page
        .locator(".workspace-breadcrumbs")
        .getByRole("button", { name: "Rename chat: Chat 2", exact: true }),
    ).toBeVisible();
    await expect(archivedChat.getByRole("combobox")).toBeEditable();
    await page
      .locator(".workspace-breadcrumbs")
      .getByRole("button", { name: /^Rename chat:/ })
      .click();
    const rename = page.getByRole("dialog", { name: "Rename chat", exact: true });
    await rename.getByRole("textbox", { name: "Chat name", exact: true }).fill("Hidden saved chat");
    await rename.getByRole("button", { name: "Save", exact: true }).click();
    await firstGroup
      .getByRole("button", { name: "Actions for Hidden saved chat", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
    await expect(
      firstGroup.getByRole("button", { name: "Hidden saved chat", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: `More for ${projects[2]}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Close project", exact: true }).click();
    await expect(
      page.getByRole("region", { name: `Project ${projects[2]}`, exact: true }),
    ).toHaveCount(0);
    const before = await page.evaluate(() => window.desktop.snapshot());
    native.push(...((await nativeMessages()) ?? []));
    expect(native.map((entry) => entry.message)).toEqual([
      "Open this project?",
      "Open this project?",
      "Open this project?",
      "Close project?",
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
    ).toHaveCount(0);
    const restored = await page.evaluate(() => window.desktop.snapshot());
    expect(restored.openProjects?.map((entry) => entry.path)).toEqual(projects.slice(0, 2));
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

test("workflow: custom agents without a database, instruction edits, archive, restore and restart", async () => {
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
    await wizard.getByRole("button", { name: "Close agent setup", exact: true }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    for (const name of ["Reviewer", "Writer"]) {
      await page.getByRole("tab", { name: "Home", exact: true }).click();
      const home = page.locator("#panel-home");
      const customAgents = home.getByRole("button", { name: "Open Custom Agents", exact: true });
      await expect(customAgents).toBeEnabled();
      await expect(home.locator(".home-card")).toHaveText([
        "Relay",
        "Custom Agents",
        "Search",
        "Projects",
        "Apps",
        "Sessions",
      ]);
      await customAgents.click();
      await expect(page.locator("#panel-custom-agents")).toBeVisible();
      await page.getByRole("button", { name: "New Agent", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "New Agent", exact: true });
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
    const beforeOpen = await page.evaluate(() => window.desktop.snapshot());
    expect(beforeOpen.database).toBeNull();
    expect(beforeOpen.chats.filter((chat) => chat.customAgentId)).toHaveLength(0);
    await page.getByRole("button", { name: "Open Reviewer", exact: true }).click();
    await expect(page.getByRole("main", { name: "Reviewer", exact: true })).toBeVisible();
    const composer = page
      .locator(".orchestration-chat-page:visible")
      .getByRole("combobox", { name: "Message to orchestrator", exact: true });
    await expect(composer).toBeEditable();
    await checkSidebarIconSpacing(
      page.locator("#custom-agent-pages").getByRole("button", { name: "Reviewer", exact: true }),
    );
    await composer.fill("Reviewer unsent draft");
    await page.getByRole("tab", { name: "Custom Agents", exact: true }).click();
    await page.getByRole("button", { name: "Open Writer", exact: true }).click();
    await expect(page.getByRole("main", { name: "Writer", exact: true })).toBeVisible();
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
    await page.getByRole("tab", { name: "Custom Agents", exact: true }).click();
    await page.getByRole("button", { name: "Edit Reviewer", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Edit Agent", exact: true });
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
    await page.getByRole("button", { name: "Archive Reviewer", exact: true }).click();
    await expect(page.getByRole("button", { name: "Archive Reviewer", exact: true })).toBeEnabled();
    expect(
      (await page.evaluate(() => window.desktop.snapshot())).customAgents?.find(
        (a) => a.id === reviewerId,
      )?.archived,
    ).toBe(false);
    await page.getByRole("button", { name: "Archive Reviewer", exact: true }).click();
    await expect(
      page.locator("#custom-agent-pages").getByRole("button", { name: "Reviewer", exact: true }),
    ).toHaveCount(0);
    expect(await readFile(statePath)).toEqual(saved);
    await page.getByRole("button", { name: "Archived", exact: true }).click();
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await page.getByRole("button", { name: "Active agents", exact: true }).click();
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
    await page.getByRole("tab", { name: "Custom Agents", exact: true }).click();
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
    await expect(page.getByRole("main", { name: "Reviewer", exact: true })).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Message to orchestrator", exact: true }),
    ).toBeEditable();
    expect((await page.evaluate(() => window.desktop.snapshot())).chat.run?.turns).toBe(0);
  } finally {
    if (application) await application.close();
    await removeDesktopFixture(directory, { recursive: true, force: true });
  }
});
