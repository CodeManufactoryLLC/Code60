import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser } from "@playwright/test";
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

export { createDatabase, onboard, openProject } from "./browser-actions.js";
