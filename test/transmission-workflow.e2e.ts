import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, expect, type Page, test } from "@playwright/test";
import type { startGateway as GatewayFactory } from "../src/gateway/index.js";
import { expandNavigation } from "./fixtures/browser-actions.js";
import { commitFixture } from "./fixtures/git-repository.js";

const root = resolve(import.meta.dirname, "..");

const { startGateway } = (await import(
  pathToFileURL(join(root, "dist/gateway/index.js")).href
)) as {
  startGateway: typeof GatewayFactory;
};

async function launchWorkflowBrowser(
  browser: Browser,
  directory: string,
  extraEnv: Record<string, string> = {},
) {
  const shell = join(directory, "test-shell");
  await writeFile(shell, '#!/bin/sh\nexec /bin/sh -c "$2"\n', { mode: 0o700 });
  const env = {
    ...process.env,
    HOME: directory,
    SHELL: shell,
    XDG_CONFIG_HOME: join(directory, "config"),
    XDG_STATE_HOME: join(directory, "state"),
    ...extraEnv,
  };
  const gateway = await startGateway({
    env,
    roots: [directory],
    assets: join(root, "dist/renderer"),
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await page.goto(gateway.origin);
    return {
      origin: gateway.origin,
      firstWindow: async () => page,
      async close() {
        try {
          await context.close();
        } finally {
          await gateway.stop();
        }
      },
    };
  } catch (error) {
    await context.close();
    await gateway.stop();
    throw error;
  }
}

type WorkflowBrowser = Awaited<ReturnType<typeof launchWorkflowBrowser>>;

async function chooseRepository(page: Page, directory: string, name: string) {
  const chooser = page.getByRole("dialog", { name: "Choose folder", exact: true });
  await chooser.getByRole("option", { name: directory, exact: true }).dblclick();
  await chooser.getByRole("option", { name, exact: true }).dblclick();
  await chooser.getByRole("button", { name: "Choose folder", exact: true }).click();
  await expect(chooser).toHaveCount(0);
}

test("workflow: native engine prompt creation, provider selection, pause/resume, repair, diff, cancel and manual completion", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-native-workflow-ui-")));
  const repo = join(directory, "project");
  const config = join(directory, "config/code60");
  const gate1 = join(directory, "gate-1");
  await mkdir(repo);
  await mkdir(config, { recursive: true });
  await writeFile(join(directory, "ask-question"), "1\n");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  await writeFile(join(repo, "source.txt"), "committed\n");
  git("add", ".");
  commitFixture(repo);
  await writeFile(join(repo, "source.txt"), "staged\n");
  git("add", ".");
  await writeFile(join(repo, "source.txt"), "saved unstaged\n");
  await writeFile(join(repo, "untracked.txt"), "untracked saved\n");
  await writeFile(join(repo, "README.md"), "Duration parser fixture");
  const index = await readFile(join(repo, ".git/index"));
  const head = git("rev-parse", "HEAD");
  await writeFile(
    join(config, "config.json"),
    JSON.stringify({
      agents: {
        claude: {
          command: [
            process.execPath,
            join(root, "test/fixtures/fake-agent.mjs"),
            "--workflow-gates",
            directory,
          ],
        },
      },
    }),
  );

  let application: WorkflowBrowser | undefined;
  try {
    application = await launchWorkflowBrowser(browser, directory);
    const page = await application.firstWindow();
    const openWorkflows = async () => {
      await expandNavigation(page, "Develop");
      await page.locator("#tab-workflows").click();
    };
    const menu = (label: string) =>
      page.locator(".workflows-page").getByRole("button", { name: label, exact: true });
    const headerAction = async (label: string) => menu(label).click();

    const wizard = page.locator(".agent-setup-dialog");
    await wizard.getByRole("button", { name: "Claude", exact: true }).click();
    await expect(wizard.getByRole("status")).toHaveText("Claude connected");
    await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();

    await openWorkflows();
    const workflows = page.locator(".workflows-page");
    await expect(page.getByRole("heading", { name: "Workflows", exact: true })).toBeVisible();
    await expect(menu("Workflow sign-in")).toHaveCount(0);
    await expect(menu("New workflow")).toBeEnabled();

    await headerAction("New workflow");
    const form = workflows.getByRole("region", { name: "New workflow", exact: true });
    await expect(form.getByLabel("Provider", { exact: true })).toHaveValue("claude");
    await form.getByRole("button", { name: "Choose repository", exact: true }).click();
    await chooseRepository(page, directory, "project");
    await form.getByRole("button", { name: "Create with prompt", exact: true }).click();

    const chat = page.getByRole("dialog", { name: "Create with prompt", exact: true });
    const workflowInput = chat.getByRole("textbox", { name: "Describe the workflow" });
    await expect(workflowInput).toBeFocused();
    await workflowInput.fill("ask a question");
    await chat.getByRole("button", { name: "Send", exact: true }).click();
    await expect(chat).toContainText("Which parser should be repaired?");
    await chat
      .getByRole("textbox", { name: "Describe the workflow", exact: true })
      .fill("Fix fractional duration parsing and update documentation");
    await chat.getByRole("button", { name: "Send", exact: true }).click();
    await expect(chat).toContainText("Prepared workflow draft");
    await chat
      .getByRole("textbox", { name: "Describe the workflow", exact: true })
      .fill("refine the workflow with negative values");
    await chat.getByRole("button", { name: "Send", exact: true }).click();
    await expect(chat.getByText("Prepared workflow draft", { exact: true })).toHaveCount(2);
    await chat.getByRole("button", { name: "Close chat", exact: true }).click();
    await expect(form.getByLabel("Workflow name", { exact: true })).toHaveValue(
      "Refined parser workflow",
    );
    await expect(form.getByLabel("Task name", { exact: true })).toHaveCount(2);
    await form.getByLabel("Workflow name", { exact: true }).fill("Reviewed duration workflow");

    await form.getByRole("button", { name: "Create with prompt", exact: true }).click();
    await chat
      .getByRole("textbox", { name: "Describe the workflow", exact: true })
      .fill("invalid draft");
    await chat.getByRole("button", { name: "Send", exact: true }).click();
    await expect(chat.getByRole("alert")).toBeVisible();
    await chat.getByRole("button", { name: "Close chat", exact: true }).click();
    await expect(form.getByLabel("Workflow name", { exact: true })).toHaveValue(
      "Reviewed duration workflow",
    );

    await form.getByRole("button", { name: "Create with prompt", exact: true }).click();
    await chat
      .getByRole("textbox", { name: "Describe the workflow", exact: true })
      .fill("wait for cancellation");
    await chat.getByRole("button", { name: "Send", exact: true }).click();
    await chat.getByRole("button", { name: "Stop", exact: true }).click();
    await chat.getByRole("button", { name: "Close chat", exact: true }).click();

    // Delay delivery of a real successful provider response until the operator
    // has closed the prompt dialog and edited the form.
    const gate = () => {
      let resolve!: () => void;
      const promise = new Promise<void>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    };
    const received = gate();
    const release = gate();
    const delivered = gate();
    await page.route("**/api/operation", async (route) => {
      const body = route.request().postDataJSON();
      if (body.operation !== "workflow" || body.value.action !== "draft") return route.continue();
      const response = await route.fetch();
      received.resolve();
      await release.promise;
      await route.fulfill({ response });
      delivered.resolve();
    });
    try {
      await form.getByRole("button", { name: "Create with prompt", exact: true }).click();
      await chat
        .getByRole("textbox", { name: "Describe the workflow" })
        .fill("refine the workflow with negative values");
      await chat.getByRole("button", { name: "Send", exact: true }).click();
      await received.promise;
      await chat.getByRole("button", { name: "Close chat", exact: true }).click();
      await form
        .getByLabel("Workflow name", { exact: true })
        .fill("Reviewed duration workflow after draft");
      release.resolve();
      await delivered.promise;
      await expect(form.getByLabel("Workflow name", { exact: true })).toHaveValue(
        "Reviewed duration workflow after draft",
      );
      await form.getByLabel("Workflow name", { exact: true }).fill("Reviewed duration workflow");
    } finally {
      release.resolve();
      await page.unroute("**/api/operation");
    }

    expect(git("worktree", "list", "--porcelain")).not.toContain(
      "branch refs/heads/code60/workflow-",
    );
    await form.getByRole("button", { name: "Review workflow", exact: true }).click();
    await expect(
      form.getByText("Dedicated worktree; continues while the browser is closed", {
        exact: true,
      }),
    ).toBeVisible();
    expect(git("worktree", "list", "--porcelain")).not.toContain(
      "branch refs/heads/code60/workflow-",
    );

    await form.getByRole("button", { name: "Start workflow", exact: true }).click();
    await expect(workflows.getByText("Implementing", { exact: true })).toBeVisible();

    const registryPath = join(directory, "state/code60/workflows/registry.json");
    const saved = JSON.parse(await readFile(registryPath, "utf8"));
    const firstWorktree: string = saved.entries[0].worktree;
    expect(await readFile(join(firstWorktree, "source.txt"), "utf8")).toBe("saved unstaged\n");
    expect(await readFile(join(firstWorktree, "untracked.txt"), "utf8")).toBe("untracked saved\n");
    await expect
      .poll(() => readFile(join(firstWorktree, "workflow-result.txt"), "utf8").catch(() => ""))
      .toContain("isolated");
    await expect(readFile(join(repo, "workflow-result.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const stream = workflows.getByRole("log");
    await expect(stream.getByText("2 tool updates")).toBeVisible();
    await expect(stream.getByText(/Read fixture file/)).toHaveCount(0);
    await workflows.getByRole("button", { name: "Expand tool calls" }).press("Enter");
    await expect(stream.getByText(/Read fixture file/)).toBeVisible();
    await workflows.getByRole("button", { name: "Collapse tool calls" }).click();
    await expect(stream.getByText(/Read fixture file/)).toHaveCount(0);

    const firstTask = workflows.locator(".workflow-task-list details").first();
    await expect(firstTask).not.toHaveAttribute("open", "");
    await firstTask.locator("summary").click();
    const configButton = firstTask.getByRole("button", { name: "View Configuration" });
    await configButton.click();
    await expect(page.getByRole("dialog", { name: "Task 1 configuration" })).toContainText(
      "Verification Criteria",
    );
    await page.keyboard.press("Escape");
    await expect(configButton).toBeFocused();
    await firstTask.locator("summary").click();

    // Pause, reload browser, verify retained paused state and timer, then resume.
    await workflows.getByRole("button", { name: "Pause workflow" }).click();
    await expect(firstTask.locator("summary")).toContainText("Paused");
    const timer = workflows.getByRole("timer");
    await expect(timer).toHaveText(/^\d+:\d{2}$/);
    const pauseTime = (await timer.textContent()) ?? "";
    await page.reload();
    await openWorkflows();
    await workflows.getByRole("tab", { name: "Execution history", exact: true }).click();
    await workflows.getByRole("button", { name: /^Reviewed duration workflow/ }).click();
    await expect(timer).toHaveText(pauseTime);
    await workflows.getByRole("button", { name: "Resume workflow" }).click();
    await expect(firstTask.locator("summary")).toContainText("Implementing");

    // Release gate 1: initial worker finishes -> verifier rejects -> repair worker asks question.
    await writeFile(gate1, "go\n");
    await expect(workflows.getByLabel("Preserve negative zero?", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await firstTask.locator("summary").click();
    await firstTask.getByRole("button", { name: "View Results" }).click();
    const rejected = page.getByRole("dialog", { name: "Task 1 results" });
    await expect(rejected).toContainText("Rejected");
    await expect(rejected).toContainText("Add the missing negative case");
    await rejected.getByRole("button", { name: "Close Task 1 results", exact: true }).click();
    await firstTask.locator("summary").click();

    // Queue steer guidance and answer the worker's scope question.
    await workflows.getByRole("button", { name: "Steer", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Steer workflow", exact: true })
      .getByLabel("Guidance for a subsequent turn", { exact: true })
      .fill("Keep the public API stable");
    await page
      .getByRole("dialog", { name: "Steer workflow", exact: true })
      .getByRole("button", { name: "Queue guidance", exact: true })
      .click();
    await expect(page.getByRole("dialog", { name: "Steer workflow", exact: true })).toHaveCount(0);
    await workflows.getByLabel("Preserve negative zero?", { exact: true }).fill("normalize");
    await workflows.getByRole("button", { name: "Send answer", exact: true }).click();

    // Repair completes, verifier accepts Task 1, Task 2 blocks on gate 2.
    await expect(
      workflows.getByRole("img", { name: "50% complete, 1 of 2 tasks accepted" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(workflows.getByRole("log")).toContainText("Keep the public API stable");
    await workflows.getByText("Accepted diff", { exact: true }).click();
    await workflows.getByRole("button", { name: "Load accepted diff" }).click();
    await expect(workflows.locator("pre").filter({ hasText: "workflow-result.txt" })).toBeVisible();

    await workflows.getByText("Workflow details", { exact: true }).click();
    await expect(workflows.locator("details", { hasText: "Workflow details" })).toContainText(
      "Claude",
    );

    for (const width of [1400, 640]) {
      await page.setViewportSize({ width, height: width === 1400 ? 1100 : 900 });
      for (const mode of ["Dark", "Light"]) {
        await page.getByRole("button", { name: "Workspace", exact: true }).click();
        await page.getByLabel("Color theme", { exact: true }).selectOption(mode.toLowerCase());
        await page.keyboard.press("Escape");
        await expect(page.locator("html")).toHaveAttribute("data-color-scheme", mode.toLowerCase());
        const player = await workflows.locator(".workflow-player").boundingBox();
        expect(player?.width).toBeLessThanOrEqual(736);
        const controls = await workflows.locator(".workflow-player-left").boundingBox();
        const activity = await workflows.locator(".workflow-activity-box").boundingBox();
        expect(controls && activity && Math.abs(controls.height - activity.height) < 2).toBe(true);
        expect(
          controls &&
            activity &&
            (width === 640
              ? activity.y >= controls.y + controls.height
              : Math.abs(controls.y - activity.y) < 2),
        ).toBe(true);
        await workflows.locator(".workflow-player > h2").scrollIntoViewIfNeeded();
        const sequences = await workflows
          .getByRole("log")
          .locator("li")
          .evaluateAll((rows) => rows.map((row) => Number(row.getAttribute("data-sequence"))));
        expect(sequences).toEqual([...new Set(sequences)].sort((a, b) => b - a));
        await page.mouse.move(0, 0);
        await page.screenshot({ path: test.info().outputPath(`workflow-${width}-${mode}.png`) });
      }
    }

    // Stop confirmation dialog: cancel first, then confirm stop.
    const stop = workflows.getByRole("button", { name: "Stop workflow", exact: true });
    await stop.click();
    const confirmation = page.getByRole("dialog", { name: "Stop workflow?" });
    await expect(confirmation).toContainText("cannot be resumed");
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await stop.click();
    await confirmation.getByRole("button", { name: "Stop workflow", exact: true }).click();
    await expect(workflows.locator(".workflow-player > [role=status]")).toHaveText("Cancelled");

    // Manual workflow runs to 100% completion.
    await headerAction("Workflow history");
    await workflows.getByRole("tab", { name: "Definitions", exact: true }).click();
    await headerAction("New workflow");
    const manual = workflows.getByRole("region", { name: "New workflow", exact: true });
    await manual.getByLabel("Workflow name", { exact: true }).fill("Manual workflow");
    await manual.getByRole("button", { name: "Choose repository", exact: true }).click();
    await chooseRepository(page, directory, "project");
    await manual.getByLabel("Task name", { exact: true }).fill("Check behavior");
    await manual
      .getByLabel("Implementation instructions", { exact: true })
      .fill("Inspect the parser behavior");
    await manual.getByLabel("Verification criteria", { exact: true }).fill("Verify the public API");
    await manual.getByRole("button", { name: "Review workflow", exact: true }).click();
    await manual.getByRole("button", { name: "Start workflow", exact: true }).click();
    await expect(
      workflows.getByRole("img", { name: "100% complete, 1 of 1 tasks accepted" }),
    ).toBeVisible({ timeout: 15_000 });
    await workflows.locator(".workflow-task-list summary").click();
    await workflows.getByRole("button", { name: "View Results" }).click();
    await expect(
      page
        .getByRole("dialog", { name: "Task 1 results", exact: true })
        .getByText("Independent fixture checks passed", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(workflows.getByRole("button", { name: "View Results" })).toBeFocused();

    expect(await readFile(join(repo, "source.txt"), "utf8")).toBe("saved unstaged\n");
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(await readFile(join(repo, ".git/index"))).toEqual(index);
    expect(await readFile(join(firstWorktree, "workflow-result.txt"), "utf8")).toContain(
      "isolated",
    );
  } finally {
    const cleanup = await Promise.allSettled([application?.close()]);
    await rm(directory, { recursive: true, force: true });
    expect(cleanup).toEqual([{ status: "fulfilled", value: undefined }]);
  }
});
