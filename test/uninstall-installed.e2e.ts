import { readFile } from "node:fs/promises";
import { chromium, test } from "@playwright/test";
import { reopenRetainedProject } from "./fixtures/browser-actions.js";
import { goldenJourney } from "./fixtures/golden-journey.js";

test("installed uninstall: accepted work and retained-data browser reopen", async ({
  browserName,
}, info) => {
  if (browserName !== "chromium") throw Error("Uninstall acceptance requires pinned Chromium");
  const control = process.env.CODE60_UNINSTALL_BROWSER_INPUT;
  if (!control) throw Error("Run through npm run test:uninstall");
  const input = JSON.parse(await readFile(control, "utf8")) as {
    origin: string;
    directory: string;
    database: string;
    executable: string;
    retained: boolean;
  };
  if (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(input.origin))
    throw Error("Invalid uninstall browser origin");
  const browser = await chromium.launch({ headless: true, executablePath: input.executable });
  const context = await browser.newContext();
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    if (input.retained) {
      const page = await context.newPage();
      await page.goto(input.origin);
      await reopenRetainedProject(page, input.directory, input.database);
      await page.screenshot({ path: info.outputPath("reinstalled.png") });
    } else
      await goldenJourney(
        {
          directory: input.directory,
          async open() {
            const page = await context.newPage();
            await page.goto(input.origin);
            return { page };
          },
          async close() {},
        },
        input.database,
      );
  } finally {
    try {
      await context.tracing.stop({ path: info.outputPath("uninstall-trace.zip") });
    } finally {
      await context.close();
      await browser.close();
    }
  }
});
