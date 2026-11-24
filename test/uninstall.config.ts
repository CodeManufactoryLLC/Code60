import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "uninstall-installed.e2e.ts",
  outputDir: process.env.CODE60_UNINSTALL_BROWSER_OUTPUT ?? "../test-results/uninstall-browser",
  workers: 1,
  retries: 0,
  timeout: 120000,
  globalTimeout: 4 * 60_000,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
});
