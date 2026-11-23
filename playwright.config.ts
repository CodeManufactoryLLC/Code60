import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: [
    "desktop.e2e.ts",
    "agent-workflow.e2e.ts",
    "automation-workflow.e2e.ts",
    "agent-discovery.e2e.ts",
    "logs.e2e.ts",
    "renderer-replay.e2e.ts",
    "system-manager.e2e.ts",
    "transmission-workflow.e2e.ts",
    "navigation-icons.e2e.ts",
    "memory-recall.e2e.ts",
  ],
  workers: 1,
  // Covers the serial 92-scenario suite on hosted native runners; per-test limits still apply.
  globalTimeout: 25 * 60_000,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  use: { trace: "retain-on-failure" },
});
