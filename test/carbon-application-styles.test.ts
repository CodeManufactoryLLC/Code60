import { fileURLToPath } from "node:url";
import { compile } from "sass";
import { expect, it } from "vitest";

it("builds Carbon themes and control foundations without global reset/fonts or exposing retained views", {
  timeout: 30_000,
}, () => {
  const { css } = compile(
    fileURLToPath(new URL("../src/renderer/carbon/application.scss", import.meta.url)),
    {
      loadPaths: [fileURLToPath(new URL("../node_modules", import.meta.url))],
      logger: { warn: () => {}, debug: () => {} },
    },
  );
  expect(css).toContain("@layer carbon-app");
  expect(css).toContain("--cds-background: #ffffff");
  expect(css).toContain("--cds-background: #161616");
  for (const component of [
    "accordion",
    "data-table",
    "toolbar-content",
    "pagination",
    "search",
    "menu",
    "dropdown",
    "toast-notification",
    "btn",
    "text-input",
    "text-area",
    "select",
    "checkbox",
    "radio-button",
    "toggle",
    "slider",
    "modal",
    "header",
    "side-nav",
    "icon-indicator",
    "structured-list",
  ])
    expect(css).toContain(`.carbon-app .cds--${component}`);
  expect(css.indexOf(".carbon-app [hidden]")).toBeGreaterThan(
    css.indexOf(".carbon-app .code60-surface"),
  );
  expect(css).not.toContain("@font-face");
  expect(css).not.toContain("all: revert");
  expect(css).not.toMatch(/(?:url\(|@import)[^;\n]*https?:/);
});
