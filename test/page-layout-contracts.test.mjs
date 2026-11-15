import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sheet = (name) =>
  readFileSync(new URL(`../src/renderer/styles/${name}.css`, import.meta.url), "utf8").replace(
    /\s+/g,
    " ",
  );
function rule(name, selector) {
  const css = readFileSync(new URL(`../src/renderer/styles/${name}.css`, import.meta.url), "utf8");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll(" ", "\\s+");
  const match = css.match(new RegExp(`^\\s*${escaped}\\s*\\{[^}]*`, "m"));
  expect(match, `${name}: ${selector}`).not.toBeNull();
  return match[0].replace(/\s+/g, " ");
}

it("keeps Relay and every outer page in the content track without feature-sheet overrides", () => {
  const directory = new URL("../src/renderer/styles/", import.meta.url);
  const placements = readdirSync(directory).flatMap((file) => {
    if (!file.endsWith(".css")) return [];
    const css = readFileSync(new URL(file, directory), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selector, declarations]) => {
      if (!selector.split(",").some((part) => part.trim().endsWith(".page-panel"))) return [];
      const column = declarations.match(/\bgrid-column\s*:\s*([^;}]+)/)?.[1].trim();
      return column ? [{ file, selector: selector.trim(), column }] : [];
    });
  });
  expect(placements).toEqual([{ file: "layout.css", selector: ".page-panel", column: "2" }]);
});

it("uses smaller constant-width navigation cards, smaller contents and wider gaps", () => {
  const cards = rule("home", ".home-cards");
  expect(cards).toContain("--navigation-card-width: 224px");
  expect(cards).toContain("repeat(auto-fit, var(--navigation-card-width))");
  expect(cards).toContain("justify-content: safe center");
  expect(cards).not.toContain("1fr");
  expect(cards).toContain("gap: 32px");
  expect(cards).toContain("max-width: 736px");
  expect(rule("home", ".home-card-art")).toContain("min-height: 72px");
  const art = rule("home", ".home-card-art .navigation-icon");
  expect(art).toContain("width: 36px");
  expect(art).toContain("height: 36px");
  expect(rule("home", ".home-card-name")).toContain(
    "max(8px, calc(var(--card-size, 22px) * 9 / 11))",
  );
});

it("rounds buttons and chat without rounding unrelated controls or dialogs", () => {
  expect(sheet("tokens")).toContain("--button-radius: 5px");
  expect(sheet("tokens")).toContain("--chat-radius: 5px");
  expect(sheet("tokens")).toContain("--ui-radius: 0");
  for (const [file, selector] of [
    ["base", "button"],
    ["base", '[role="button"]'],
    ["base", ".button-group > button"],
    ["files", ".file-column-resize"],
    ["chat", ".activity-display"],
  ])
    expect(rule(file, selector)).toContain("border-radius: var(--button-radius)");
  for (const [file, selector] of [
    ["chat", ".composer"],
    ["files", "#panel-chat"],
  ])
    expect(rule(file, selector)).toContain("border-radius: var(--chat-radius)");
  expect(sheet("base")).toContain('input[type="radio"] { border-radius: 50%; }');
  expect(rule("overlays", "dialog:not(.splash)")).toContain("border-radius: var(--ui-radius)");
});

it("preserves the doubled clearance with the persistent toggle in a header above breadcrumbs", () => {
  expect(rule("layout", ".app-workspace:has(> .sidebar)")).toContain(
    "grid-template-rows: var(--workspace-top-inset, var(--app-titlebar-height)) minmax(0, 1fr)",
  );
  expect(rule("layout", ".app-workspace")).toContain(
    "grid-template-columns: var(--sidebar-track-width) minmax(0, 1fr)",
  );
  expect(rule("layout", ".app-workspace")).toContain("row-gap: 0");
  expect(rule("layout", ".page-panel")).toContain("grid-column: 2");
  expect(rule("layout", ".page-panel")).toContain("grid-row: 2");
  expect(rule("layout", ".workspace-header")).toContain("grid-column: 2");
  expect(rule("layout", ".workspace-header")).toContain("grid-row: 1");
  expect(rule("navigation", ".sidebar")).toContain("grid-row: 2");
  expect(rule("layout", '.app:has(.sidebar[data-open="false"])')).toContain("--sidebar-reveal: 0");
  expect(rule("navigation", '.sidebar[data-open="false"]')).toContain("visibility: hidden");
  expect(rule("footer", '.app:has(.sidebar[data-open="false"]) .footer-sidebar')).toContain(
    "flex-basis: auto",
  );
});

