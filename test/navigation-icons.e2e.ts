import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { build } from "vite";
import viewBoxes from "../src/renderer/navigation-icon-viewboxes.json" with { type: "json" };
import { launchDesktop, removeDesktopFixture } from "./electron-launcher.js";

test("desktop: all navigation SVGs tightly frame their artwork without distortion", async () => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "code60-navigation-artwork-"));
  const output = join(directory, "fixture");
  let application: Awaited<ReturnType<typeof launchDesktop>> | undefined;
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
    application = await launchDesktop(directory, directory, join(directory, "unused.sqlite"));
    const ready = application.waitForEvent("window");
    await application.evaluate(({ BrowserWindow }, html) => {
      const window = new BrowserWindow({
        show: true,
        width: 1280,
        height: 1000,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
      });
      void window.loadFile(html);
    }, html);
    const page = await ready;
    await expect(page.locator(".navigation-icon")).toHaveCount(52);
    for (const image of await page.locator("img.navigation-icon").all()) {
      await expect(image).toHaveJSProperty("complete", true);
      expect(
        await image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
      ).toBeGreaterThan(0);
    }
    const sources = Object.fromEntries(
      await Promise.all(
        Object.keys(viewBoxes)
          .filter((name) => name.startsWith("app-") && name !== "app-window")
          .map(async (name) => [
            name,
            await readFile(
              resolve(import.meta.dirname, `../src/renderer/icons/apps/${name.slice(4)}.svg`),
              "utf8",
            ),
          ]),
      ),
    ) as Record<string, string>;
    const measurements = await page.locator(".navigation-icon").evaluateAll(
      (icons, sources) =>
        icons.map((icon) => {
          const name = (icon as HTMLElement).dataset.icon as string;
          const source = sources[name];
          const svg = source
            ? (document.importNode(
                new DOMParser().parseFromString(source, "image/svg+xml").documentElement,
                true,
              ) as unknown as SVGSVGElement)
            : (icon as SVGSVGElement);
          if (source) {
            svg.style.position = "absolute";
            svg.style.visibility = "hidden";
            document.body.append(svg);
          }
          const { x, y, width, height } = svg.getBBox();
          const viewport = svg.viewBox.baseVal;
          const viewBox = [viewport.x, viewport.y, viewport.width, viewport.height];
          if (source) svg.remove();
          return { name, geometry: [x, y, width, height], viewBox };
        }),
      sources,
    );
    await writeFile(
      test.info().outputPath("icon-bounds.json"),
      JSON.stringify(measurements, null, 2),
    );
    for (const { name, geometry, viewBox } of measurements) {
      for (let axis = 0; axis < 4; axis++)
        expect(viewBox[axis], `${name}: viewport axis ${axis}`).toBeCloseTo(
          geometry[axis] as number,
          3,
        );
    }
    for (const size of [8, 15, 48]) {
      await page.evaluate(
        (size) => document.documentElement.style.setProperty("--fixture-size", `${size}px`),
        size,
      );
      for (const icon of await page.locator(".navigation-icon").all()) {
        const scale =
          (await icon.getAttribute("data-enlarged")) === "true"
            ? 2.4
            : (await icon.getAttribute("data-animated")) === "true"
              ? 2
              : 1;
        const bounds = await icon.boundingBox();
        expect(bounds?.width ?? 0).toBeCloseTo(size * scale, 1);
        expect(bounds?.height ?? 0).toBeCloseTo(size * scale, 1);
        await expect(icon).toHaveCSS("object-fit", "contain");
        await expect(icon).toHaveAttribute("aria-hidden", "true");
      }
    }
    await page.screenshot({
      path: test.info().outputPath("navigation-artwork.png"),
      fullPage: true,
    });
  } finally {
    await application?.close().catch(() => {});
    await removeDesktopFixture(directory, { recursive: true, force: true });
  }
});
