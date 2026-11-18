import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const navigation = readFileSync(
  new URL("../src/renderer/styles/navigation.css", import.meta.url),
  "utf8",
);
const home = readFileSync(new URL("../src/renderer/styles/home.css", import.meta.url), "utf8");
function rule(selector) {
  const css = navigation.replace(/\/\*[\s\S]*?\*\//g, "");
  const match = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(
    ([, selectors]) => selectors.trim() === selector,
  );
  expect(match, `Missing ${selector}`).toBeDefined();
  return match?.[2] ?? "";
}

it("indents unopened and opened custom assistants through the shared label inset", () => {
  expect(rule("#assistants-pages")).toMatch(/--nav-indent:\s*var\(--nav-step\);/);
  const inset = rule("#custom-agent-pages .chat-sidebar-entry");
  expect(inset).toContain("var(--nav-item-padding)");
  expect(inset).toContain(
    "max(var(--nav-inset), calc(var(--nav-animated-scale, 2) * var(--button-size) + 8px))",
  );
  expect(inset).toContain("var(--nav-indent)");
  // Fixed text padding used a different origin from absolutely positioned icons.
  expect(`${navigation}\n${home}`).not.toMatch(
    /#custom-agent-pages[^{}]*\{[^{}]*\bpadding(?:-left|-inline(?:-start)?)?:/,
  );
});
it("keeps icon and text placement tied to the same font-aware inset with an eight-pixel gap", () => {
  expect(rule(".chat-sidebar-entry")).toMatch(/padding:\s*2px 8px 2px var\(--nav-label-inset\);/);
  expect(rule(".navigation-icon")).toContain(
    "left: calc(var(--nav-label-inset) - 1em * var(--nav-icon-scale) - 8px)",
  );
  expect(rule(".navigation-icon")).toContain("width: calc(1em * var(--nav-icon-scale))");
});
it("preserves a second indentation step for custom-agent workers", () => {
  expect(rule(".chat-worker-children")).toMatch(/--nav-indent:\s*calc\(var\(--nav-step\) \* 2\);/);
});