it("animates sidebar reveal separately from resizing and respects accessible motion settings", () => {
  expect(rule("tokens", "@property --sidebar-reveal")).toContain('syntax: "<number>"');
  expect(rule("tokens", "@property --sidebar-reveal")).toContain("initial-value: 1");
  expect(rule("layout", ".app")).toContain("--sidebar-reveal var(--motion) var(--ease)");
  expect(rule("layout", ".app")).toContain(
    "--sidebar-track-width: calc(var(--sidebar-expanded-width) * var(--sidebar-reveal))",
  );
  expect(rule("layout", ".app-workspace")).not.toContain("transition:");
  expect(rule("navigation", ".sidebar")).toContain("opacity var(--motion) var(--ease)");
  expect(rule("navigation", ".sidebar")).toContain("visibility var(--motion) allow-discrete");
  expect(rule("navigation", '.sidebar[data-open="false"]')).toContain("opacity: 0");
  expect(sheet("accessibility")).toContain(
    "@media (prefers-reduced-motion: reduce), (forced-colors: active) { .app, .sidebar,",
  );
  expect(
    rule(
      "accessibility",
      ".sidebar :is(.page-group-pages, .project-chat-pages, .chat-worker-children)",
    ),
  ).toContain("transition: none");
});

it("keeps sidebar navigation square and generates its full-height divider only when open", () => {
  expect(rule("navigation", ".sidebar button")).toContain("border-radius: 0");
  expect(rule("navigation", '.sidebar [data-nav-active="true"]')).toContain("border-radius: 0");
  expect(rule("navigation", '.sidebar [data-nav-active="true"]::after')).toContain(
    "border-radius: inherit",
  );
  expect(rule("layout", '.app-workspace:has(> .sidebar[data-open="true"])::before')).toContain(
    'content: ""',
  );
  expect(sheet("layout")).not.toContain(".app-workspace:has(> .sidebar)::before");
});

it("aligns page-title blocks at the shared workspace origin instead of page-specific top padding", () => {
  for (const [file, selector] of [
    ["search", ".search-page"],
    ["automations", ".automations-page"],
    ["system-manager", ".system-manager-page"],
  ])
    expect(rule(file, selector)).toMatch(/padding: 0 var\(--page-padding\)/);
  for (const [file, selector] of [
    ["tables", ".table-controls"],
    ["settings", ".settings-section-header"],
    ["settings", ".settings-title"],
    ["search", ".memory-heading"],
    ["chat", ".orchestration-chat-heading"],
    ["navigation", ".page-breadcrumbs ol"],
  ])
    expect(rule(file, selector)).toContain("align-items: flex-start");
  expect(rule("tables", ".table-title")).toContain("/ 1.25");
});

it("keeps the Polling fieldset wrapper in the same 640px reading grid as other settings", () => {
  const prefix =
    '.settings-page > [role="tabpanel"] > .database-dependent-controls > .settings-section';
  expect(rule("settings", prefix)).toContain("minmax(0, 640px)");
  expect(rule("settings", `${prefix} > *`)).toContain("grid-column: 2");
  expect(rule("settings", `${prefix} > .settings-section-header:first-child`)).toContain(
    "grid-column: 1 / -1",
  );
  expect(rule("tables", ".sessions")).toContain("min-width: 0");
  expect(rule("tables", ".sessions")).toContain("max-width: 100%");
});

it("uses the existing card radius and independent Card Titles role for Automation tables", () => {
  expect(rule("automations", ".automation-table-card")).toContain(
    "border-radius: var(--card-radius)",
  );
  expect(rule("tables", ".table-card-title")).toContain("var(--card-size, 22px)");
  expect(rule("tables", ".table-card-title")).not.toContain("--title-size");
});

it("adds the shared header gap to content pages but excludes navigation-card and chat headers", () => {
  expect(sheet("tokens")).toContain("--page-header-gap: 24px");
  for (const [file, selector] of [
    ["automations", ".automation-page-heading"],
    ["settings", ".settings-section-header:has(.page-breadcrumbs)"],
    ["tables", ".table-controls:has(> .page-breadcrumbs):not(.home-page > .table-controls)"],
    ["search", ".search-page > .page-breadcrumbs"],
    ["search", ".memory-heading"],
    ["navigation", ".contributor-tools"],
  ])
    expect(rule(file, selector)).toContain("var(--page-header-gap)");
  expect(sheet("chat")).not.toContain("--page-header-gap");
});
