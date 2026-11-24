import { fileURLToPath } from "node:url";
import { compile } from "sass";
import { expect, it } from "vitest";

it("keeps Scheduled Jobs layout scoped while reusing application Carbon controls and themes", () => {
  const { css } = compile(
    fileURLToPath(new URL("../src/renderer/carbon/scheduled-jobs.scss", import.meta.url)),
    {
      loadPaths: [fileURLToPath(new URL("../node_modules", import.meta.url))],
      logger: { warn: () => {}, debug: () => {} },
    },
  );
  expect(css).toContain("@layer carbon-app");
  expect(css).toContain(".carbon-scheduled-jobs");
  expect(css).not.toContain("data-jobs-screen");
  expect(css).not.toContain("all: revert");
  expect(css).not.toContain("@font-face");
  expect(css).not.toMatch(/(?:url\(|@import)[^;\n]*https?:/);
  expect(css).not.toMatch(/(?:^|\n)(?:body|html|:root|\.cds--)[^{]*\{/);
  expect(css).toContain("forced-colors: active");
  expect(css).toContain("prefers-reduced-motion: reduce");
});
