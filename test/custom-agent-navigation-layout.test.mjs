import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const navigation = readFileSync(
  new URL("../src/renderer/styles/navigation.css", import.meta.url),
  "utf8",
);
const home = readFileSync(new URL("../src/renderer/styles/home.css", import.meta.url), "utf8");
function rule(selector) {
  const css = navigation.replace(/\/\*[\s\S]*?\*\//g, "");
  const matches = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selectors]) =>
    selectors.split(",").some((part) => part.trim() === selector),
  );
  expect(matches.length, `Missing ${selector}`).toBeGreaterThan(0);
  return matches.map((match) => match[2]).join("\n");
}

it("aligns first-level assistants and indents their conversation groups through the shared inset", () => {
  expect(rule("#assistants-pages")).toMatch(/--nav-indent:\s*0px;/);
  const inset = rule("#custom-agent-pages .chat-sidebar-entry");
  expect(inset).toContain("var(--nav-item-padding)");
  expect(inset).toContain("var(--nav-inset)");
  expect(inset).toContain("var(--nav-indent)");
  // Fixed text padding used a different origin from absolutely positioned icons.
  expect(`${navigation}\n${home}`).not.toMatch(
    /#custom-agent-pages[^{}]*\{[^{}]*\bpadding(?:-left|-inline(?:-start)?)?:/,
  );
});
it("keeps icon and text placement tied to the same font-aware inset with an eight-pixel gap", () => {
  expect(rule(".chat-sidebar-entry")).toMatch(/padding:\s*2px 8px 2px 0;/);
  expect(rule(".navigation-icon")).toContain(
    "left: calc(var(--nav-label-inset) - 1em * var(--nav-icon-scale, 1) - 8px)",
  );
  expect(rule(".navigation-icon")).toContain("width: calc(1em * var(--nav-icon-scale, 1))");
});
it("preserves a second indentation step for custom-agent workers", () => {
  expect(rule(".chat-worker-children")).toMatch(/--nav-indent:\s*calc\(var\(--nav-step\) \* 2\);/);
});
