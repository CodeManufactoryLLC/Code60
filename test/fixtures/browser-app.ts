import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Browser, expect, type Page } from "@playwright/test";
import type { startGateway as GatewayFactory } from "../../src/gateway/index.js";

const { startGateway } = (await import(pathToFileURL(resolve("dist/gateway/index.js")).href)) as {
  startGateway: typeof GatewayFactory;
};

export async function browserApp(
  browser: Browser,
  flags: string[] = ["--relay", "--session-info"],
) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-browser-")));
  const config = join(directory, "config/code60");
  const processLog = join(directory, "processes");
  await mkdir(config, { recursive: true });
  await mkdir(processLog);
  const shell = join(directory, "test-shell");
  await writeFile(shell, '#!/bin/sh\nexec /bin/sh -c "$2"\n', { mode: 0o700 });
  await writeFile(
    join(config, "config.json"),
    JSON.stringify({
      agents: {
        claude: {
          command: [
            process.execPath,
            resolve("test/fixtures/fake-agent.mjs"),
            ...flags,
            "--process-log",
            processLog,
          ],
        },
      },
    }),
  );
  const env = {
    ...process.env,
    HOME: directory,
    SHELL: shell,
    XDG_CONFIG_HOME: join(directory, "config"),
    XDG_STATE_HOME: join(directory, "state"),
  };
  let gateway = await startGateway({ env, roots: [directory], assets: resolve("dist/renderer") });
  const contexts = new Set<Awaited<ReturnType<Browser["newContext"]>>>();
  async function open() {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    contexts.add(context);
    const page = await context.newPage();
    await page.goto(gateway.origin);
    await page.getByLabel("Pairing code", { exact: true }).fill(gateway.proof());
    await page.getByRole("button", { name: "Connect to Code60", exact: true }).click();
    return { page, context };
  }
  return {
    directory,
    env,
    processLog,
    open,
    get gateway() {
      return gateway;
    },
    async restart() {
      await gateway.stop();
      gateway = await startGateway({ env, roots: [directory], assets: resolve("dist/renderer") });
    },
    async close() {
      try {
        await Promise.allSettled([...contexts].map((context) => context.close()));
      } finally {
        await gateway.stop();
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

export async function onboard(page: Page) {
  const wizard = page.locator(".agent-setup-dialog");
  await expect(wizard).toBeVisible();
  await wizard.getByRole("button", { name: "Claude", exact: true }).click();
  await expect(wizard.getByRole("status")).toHaveText("Claude connected");
  await wizard.getByRole("button", { name: "Close provider setup", exact: true }).click();
}
export async function createDatabase(page: Page, directory: string) {
  await page.getByRole("button", { name: "Connect to database", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Select database", exact: true })
    .getByRole("button", { name: "Create database…", exact: true })
    .click();
  const chooser = page.getByRole("dialog", { name: "Create database", exact: true });
  await chooser.getByRole("button", { name: `Open folder ${directory}`, exact: true }).click();
  await chooser.getByLabel("Database filename", { exact: true }).fill("projects.sqlite");
  await chooser.getByRole("button", { name: "Create database here", exact: true }).click();
  await expect(chooser).toHaveCount(0);
}
export async function openProject(page: Page, directory: string, name: string) {
  await page.getByRole("tab", { name: "Projects", exact: true }).click();
  await page
    .locator("#panel-projects")
    .getByRole("button", { name: "New Project", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Open Project", exact: true })
    .getByRole("button", { name: "Open Folder", exact: true })
    .click();
  const chooser = page.getByRole("dialog", { name: "Choose folder", exact: true });
  await chooser.getByRole("button", { name: `Open folder ${directory}`, exact: true }).click();
  await chooser.getByRole("button", { name: `Open folder ${name}`, exact: true }).click();
  await chooser.getByRole("button", { name: "Select this folder", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Open project?", exact: true })
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect
    .poll(async () => (await page.evaluate(() => window.code60.snapshot())).directory)
    .toBe(join(directory, name));
}
