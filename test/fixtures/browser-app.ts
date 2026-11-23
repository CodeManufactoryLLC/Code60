import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
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
  requirePairing = true,
  codex = false,
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
      agents: codex
        ? undefined
        : {
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
    CODE60_DEV_CONTAINER: "0",
    SHELL: shell,
    XDG_CONFIG_HOME: join(directory, "config"),
    XDG_STATE_HOME: join(directory, "state"),
  };
  if (codex) {
    const bin = join(directory, "tools");
    await mkdir(bin);
    await symlink(process.execPath, join(bin, "node"));
    for (const tool of ["npm", "npx"])
      await symlink(resolve("test/fixtures/fake-codex-tools.mjs"), join(bin, tool));
    Object.assign(env, {
      PATH: `${bin}:/usr/bin:/bin`,
      CODEX_PATH: undefined,
      CODEX_HOME: join(directory, ".codex"),
      OPENAI_API_KEY: undefined,
      CODEX_API_KEY: undefined,
      CODE60_QA_REPO: resolve("."),
      CODE60_QA_PROCESS_LOG: processLog,
    });
  }
  if (requirePairing) {
    const settings = join(directory, "state/code60/gateway");
    await mkdir(settings, { recursive: true, mode: 0o700 });
    await writeFile(join(settings, "settings.json"), JSON.stringify({ requirePairing: true }), {
      mode: 0o600,
    });
  }
  let gateway = await startGateway({ env, roots: [directory], assets: resolve("dist/renderer") });
  const contexts = new Set<Awaited<ReturnType<Browser["newContext"]>>>();
  async function open(options: { hasTouch?: boolean } = {}) {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      ...options,
    });
    contexts.add(context);
    const page = await context.newPage();
    await page.goto(gateway.origin);
    if (gateway.requirePairing) {
      await page.getByLabel("Pairing code", { exact: true }).fill(gateway.proof());
      await page.getByRole("button", { name: "Connect to Code60", exact: true }).click();
    }
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
  await chooser.getByRole("option", { name: directory, exact: true }).dblclick();
  await chooser.getByLabel("Database filename", { exact: true }).fill("projects.sqlite");
  await chooser.getByRole("button", { name: "Create database", exact: true }).click();
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
  await chooser.getByRole("option", { name: directory, exact: true }).dblclick();
  await chooser.getByRole("option", { name, exact: true }).click();
  await chooser.getByRole("button", { name: "Choose folder", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Open project?", exact: true })
    .getByRole("button", { name: "Confirm", exact: true })
    .click();
  await expect
    .poll(async () => (await page.evaluate(() => window.code60.snapshot())).directory)
    .toBe(join(directory, name));
}
