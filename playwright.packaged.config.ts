import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: ["packaged.e2e.ts", "agent-discovery.e2e.ts"],
  workers: 1,
  timeout: 90_000,
  globalTimeout: 5 * 60_000,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  outputDir: "test-results/packaged",
  use: { trace: "retain-on-failure" },
});
