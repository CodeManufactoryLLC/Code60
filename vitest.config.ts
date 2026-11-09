import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: { include: /\.[cm]?[jt]sx?$/ },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx,js,mjs}", "test/**/*.{test,spec}.{ts,tsx,js,mjs}"],
    exclude: ["node_modules/**", "dist/**", "test/**/*.e2e.ts", "release/**", "release-assets/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx,cts}"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx,cts}", "src/**/*.d.ts"],
      reporter: ["text-summary", "json", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
