import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["transmission-native.e2e.ts", "transmission-native-legacy.e2e.ts"],
  outputDir: "../test-results/transmission-native",
  workers: 1,
  timeout: 180_000,
  globalTimeout: 10 * 60_000,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  use: { headless: true, trace: "on" },
});
