import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type ElectronApplication, expect, test } from "@playwright/test";
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

test("workflow: first use through plan, review, apply and undo", async () => {
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
  const confirmation = (title: string, response: number): NativeDialog => ({
    kind: "message",
    title,
    message: title,
    detail: `${repo}\n1 file changes. Newer edits are rechecked before writing.`,
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
    { kind: "open", title: "Open project", properties: ["openDirectory"] },
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
    confirmation("Apply reviewed changes?", 0),
    confirmation("Apply reviewed changes?", 1),
    confirmation("Undo reviewed changes?", 1),
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
        () => (globalThis as typeof globalThis & { workflowDialogs: DialogState }).workflowDialogs,
      );
    const page = await application.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const wizard = page.locator(".agent-setup-dialog");
    await expect(wizard).toBeVisible();
    await wizard.getByRole("button", { name: "Claude", exact: true }).click();
    await expect(wizard.getByRole("status")).toHaveText("Claude connected");
    const setup = JSON.parse(await readFile(join(directory, "state/code60/desktop.json"), "utf8"));
    expect(setup.agentSetup).toMatchObject({ primary: "claude", enabled: ["claude"] });
    await wizard.getByRole("button", { name: "Close agent setup", exact: true }).click();
    await page.getByRole("button", { name: "Connect to database", exact: true }).click();
    const selectDatabase = page.getByRole("dialog", { name: "Select database", exact: true });
    await selectDatabase.getByRole("button", { name: "Create database…", exact: true }).click();
    await expect(selectDatabase).toHaveCount(0);
    expect((await readFile(database)).subarray(0, 16).toString()).toBe("SQLite format 3\0");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.locator(".sidebar .project-sidebar-open").click();
    const openProject = page.getByRole("dialog", { name: "Open Project", exact: true });
    await openProject.getByRole("button", { name: "Open Folder", exact: true }).click();
    await expect(openProject).toHaveCount(0);
    await expect(page.getByRole("region", { name: `Project ${repo}`, exact: true })).toBeVisible();
    checks.push(
      "Fresh setup, database creation and project opening completed through visible controls.",
    );

    // Relay owns checkout-local apply/undo; project revision tabs are read-only.
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    const composer = page
      .locator(".orchestration-chat-page:visible")
      .getByRole("combobox", { name: "Message to orchestrator", exact: true });
    await expect(composer).toBeEditable();
    await composer.fill(
      `Plan a change in ${repo}\nCreate result.txt containing "human accepted target" followed by a newline. Use an isolated worktree and wait for my approval.`,
    );
    await composer.press("Enter");
    const plan = page.getByRole("region", { name: "Plan", exact: true });
    await expect(
      plan.getByRole("heading", { name: "Relay target plan", exact: true }),
    ).toBeVisible();
    await expect(plan).toContainText(repo);
    await expect(composer).toBeEditable();
    expect((await page.evaluate(() => window.desktop.snapshot())).runs).toHaveLength(0);
    expect(git("worktree", "list", "--porcelain")).toBe(before.worktrees);
    await checkCheckout("original\n");
    checks.push("Draft plan has no worker, worktree or checkout mutation before human acceptance.");
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
    const worktree = await realpath(worker.record.worktree);
    expect(worktree).not.toBe(repo);
    expect(git("worktree", "list", "--porcelain").replaceAll("\\", "/")).toContain(
      `worktree ${worktree.replaceAll("\\", "/")}`,
    );
    expect(await readFile(join(worktree, "result.txt"), "utf8")).toBe("human accepted target\n");
    const workerProcesses = (await processes()).filter((entry) => entry.cwd === worktree);
    expect(workerProcesses).toHaveLength(1);
    expect(alive(workerProcesses[0]?.pid as number)).toBe(true);
    await checkCheckout("original\n");
    checks.push("A real fake-provider subprocess changed only its accepted isolated worktree.");

    await page.reload();
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    await expect(composer).toBeEditable();
    const restored = await page.evaluate(() => window.desktop.snapshot());
    expect(restored.runs.map((run) => run.record.id)).toEqual([worker.record.id]);
    expect(restored.chat.conversationId).toBe(completed.chat.conversationId);
    const panel = page.locator("#relay-plan-panel");
    if ((await panel.getAttribute("aria-hidden")) === "true")
      await page.getByRole("button", { name: "Toggle files panel", exact: true }).click();
    await panel.getByRole("button", { name: "Open Changes", exact: true }).click();
    const changes = panel.getByRole("region", { name: "Relay changes by target" });
    await expect(changes.getByRole("heading", { name: repo, exact: true })).toBeVisible();
    await changes.getByRole("button", { name: / · Current generation$/, exact: false }).click();
    const review = changes.getByRole("region", { name: "Selected Relay review" });
    await review.getByRole("button", { name: "Refresh changes", exact: true }).click();
    await expect(review.getByLabel("Revision", { exact: true })).not.toHaveValue("");
    // Monaco renders only the visible columns. Widen the real panel to read the whole line.
    const resize = panel.getByRole("button", { name: "Resize files panel", exact: true });
    for (let step = 0; step < 20; step++) await resize.press("ArrowLeft");
    await expect(review.locator(".review-panel .review-diff-editor")).toContainText(
      "human accepted target",
    );
    await review.getByRole("checkbox", { name: "Mark file reviewed", exact: true }).check();
    await expect(
      review.getByRole("checkbox", { name: "Mark file reviewed", exact: true }),
    ).toBeChecked();
    const checkout = review.getByRole("region", {
      name: "Checkout-local application",
      exact: true,
    });
    await checkout.getByRole("button", { name: "Use these changes…", exact: true }).click();
    await expect(checkout.getByRole("status")).toHaveText("prepared");
    await checkout
      .getByRole("list", { name: "Application files", exact: true })
      .getByRole("button", { name: "result.txt", exact: true })
      .click();
    await expect(checkout.locator(".review-diff-editor")).toContainText("human accepted target");
    await checkCheckout("original\n");
    checks.push(
      "Renderer reload retained the same worker; review and application preview show its actual diff.",
    );

    const apply = checkout.getByRole("button", { name: "Apply changes…", exact: true });
    await apply.click();
    await expect.poll(async () => (await dialogs())?.observed.length).toBe(4);
    await expect(apply).toBeEnabled();
    await expect(checkout.getByRole("status")).toHaveText("prepared");
    await checkCheckout("original\n");
    checks.push("Declined native application leaves checkout, staged entries and HEAD unchanged.");
    await apply.click();
    await expect(checkout.getByRole("status")).toHaveText("applied");
    await checkCheckout("human accepted target\n");
    await checkout.getByRole("button", { name: "Undo application…", exact: true }).click();
    await expect(checkout.getByRole("status")).toHaveText("undone");
    await checkCheckout("original\n");
    expect(await readFile(join(worktree, "result.txt"), "utf8")).toBe("human accepted target\n");
    expect(git("worktree", "list", "--porcelain").replaceAll("\\", "/")).toContain(
      `worktree ${worktree.replaceAll("\\", "/")}`,
    );
    expect((await processes()).filter((entry) => entry.cwd === worktree)).toEqual(workerProcesses);
    expect(
      (await page.evaluate(() => window.desktop.snapshot())).runs.map((run) => run.record.id),
    ).toEqual([worker.record.id]);
    expect(errors).toEqual([]);
    const native = await dialogs();
    expect(native?.expected).toEqual([]);
    expect(native?.unexpected).toEqual([]);
    expect(native?.observed).toHaveLength(6);
    checks.push(
      "Confirmed apply and undo preserve unrelated staged/unstaged edits, index entries, HEAD and worker evidence.",
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
});
