import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: { include: /\.[cm]?[jt]sx?$/ },
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx,js,mjs}", "test/**/*.{test,spec}.{ts,tsx,js,mjs}"],
    exclude: ["node_modules/**", "dist/**", "test/**/*.e2e.ts", "release/**", "release-assets/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx,cts,mjs}"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx,cts,mjs}", "src/**/*.d.{ts,mts}"],
      reporter: ["text-summary", "json", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
