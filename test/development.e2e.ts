import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import type { spawnOwnedProcess as Spawn } from "../src/platform/index.js";
import { onboard } from "./fixtures/browser-app.js";

const { spawnOwnedProcess } = (await import(
  pathToFileURL(resolve("dist/platform/index.js")).href
)) as {
  spawnOwnedProcess: typeof Spawn;
};

async function freePort() {
  const server = createServer();
  await new Promise<void>((ready, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", ready);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No development test port");
  await new Promise<void>((ready) => server.close(() => ready()));
  return address.port;
}

test("development: Fast Refresh preserves the Gateway and Gateway edits restart only the Gateway", async ({
  browser,
}, info) => {
  test.setTimeout(120_000);
  // Edit a disposable source copy, never the contributor's working files.
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-dev-journey-")));
  let processHandle: Awaited<ReturnType<typeof Spawn>> | undefined;
  const context = await browser.newContext();
  let output = "";
  try {
    for (const path of [
      "src",
      "scripts/dev.mjs",
      "scripts/dev-gateway.mjs",
      "scripts/dev-ports.mjs",
      "package.json",
      "tsconfig.json",
      "tsconfig.build.json",
      "vite.config.ts",
    ])
      await cp(resolve(path), join(directory, path), { recursive: true });
    await symlink(resolve("node_modules"), join(directory, "node_modules"), "dir");
    const config = join(directory, "test-results/dev/config/code60");
    await mkdir(config, { recursive: true });
    await writeFile(
      join(config, "config.json"),
      JSON.stringify({
        agents: {
          claude: {
            command: [
              process.execPath,
              resolve("test/fixtures/fake-agent.mjs"),
              "--relay",
              "--session-info",
            ],
          },
        },
      }),
    );
    const gatewayPort = process.env.CODE60_DEV_GATEWAY_PORT
      ? Number(process.env.CODE60_DEV_GATEWAY_PORT)
      : await freePort();
    const origin = `http://127.0.0.1:${gatewayPort}`;
    let vitePort = process.env.CODE60_VITE_PORT
      ? Number(process.env.CODE60_VITE_PORT)
      : await freePort();
    while (vitePort === gatewayPort && !process.env.CODE60_VITE_PORT) vitePort = await freePort();
    if (vitePort === gatewayPort) throw new Error("Development test ports must differ");
    processHandle = await spawnOwnedProcess([process.execPath, "scripts/dev.mjs"], directory, {
      ...process.env,
      HOME: directory,
      SHELL: "/bin/sh",
      CODE60_DEV_GATEWAY_PORT: String(gatewayPort),
      CODE60_VITE_PORT: String(vitePort),
    });
    const capture = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-64 * 1024);
    };
    processHandle.stdout.on("data", capture);
    processHandle.stderr.on("data", capture);
    const connectionFile = join(directory, "test-results/dev/state/code60/gateway/connection.json");
    const connection = async (): Promise<{ pid: number; origin: string } | null> => {
      try {
        return JSON.parse(await readFile(connectionFile, "utf8"));
      } catch {
        return null;
      }
    };
    await expect.poll(async () => (await connection())?.origin, { timeout: 45_000 }).toBe(origin);
    const initial = await connection();
    if (!initial) throw new Error("Development Gateway never became ready");
    const page = await context.newPage();
    await page.goto(origin);
    await onboard(page);
    await expect(page.getByRole("banner", { name: "Code60" })).toBeVisible();
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    const footer = page.getByRole("note", { name: "Running Code60 version" });
    await expect(footer).toBeVisible();
    await page.evaluate(() => sessionStorage.setItem("code60-dev-journey", "retained"));
    const documentId = await page.evaluate(() => performance.timeOrigin);
    const footerFile = join(directory, "src/renderer/app-footer.tsx");
    await writeFile(
      footerFile,
      (await readFile(footerFile, "utf8")).replace(
        'className="app-footer"',
        'className="app-footer" data-dev-journey="refreshed"',
      ),
    );
    await expect(page.locator("footer.app-footer")).toHaveAttribute(
      "data-dev-journey",
      "refreshed",
      { timeout: 20_000 },
    );
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentId);
    expect((await connection())?.pid).toBe(initial.pid);
    const upstream = await fetch(`http://127.0.0.1:${vitePort}/@vite/client`);
    expect(upstream.status).toBe(200);
    // The config generates a new CSP nonce when Vite starts. Unlike an HTTP
    // readiness check, retaining this value detects an unintended Vite restart.
    const viteNonce = async () =>
      (await (await fetch(`http://127.0.0.1:${vitePort}/`)).text()).match(/nonce="([^"]+)"/)?.[1];
    const initialNonce = await viteNonce();
    expect(initialNonce).toBeTruthy();
    const gatewayFile = join(directory, "src/gateway/server.ts");
    await writeFile(
      gatewayFile,
      `${await readFile(gatewayFile, "utf8")}\n// Development restart checkpoint.\n`,
    );
    await expect
      .poll(async () => (await connection())?.pid ?? initial.pid, { timeout: 30_000 })
      .not.toBe(initial.pid);
    expect((await connection())?.origin).toBe(initial.origin);
    expect((await fetch(`http://127.0.0.1:${vitePort}/@vite/client`)).status).toBe(200);
    expect(await viteNonce()).toBe(initialNonce);
    expect(
      (
        await fetch(`${origin}/api/connection`, {
          headers: { Origin: "https://invalid.example" },
        })
      ).status,
    ).toBe(403);
  } finally {
    await context.close();
    try {
      await processHandle?.stop(25_000);
    } finally {
      await info.attach("development-process-output", { body: output, contentType: "text/plain" });
      await rm(directory, { recursive: true, force: true });
    }
  }
});
