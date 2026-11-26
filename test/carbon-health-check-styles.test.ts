import { fileURLToPath } from "node:url";
import { compile } from "sass";
import { expect, it } from "vitest";

it("keeps Health Check layout scoped to Carbon tokens, type styles, and reduced-motion/high-contrast rules", () => {
  const { css } = compile(
    fileURLToPath(new URL("../src/renderer/carbon/health-check.scss", import.meta.url)),
    {
      loadPaths: [fileURLToPath(new URL("../node_modules", import.meta.url))],
      logger: { warn: () => {}, debug: () => {} },
    },
  );
  expect(css).toContain("@layer carbon-app");
  expect(css).toContain(".health-check-page");
  expect(css).not.toContain("all: revert");
  expect(css).not.toContain("@font-face");
  expect(css).not.toMatch(/(?:url\(|@import)[^;\n]*https?:/);
  expect(css).not.toMatch(/(?:^|\n)(?:body|html|:root|\.cds--)[^{]*\{/);
  expect(css).toContain("forced-colors: active");
  expect(css).toContain("prefers-reduced-motion: reduce");
});
