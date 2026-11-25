import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createDatabase, onboard, openProject } from "./browser-actions.js";
import { commitFixture } from "./git-repository.js";

interface GoldenApplication {
  directory: string;
  open(): Promise<{ page: Page }>;
  close(): Promise<void>;
}

export async function goldenJourney(fixture: GoldenApplication, setupDatabase?: string) {
  test.setTimeout(120_000);
  const repo = join(fixture.directory, "project with spaces");
  await mkdir(repo);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8", timeout: 10_000 });
  git("init", "-q", "-b", "main");
  await writeFile(join(repo, "result.txt"), "original\n");
  await writeFile(join(repo, "notes.txt"), "committed\n");
  git("add", ".");
  commitFixture(repo);
  await writeFile(join(repo, "notes.txt"), "staged\n");
  git("add", "notes.txt");
  await writeFile(join(repo, "notes.txt"), "unstaged\n");
  const index = await readFile(join(repo, ".git/index"));
  const head = git("rev-parse", "HEAD");
  const worktrees = git("worktree", "list", "--porcelain");
  const audit = {
    expected: {
      head: head.trim(),
      workingNotes: "unstaged\n",
      stagedNotes: "staged\n",
      indexSha256: createHash("sha256").update(index).digest("hex"),
      worktrees: worktrees.toString(),
    },
    observations: [] as {
      head: string;
      indexSha256: string;
      workingNotes: string;
      stagedNotes: string;
      result: string;
    }[],
  };
  const unchanged = async () => {
    audit.observations.push({
      head: git("rev-parse", "HEAD").toString().trim(),
      indexSha256: createHash("sha256")
        .update(await readFile(join(repo, ".git/index")))
        .digest("hex"),
      workingNotes: await readFile(join(repo, "notes.txt"), "utf8"),
      stagedNotes: git("show", ":notes.txt").toString(),
      result: await readFile(join(repo, "result.txt"), "utf8"),
    });
    expect(await readFile(join(repo, "notes.txt"), "utf8")).toBe("unstaged\n");
    expect(git("show", ":notes.txt")).toBe("staged\n");
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(await readFile(join(repo, ".git/index"))).toEqual(index);
  };
  const errors: string[] = [];
  try {
    const { page } = await fixture.open();
    page.on("pageerror", (error) => errors.push(error.message));
    await onboard(page);
    if (setupDatabase) {
      expect((await page.evaluate(() => window.code60.snapshot())).database).toBe(setupDatabase);
    } else await createDatabase(page, fixture.directory);
    expect(
      (await readFile(setupDatabase ?? join(fixture.directory, "projects.sqlite")))
        .subarray(0, 16)
        .toString(),
    ).toBe("SQLite format 3\0");
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await openProject(page, fixture.directory, "project with spaces");
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    const chat = page.locator(".orchestration-chat-page:visible");
    const composer = chat.getByRole("textbox", { name: "Message to orchestrator", exact: true });
    const request = `Plan a change in ${repo}\nCreate result.txt containing "human accepted target" followed by a newline. Use an isolated worktree and wait for my approval.`;
    await composer.fill(request);
    await composer.press("Enter");
    const plan = page.getByRole("region", { name: "Plan", exact: true });
    await expect(
      plan.getByRole("heading", { name: "Relay target plan", exact: true }),
    ).toBeVisible();
    expect((await page.evaluate(() => window.code60.snapshot())).runs).toHaveLength(0);
    expect(git("worktree", "list", "--porcelain")).toBe(worktrees);
    await unchanged();
    await plan.getByRole("button", { name: "Accept", exact: true }).click();
    await expect
      .poll(async () => readFile(join(repo, "result.txt"), "utf8"), { timeout: 30_000 })
      .toBe("human accepted target\n");
    await unchanged();
    const completed = await page.evaluate(() => window.code60.snapshot());
    const worker = completed.runs.find((run) => run.relay);
    expect(worker?.record.worktree).toBeTruthy();
    await chat.getByRole("button", { name: "1 file changed", exact: true }).click();
    const panel = page.locator("#relay-plan-panel");
    await expect(panel.locator(".review-panel .review-diff-editor")).toContainText(
      "human accepted target",
    );
    await composer.fill("An existing unsent draft.");
    const editor = panel.locator(".modified .inputarea").last();
    await editor.press("Control+Home");
    await editor.press("Shift+End");
    await panel.getByRole("button", { name: "Add to chat", exact: true }).click();
    await expect(composer).toHaveValue("An existing unsent draft.");
    await expect(
      page.getByRole("list", { name: "Attached code references", exact: true }),
    ).toContainText("result.txt:1-1");
    await page.reload();
    await page.getByRole("button", { name: "Relay", exact: true }).click();
    await expect(composer).toHaveValue("An existing unsent draft.");
    expect(
      (await page.evaluate(() => window.code60.snapshot())).runs.map((run) => run.record.id),
    ).toEqual([worker?.record.id]);
    const undo = chat
      .locator(".event.prompt:not(.automatic)")
      .last()
      .getByRole("button", { name: "Undo", exact: true });
    await undo.click();
    let confirm = page.getByRole("dialog", { name: "Undo this request?", exact: true });
    await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await expect(confirm.getByRole("button", { name: "Undo request", exact: true })).toHaveClass(
      /cds--btn--danger/,
    );
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await readFile(join(repo, "result.txt"), "utf8")).toBe("human accepted target\n");
    await unchanged();
    await undo.click();
    confirm = page.getByRole("dialog", { name: "Undo this request?", exact: true });
    await confirm.getByRole("button", { name: "Undo request", exact: true }).click();
    await expect
      .poll(async () => readFile(join(repo, "result.txt"), "utf8"), { timeout: 20_000 })
      .toBe("original\n");
    await expect(composer).toBeEditable({ timeout: 30_000 });
    await expect(composer).toHaveValue(request);
    await unchanged();
    expect(await readFile(join(worker?.record.worktree as string, "result.txt"), "utf8")).toBe(
      "human accepted target\n",
    );
    expect(errors).toEqual([]);
    await page.screenshot({ path: test.info().outputPath("browser-golden-path.png") });
  } finally {
    try {
      await writeFile(
        test.info().outputPath("golden-filesystem.json"),
        JSON.stringify(audit, null, 2),
      );
    } finally {
      await fixture.close();
    }
  }
}
