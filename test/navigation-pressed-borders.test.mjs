import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("paints sidebar selection on a stationary row without a left accent edge", () => {
  const css = readFileSync(
    new URL("../src/renderer/styles/navigation.css", import.meta.url),
    "utf8",
  );
  expect(css).not.toMatch(/box-shadow:\s*inset var\(--rule-select\) 0 var\(--accent\)/);
  const row = css.match(/\.sidebar \[data-nav-active="true"\]\s*\{([^}]+)}/)?.[1];
  expect(row).toContain("position: relative");
  expect(row).toContain("background: var(--accent-bg)");
  expect(row).not.toContain("box-shadow");
});
