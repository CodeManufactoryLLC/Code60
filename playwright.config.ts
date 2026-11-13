import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: ["desktop.e2e.ts", "agent-discovery.e2e.ts", "logs.e2e.ts", "renderer-replay.e2e.ts"],
  workers: 1,
  globalTimeout: 15 * 60_000,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  use: { trace: "retain-on-failure" },
});
