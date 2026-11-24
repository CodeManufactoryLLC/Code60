import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "update-installed.e2e.ts",
  outputDir: process.env.CODE60_UPDATE_BROWSER_OUTPUT ?? "../test-results/update-browser",
  workers: 1,
  timeout: 120000,
  globalTimeout: 4 * 60_000,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
});
