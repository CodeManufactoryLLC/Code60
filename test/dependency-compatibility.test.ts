import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

interface MatcherExports {
  Minimatch: new (pattern: string) => { match(path: string): boolean };
  minimatch: (path: string, pattern: string, options: { matchBase: boolean }) => boolean;
}

// These scoped overrides cross major versions. Exercise the APIs their callers use.
describe("minimatch override compatibility", () => {
  it.each(["@linaria/react", "@wyw-in-js/shared"])(
    "%s resolves the patched matcher with CommonJS named exports",
    (parent) => {
      const fromParent = createRequire(require.resolve(parent));
      const { version } = fromParent("minimatch/package.json") as { version: string };
      const { Minimatch, minimatch } = fromParent("minimatch") as MatcherExports;
      expect(version).toBe("11.0.1");
      expect(new Minimatch("src/**/*.{ts,tsx}").match("src/renderer/main.tsx")).toBe(true);
      expect(new Minimatch("!**/*.test.ts").match("src/example.test.ts")).toBe(false);
      expect(minimatch("Contents/Frameworks/helper.dylib", "*.dylib", { matchBase: true })).toBe(
        true,
      );
      expect(minimatch("Contents/Info.plist", "*.dylib", { matchBase: true })).toBe(false);
    },
  );

  it("preserves Linaria feature glob rules and exclusions", () => {
    const { isFeatureEnabled } = require("@wyw-in-js/shared") as typeof import("@wyw-in-js/shared");
    const features = { feature: ["src/**/*.tsx", "!**/*.test.tsx"] };
    expect(isFeatureEnabled(features, "feature", "src/component.tsx")).toBe(true);
    expect(isFeatureEnabled(features, "feature", "src/component.test.tsx")).toBe(false);
    expect(isFeatureEnabled(features, "feature", "other/component.tsx")).toBe(false);
  });
});
