import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { build } from "vite";
import { launchDesktop, removeDesktopFixture } from "./electron-launcher.js";

test("desktop: Relay file hooks survive StrictMode replay, stale frames and re-registration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "code60-renderer-replay-"));
  const output = join(directory, "fixture");
  const root = resolve(import.meta.dirname, "..");
  let application: Awaited<ReturnType<typeof launchDesktop>> | undefined;
  try {
    await build({
      configFile: false,
      logLevel: "error",
      define: { "process.env.NODE_ENV": JSON.stringify("development") },
      build: {
        outDir: output,
        minify: false,
        lib: {
          entry: join(root, "test/fixtures/renderer-replay.tsx"),
          formats: ["es"],
          fileName: () => "replay.js",
        },
      },
    });
    const html = join(output, "index.html");
    await writeFile(
      html,
      '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'"><div id="root"></div><script type="module" src="./replay.js"></script>',
    );
    application = await launchDesktop(directory, directory, join(directory, "unused.sqlite"));
    const ready = application.waitForEvent("window");
    await application.evaluate(({ BrowserWindow }, html) => {
      const window = new BrowserWindow({
        show: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
      });
      void window.loadFile(html);
    }, html);
    const page = await ready;
    const preview = page.getByLabel("Preview");
    const state = () =>
      page
        .getByLabel("Transport")
        .textContent()
        .then(
          (text) =>
            JSON.parse(text ?? "{}") as {
              registrations: number;
              releases: number;
              subscriptions: number;
              listeners: number;
              sequence: number;
              contexts: number;
              errors: number;
            },
        );
    await expect(preview).toHaveText("fresh");
    await expect.poll(async () => (await state()).registrations).toBe(2);
    expect(await state()).toMatchObject({ subscriptions: 1, releases: 1, listeners: 1, errors: 0 });
    await page.getByRole("button", { name: "Hold", exact: true }).click();
    await page.getByRole("button", { name: "Activate", exact: true }).click();
    await expect(preview).toBeEmpty();
    const hiddenSequence = (await state()).sequence;
    await page.getByRole("button", { name: "Activate", exact: true }).click();
    await expect.poll(async () => (await state()).sequence).toBeGreaterThan(hiddenSequence);
    await page.getByRole("button", { name: "Publish stale", exact: true }).click();
    await expect(preview).toBeEmpty();
    await page.getByRole("button", { name: "Publish latest", exact: true }).click();
    await expect(preview).toHaveText("fresh");
    await page.getByRole("button", { name: "Enable", exact: true }).click();
    await expect.poll(async () => (await state()).subscriptions).toBe(0);
    await page.getByRole("button", { name: "Enable", exact: true }).click();
    await expect.poll(async () => (await state()).subscriptions).toBe(1);
    await page.getByRole("button", { name: "Publish released", exact: true }).click();
    await expect(preview).toBeEmpty();
    await page.getByRole("button", { name: "Publish latest", exact: true }).click();
    await expect(preview).toHaveText("fresh");
    await page.getByRole("button", { name: "Target", exact: true }).click();
    await expect(preview).toBeEmpty();
    await expect.poll(async () => (await state()).registrations).toBe(4);
    await page.getByRole("button", { name: "Publish released", exact: true }).click();
    await expect(preview).toBeEmpty();
    await page.getByRole("button", { name: "Publish latest", exact: true }).click();
    await expect(preview).toHaveText("fresh");
    expect(await state()).toMatchObject({ subscriptions: 1, listeners: 1, releases: 3, errors: 0 });
    await expect(page.getByLabel("Error")).toBeEmpty();
  } finally {
    await application?.close().catch(() => {});
    await removeDesktopFixture(directory, { recursive: true, force: true });
  }
});
