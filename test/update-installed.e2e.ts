import { readFile } from "node:fs/promises";
import { chromium, test } from "@playwright/test";
import { goldenJourney } from "./fixtures/golden-journey.js";

test("updated installation: provider verification, accepted work, attachment and Undo", async ({
  browserName,
}, info) => {
  if (browserName !== "chromium") throw Error("Update acceptance requires pinned Chromium");
  const control = process.env.CODE60_UPDATE_BROWSER_INPUT;
  if (!control) throw Error("Run this journey through npm run test:update");
  const input = JSON.parse(await readFile(control, "utf8")) as {
    origin: string;
    directory: string;
    database: string;
    executable: string;
  };
  if (!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(input.origin))
    throw Error("Invalid update browser origin");
  const browser = await chromium.launch({ headless: true, executablePath: input.executable });
  const context = await browser.newContext();
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    await goldenJourney(
      {
        directory: input.directory,
        async open() {
          const page = await context.newPage();
          await page.goto(input.origin);
          return { page };
        },
        async close() {
          try {
            await context.tracing.stop({ path: info.outputPath("updated-golden-trace.zip") });
          } finally {
            await context.close();
          }
        },
      },
      input.database,
    );
  } finally {
    await browser.close();
  }
});
