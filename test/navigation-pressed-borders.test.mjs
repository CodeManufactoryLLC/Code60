import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("paints the sidebar selection edge only once, on the stationary row overlay", () => {
  const css = readFileSync(
    new URL("../src/renderer/styles/navigation.css", import.meta.url),
    "utf8",
  );
  expect(css.match(/box-shadow:\s*inset var\(--rule-select\) 0 var\(--accent\)/g)).toHaveLength(1);
  const overlay = css.match(/\.sidebar \[data-nav-active="true"\]::after\s*\{([^}]+)}/)?.[1];
  expect(overlay).toContain("position: absolute");
  expect(overlay).toContain("pointer-events: none");
  expect(overlay).toContain("box-shadow: inset var(--rule-select)");
});
