import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync(new URL("../src/renderer/styles/navigation.css", import.meta.url), "utf8");
function rule(selector) {
  const start = css.indexOf(`${selector} {`);
  expect(start, `Missing ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

it("removes generic button spacing from clickable and disabled chat titles", () => {
  const title = rule(".chat-title");
  expect(title).toMatch(/\bpadding:\s*0;/);
  expect(title).toMatch(/\bmin-height:\s*0;/);
  expect(title).toMatch(/\bdisplay:\s*block;/);
  expect(title).toMatch(/\bwhite-space:\s*normal;/);
});

it("sizes breadcrumb chevrons from the surrounding font rather than a fixed pixel size", () => {
  expect(rule(".breadcrumb-separator")).toMatch(/--icon-size:\s*1em;/);
});
