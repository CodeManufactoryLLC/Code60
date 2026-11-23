import { readFile } from "node:fs/promises";
import { test } from "@playwright/test";
import { goldenJourney } from "../fixtures/golden-journey.js";

test("installed package: first use through an accepted task and Undo", async ({ browser }) => {
  const { origin } = JSON.parse(await readFile("/work/control/public.json", "utf8")) as {
    origin: string;
  };
  const context = await browser.newContext();
  await goldenJourney({
    directory: "/work/home",
    async open() {
      const page = await context.newPage();
      await page.goto(origin);
      return { page };
    },
    async close() {
      await context.close();
    },
  });
});
