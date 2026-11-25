import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/clean-install",
  testMatch: "installed.e2e.ts",
  outputDir:
    process.env.ACCEPTANCE_REINSTALLED === "1"
      ? "/evidence/reinstalled-browser"
      : "/evidence/browser",
  workers: 1,
  retries: 0,
  timeout: 120_000,
  globalTimeout: 180_000,
  forbidOnly: true,
  reporter: "list",
  use: { headless: true, viewport: { width: 1600, height: 1000 }, trace: "on" },
});
