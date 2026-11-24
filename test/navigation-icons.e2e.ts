import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { build } from "vite";
import { pages, settingsSections } from "../src/contracts/navigation.js";
import { fixturePage } from "./fixtures/static-page.js";

test("browser: route and settings glyphs remain accessible at enlarged text sizes", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "code60-navigation-artwork-"));
  const output = join(directory, "fixture");
  let application: Awaited<ReturnType<typeof fixturePage>> | undefined;
  try {
    await build({
      configFile: false,
      base: "./",
      logLevel: "error",
      define: { "process.env.NODE_ENV": JSON.stringify("development") },
      build: {
        outDir: output,
        lib: {
          entry: resolve(import.meta.dirname, "fixtures/navigation-icons.tsx"),
          formats: ["es"],
          fileName: () => "fixture.js",
          cssFileName: "fixture",
        },
      },
    });
    const html = join(output, "index.html");
    await writeFile(
      html,
      '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'; style-src-attr \'unsafe-inline\'; img-src \'self\'"><link rel="stylesheet" href="./fixture.css"><div id="root"></div><script type="module" src="./fixture.js"></script>',
    );
    application = await fixturePage(browser, output);
    const page = application.page;
    const icons = page.locator("svg.navigation-icon");
    await expect(icons).toHaveCount(
      new Set([...pages, ...settingsSections].map((item) => item.icon).filter(Boolean)).size,
    );
    await expect(page.locator("img")).toHaveCount(0);
    for (const size of [16, 32]) {
      await page
        .locator("html")
        .evaluate(
          (element, size) => element.style.setProperty("--fixture-size", `${size}px`),
          size,
        );
      for (const icon of await icons.all()) {
        await expect(icon).toHaveAttribute("aria-hidden", "true");
        const box = await icon.boundingBox();
        expect(box?.width).toBe(size);
        expect(box?.height).toBe(size);
      }
    }
    await page.screenshot({
      path: test.info().outputPath("navigation-glyphs.png"),
      fullPage: true,
    });
  } finally {
    await application?.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});
