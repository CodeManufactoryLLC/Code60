import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

interface MatcherExports {
  Minimatch: new (pattern: string) => { match(path: string): boolean };
  minimatch: (path: string, pattern: string, options: { matchBase: boolean }) => boolean;
}

// These scoped overrides cross major versions. Exercise the APIs their callers use.
describe("minimatch override compatibility", () => {
  it.each(["@linaria/react", "@wyw-in-js/shared", "@electron/universal", "app-builder-lib"])(
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

  it.each([
    ["glob", "3.1.5"],
    ["@electron/asar", "3.1.5"],
    ["dir-compare", "3.1.5"],
    ["filelist", "5.1.9"],
  ])("leaves the unaffected %s matcher unchanged", (parent, version) => {
    const fromParent = createRequire(require.resolve(parent));
    expect(fromParent("minimatch/package.json").version).toBe(version);
  });

  it("preserves Linaria feature glob rules and exclusions", () => {
    const { isFeatureEnabled } = require("@wyw-in-js/shared") as typeof import("@wyw-in-js/shared");
    const features = { feature: ["src/**/*.tsx", "!**/*.test.tsx"] };
    expect(isFeatureEnabled(features, "feature", "src/component.tsx")).toBe(true);
    expect(isFeatureEnabled(features, "feature", "src/component.test.tsx")).toBe(false);
    expect(isFeatureEnabled(features, "feature", "other/component.tsx")).toBe(false);
  });

  it("preserves electron-builder file inclusion, exclusions and dotfiles", () => {
    const { FileMatcher } =
      require("app-builder-lib/out/fileMatcher.js") as typeof import("app-builder-lib/out/fileMatcher.js");
    const source = resolve("fixture-project");
    const matcher = new FileMatcher(source, resolve("fixture-output"), (pattern) => pattern, [
      "dist/**/*",
      "!**/*.map",
      "!**/{test,tests,__tests__,fixtures,examples}/**/*",
      "package.json",
    ]);
    const filter = matcher.createFilter();
    const file = statSync(import.meta.filename);
    const directory = statSync(import.meta.dirname);
    expect(filter(join(source, "dist"), directory)).toBe(true);
    for (const path of ["dist/cli/main.js", "dist/renderer/.asset", "package.json"])
      expect(filter(join(source, path), file), path).toBe(true);
    for (const path of ["dist/main.js.map", "dist/test/fixture.js", "src/main.ts"])
      expect(filter(join(source, path), file), path).toBe(false);
  });
});
