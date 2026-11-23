import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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
    XDG_DATA_HOME: join(directory, "data"),
    XDG_CONFIG_HOME: join(directory, "config"),
    XDG_STATE_HOME: join(directory, "state"),
  };
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
