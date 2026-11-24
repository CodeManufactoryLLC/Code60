import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { managementRequest } from "../src/gateway/index.js";
import { runtimeProcessExists } from "../src/platform/index.js";
import { browserApp, onboard } from "./fixtures/browser-app.js";
import { goldenJourney } from "./fixtures/golden-journey.js";

test("browser: first use through accepted plan, automatic edits, diff, attachment and Undo", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  await goldenJourney({
    directory: fixture.directory,
    open: fixture.open,
    close: async () => {
      try {
        const before = await readdir(join(fixture.directory, "state/code60"));
        expect(await managementRequest(fixture.env, "uninstall-summary")).toMatchObject({
          interactiveActive: false,
          scheduledActive: false,
          schedulerAvailable: true,
          scheduledUncertain: false,
          workflows: { completed: 0, active: 0, uncertain: 0 },
        });
        expect(await readdir(join(fixture.directory, "state/code60"))).toEqual(before);
        const audit = JSON.parse(
          await readFile(test.info().outputPath("golden-filesystem.json"), "utf8"),
        );
        // A failed earlier checkpoint must retain its original failure, rather
        // than attempting destructive lifecycle preparation in a partial journey.
        if (audit.observations.length === 4) {
          const repo = join(fixture.directory, "project with spaces");
          const git = (...args: string[]) =>
            execFileSync("git", args, { cwd: repo, encoding: "utf8", timeout: 10_000 });
          const capture = async () => {
            const trees = git("worktree", "list", "--porcelain");
            return {
              head: git("rev-parse", "HEAD"),
              index: createHash("sha256")
                .update(await readFile(join(repo, ".git/index")))
                .digest("hex"),
              workingNotes: await readFile(join(repo, "notes.txt"), "utf8"),
              stagedNotes: git("show", ":notes.txt"),
              trees,
              results: await Promise.all(
                trees
                  .split("\n")
                  .filter((line) => line.startsWith("worktree "))
                  .map((line) => readFile(join(line.slice(9), "result.txt"), "utf8")),
              ),
            };
          };
          const original = await capture();
          const providers = await Promise.all(
            (await readdir(fixture.processLog)).map(async (name) =>
              JSON.parse(await readFile(join(fixture.processLog, name), "utf8")),
            ),
          );
          expect(providers.length).toBeGreaterThan(0);
          for (const provider of providers) {
            expect(Number.isInteger(provider.pid) && provider.pid > 0).toBe(true);
            expect(provider.pid).not.toBe(process.pid);
          }
          expect(await managementRequest(fixture.env, "prepare-uninstall")).toEqual({
            quiescent: true,
            pid: process.pid,
            enginePids: [],
          });
          await expect
            .poll(() => providers.map(({ pid }) => runtimeProcessExists(pid)), {
              timeout: 10_000,
            })
            .toEqual(providers.map(() => false));
          const after = await capture();
          expect(after).toEqual(original);
          await writeFile(
            test.info().outputPath("uninstall-quiescence.json"),
            JSON.stringify(
              {
                classification: "in-process backend quiescence; no OS service exit claim",
                providers: providers.map(({ pid, parent }) => ({ pid, parent, exited: true })),
                before: original,
                after,
              },
              null,
              2,
            ),
          );
        }
      } finally {
        await fixture.close();
      }
    },
  });
});

test("browser: setup-prepared database through provider verification and accepted work", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    await fixture.gateway.application.prepareInitialDatabase();
    await goldenJourney(
      fixture,
      join(fixture.env.XDG_DATA_HOME, "code60/databases/default.sqlite"),
    );
  } catch (error) {
    await fixture.close();
    throw error;
  }
});

test("browser: closing and reconnecting preserves the backend; takeover and stop require explicit action", async ({
  browser,
}) => {
  const fixture = await browserApp(browser);
  try {
    const first = await fixture.open();
    await onboard(first.page);
    const pid = fixture.gateway.application.snapshot().versions.node;
    const second = await fixture.open();
    await expect(
      second.page.getByRole("button", { name: "Take control", exact: true }),
    ).toBeVisible();
    await second.page.getByRole("button", { name: "Take control", exact: true }).click();
    await expect(
      first.page.getByRole("button", { name: "Take control", exact: true }),
    ).toBeVisible();
    await second.context.close();
    expect((await fetch(fixture.gateway.origin)).status).toBe(200);
    expect(fixture.gateway.application.snapshot().versions.node).toBe(pid);
    await first.page.getByRole("button", { name: "Take control", exact: true }).click();
    await first.page.getByRole("button", { name: "Start", exact: true }).click();
    await first.page.getByRole("button", { name: "Stop Code60 Backend", exact: true }).click();
    await first.page
      .getByRole("dialog", { name: "Stop Code60 Backend?", exact: true })
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    expect((await fetch(fixture.gateway.origin)).status).toBe(200);
    expect((await readdir(fixture.processLog)).length).toBeGreaterThan(0);
  } finally {
    await fixture.close();
  }
});
