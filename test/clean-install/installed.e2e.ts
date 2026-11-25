import { readdir, readFile, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { reopenRetainedProject } from "../fixtures/browser-actions.js";
import { goldenJourney } from "../fixtures/golden-journey.js";

test("installed package: first use through an accepted task and Undo", async ({ browser }) => {
  const { origin, setupDatabase } = JSON.parse(
    await readFile("/work/control/public.json", "utf8"),
  ) as {
    origin: string;
    setupDatabase?: string;
  };
  const context = await browser.newContext();
  if (process.env.ACCEPTANCE_REINSTALLED === "1") {
    try {
      const page = await context.newPage();
      await page.goto(origin);
      if (!setupDatabase) throw Error("Reinstall acceptance requires its setup-created database");
      await reopenRetainedProject(page, "/work/home", setupDatabase);
      const removal = JSON.parse(await readFile("/evidence/uninstall-reinstall.json", "utf8"));
      expect((await readdir("/work/prompts")).sort()).toEqual(removal.original.prompts);
      const snapshot = await page.evaluate(() => window.code60.snapshot());
      await page.screenshot({ path: test.info().outputPath("reinstalled.png") });
      await writeFile(
        "/evidence/reinstalled-browser.json",
        JSON.stringify({
          database: snapshot.database,
          directory: snapshot.directory,
          noProviderOnboarding: true,
          noDuplicateWork: true,
        }),
      );
    } finally {
      await context.close();
    }
    return;
  }
  await goldenJourney(
    {
      directory: "/work/home",
      async open() {
        const page = await context.newPage();
        await page.goto(origin);
        return { page };
      },
      async close() {
        await context.close();
      },
    },
    setupDatabase,
  );
});
