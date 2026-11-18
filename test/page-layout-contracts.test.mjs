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

it("centers one compact left-aligned blank-tab action group without stretching its rows", () => {
  expect(rule("files", ".file-panel-empty")).toContain("place-items: center");
  const group = rule("files", ".file-panel-empty-actions, .file-panel-saved-plans");
  for (const value of [
    "display: flex",
    "flex-direction: column",
    "align-items: flex-start",
    "gap: 8px",
    "max-width: 100%",
    "text-align: left",
  ])
    expect(group).toContain(value);
  expect(group).not.toContain("flex: 1");
  expect(rule("files", ".file-panel-empty-actions button")).toContain("text-align: left");
});

it("keeps project controls centered with one shared row fill and a corner removal icon", () => {
  expect(rule("overlays", ".project-dialog > .modal-heading")).toContain("border-bottom: 0");
  expect(rule("overlays", ".modal-heading")).toContain("border-bottom: 1px solid");
  expect(rule("overlays", ".project-open-folder")).toContain("align-self: center");
  expect(rule("overlays", ".project-open-folder")).toContain("margin-inline: auto");
  expect(rule("overlays", ".project-dialog")).toContain("scrollbar-gutter: stable both-edges");
  expect(rule("overlays", ".project-row")).toContain("position: relative");
  const remove = rule("overlays", ".project-remove");
  for (const value of ["position: absolute", "top: 4px", "right: 4px"])
    expect(remove).toContain(value);
  expect(rule("overlays", ".project-item")).toContain("padding-right: 40px");
  expect(rule("overlays", ".project-row:has(> button:hover:not(:disabled))")).toContain(
    "background: var(--hover-bg)",
  );
  expect(rule("overlays", ".project-row > .project-item:not(:disabled)")).toContain(
    "background: transparent",
  );
  expect(rule("overlays", ".project-row > .project-item:not(:disabled)")).toContain(
    "color: var(--text)",
  );
  expect(rule("chat", ".activity-name")).toContain("font-weight: var(--text-weight, 300)");
});

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
  expect(art).toContain("width: calc(36px * var(--nav-icon-scale))");
  expect(art).toContain("height: calc(36px * var(--nav-icon-scale))");
  expect(rule("home", ".home-card-name")).toContain(
    "max(8px, calc(var(--card-size, 22px) * 9 / 11))",
  );
});

it("rounds buttons, chat and dialogs without rounding unrelated controls", () => {
  expect(sheet("tokens")).toContain("--button-radius: 5px");
  expect(sheet("tokens")).toContain("--chat-radius: 5px");
  expect(sheet("tokens")).toContain("--dialog-radius: 5px");
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
  for (const selector of ["dialog:not(.splash)", '[role="dialog"]', ".setup-dialog"])
    expect(rule("overlays", selector)).toContain("border-radius: var(--dialog-radius)");
  for (const selector of ["[popover]", ".mode-menu"])
    expect(rule("overlays", selector)).toContain("border-radius: var(--ui-radius)");
});

it("uses solid rounded human bubbles without rounding automatic prompts or code", () => {
  const bubble = rule("chat", ".event.prompt:where(:not(.automatic)) pre");
  expect(bubble).toContain("background: var(--user-bubble)");
  expect(bubble).toContain("border-radius: var(--chat-radius)");
  expect(bubble).toContain("color: var(--on-user-bubble)");
  expect(rule("accessibility", ".event.prompt:not(.automatic) pre")).toContain(
    "background: Canvas",
  );
});

it("compacts response-to-timing spacing while retaining separation before the next turn", () => {
  expect(rule("chat", ".orchestration-chat-body .event.message")).toContain("margin-bottom: 8px");
  expect(rule("chat", ".turn-timer")).toContain("margin: 4px 0");
  expect(rule("chat", ".turn-separator")).toContain("margin: 4px 0 12px");
});

it("preserves the doubled clearance with the persistent toggle in the native-control row", () => {
  expect(rule("layout", ".app-workspace:has(> .sidebar)")).toContain(
    "minmax(var(--workspace-top-inset, var(--app-titlebar-height)), max-content) minmax(0, 1fr)",
  );
  expect(rule("layout", ".app-workspace")).toContain(
    "grid-template-columns: var(--sidebar-track-width) minmax(0, 1fr)",
  );
  expect(rule("layout", ".app-workspace")).toContain("row-gap: 0");
  expect(rule("layout", ".page-panel")).toContain("grid-column: 2");
  expect(rule("layout", ".page-panel")).toContain("grid-row: 2");
  expect(rule("layout", ".workspace-header")).toContain("grid-column: 1 / -1");
  expect(rule("layout", ".workspace-header")).toContain("grid-row: 1");
  expect(rule("layout", ".workspace-header")).toContain("align-items: flex-start");
  expect(rule("layout", ".workspace-header")).toContain("padding: 0");
  expect(rule("navigation", ".sidebar")).toContain("grid-row: 2");
  expect(rule("layout", '.app:has(.sidebar[data-open="false"])')).toContain("--sidebar-reveal: 0");
  expect(rule("navigation", '.sidebar[data-open="false"]')).toContain("visibility: hidden");
  expect(rule("footer", '.app:has(.sidebar[data-open="false"]) .footer-sidebar')).toContain(
    "flex-basis: auto",
  );
});

it("centers the non-draggable toggle in the native title bar without occupying page layout space", () => {
  const toggle = rule("navigation", ".sidebar-toggle");
  expect(toggle).toContain("position: fixed");
  expect(toggle).toContain(
    "top: calc((var(--app-titlebar-height) - var(--sidebar-toggle-width)) / 2)",
  );
  expect(toggle).toContain("left: max(80px, calc(var(--titlebar-left) + 8px))");
  expect(toggle).toContain("-webkit-app-region: no-drag");
});

it("matches the toggle to footer glyphs and keeps project/chat label colors stable", () => {
  for (const [file, selector] of [
    ["navigation", ".sidebar-toggle"],
    ["footer", ".footer-sidebar > .icon-button"],
  ])
    expect(rule(file, selector)).toContain("color: var(--muted)");
  for (const selector of [".chat-page-heading", ".project-chat-heading", ".chat-sidebar-row"])
    expect(rule("navigation", selector)).toContain("color: var(--text)");
  expect(rule("navigation", ".chat-page-heading .page-group-toggle:not(:disabled)")).toContain(
    "color: inherit",
  );
  expect(sheet("navigation")).toContain(
    ".sidebar .chat-sidebar-row > .chat-sidebar-entry:not(:disabled), .sidebar .project-chat-heading > .project-chat-name:not(:disabled) { color: inherit;",
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

it("keeps sidebar navigation square and borderless, without a full-height divider", () => {
  expect(rule("navigation", ".sidebar button")).toContain("border-radius: 0");
  expect(rule("navigation", '.sidebar [data-nav-active="true"]')).toContain("border-radius: 0");
  expect(rule("navigation", '.sidebar [data-nav-active="true"]::after')).toContain(
    "border-radius: inherit",
  );
  expect(rule("navigation", ".sidebar")).toContain("border: 0");
  expect(sheet("layout")).not.toMatch(/\.app-workspace:has\([^}]+::before/);
});

it("moves the visible trail into the header without reserving the original title space", () => {
  expect(rule("layout", ".workspace-header")).toContain(
    "grid-template-columns: var(--sidebar-track-width) minmax(0, 1fr)",
  );
  expect(rule("layout", ".workspace-breadcrumbs")).toContain("grid-column: 2");
  expect(rule("layout", ".workspace-breadcrumbs")).toContain("-webkit-app-region: no-drag");
  expect(rule("navigation", ".page-title-placeholder")).toContain("display: none");
  expect(rule("chat", ".worker-chat-identity .worker-chat-subtitle")).toContain(
    "calc(var(--page-title-space-size, 64px) + 8px)",
  );
});

it("centers the header trail across the window only while the sidebar is closed", () => {
  const selector = '.app-workspace:has(> .sidebar[data-open="false"]) .workspace-breadcrumbs';
  const centered = rule("layout", selector);
  expect(centered).toContain("grid-column: 1 / -1");
  expect(centered).toContain("display: flex");
  expect(centered).toContain("justify-content: safe center");
  expect(centered).toContain("margin-left: calc(var(--page-margin) - var(--sidebar-left-inset))");
  expect(rule("layout", `${selector} ol`)).toContain("justify-content: safe center");
  expect(rule("navigation", ".page-breadcrumbs ol")).toContain("flex-wrap: wrap");
  expect(rule("layout", ".workspace-breadcrumbs")).toContain("grid-column: 2");
  expect(rule("layout", ".workspace-breadcrumbs")).not.toContain("justify-content: center");
});

it("shares normal card geometry with thick dashed creation cards and a centered label", () => {
  const create = rule("home", ".home-card-create");
  expect(create).toContain("border: 3px dashed var(--control-border)");
  expect(create).toContain("background: transparent");
  expect(create).toContain("align-items: center");
  expect(create).toContain("justify-content: center");
  expect(create).toContain("min-height: 160px");
  expect(create).not.toContain("gradient");
  expect(rule("home", ".home-card")).toContain("border-radius: var(--card-radius)");
  expect(rule("home", ".home-card-create .home-card-name")).toContain("text-align: center");
  expect(rule("home", ".home-card-create .carbon-icon")).toContain("width: 1em");
});

it("keeps the sidebar on the app surface and gray composers independent in both palettes", () => {
  expect(rule("navigation", ".sidebar")).toContain("background: var(--surface)");
  expect(rule("navigation", ".sidebar")).toContain("--control-fill: var(--surface)");
  expect(rule("chat", ".composer")).toContain("background: var(--composer-bg)");
  expect(rule("chat", ".composer")).toContain("border: 0");
  expect(rule("chat", ".composer")).toContain("padding: 1px");
  expect(rule("chat", ".composer:focus-within")).toContain("background: var(--composer-focus-bg)");
  expect(rule("chat", ".composer:focus-within")).not.toContain("border-color:");
  expect(rule("chat", ".orchestration-chat-body .composer")).not.toContain("border:");
  for (const token of ["--composer-bg", "--composer-focus-bg"])
    expect(sheet("tokens").match(new RegExp(`${token}:`, "g"))).toHaveLength(2);
  expect(sheet("accessibility")).toContain("outline: 2px solid Highlight");
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
  ])
    expect(rule(file, selector)).toContain("align-items: flex-start");
  expect(rule("tables", ".table-title")).toContain("/ 1.25");
});

it("aligns breadcrumb items and underlines only the current page, including rename controls and Home", () => {
  expect(rule("navigation", ".page-breadcrumbs ol")).toContain("align-items: center");
  const current = rule(
    "navigation",
    '.page-breadcrumbs [aria-current="page"] :is(.page-title-text, .chat-title)',
  );
  expect(current).toContain("text-decoration: underline");
  expect(current).toContain("text-underline-offset: 0.15em");
  expect(
    rule(
      "navigation",
      '.page-breadcrumbs [aria-current="page"] .page-title:has(> .sr-only)::after',
    ),
  ).toContain("border-bottom: 1px solid currentColor");
  expect(rule("chat", ".orchestration-chat-status:empty")).toContain("display: none");
});

it("centers the Home welcome above its cards without clipping on short windows", () => {
  expect(rule("home", ".home-welcome")).toContain("margin: auto auto 24px");
  expect(rule("home", ".home-welcome")).toContain("flex-shrink: 0");
  expect(rule("home", ".home-welcome + .home-cards")).toContain("margin-top: 0");
  expect(rule("home", ".home-content")).toContain("overflow: auto");
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
    [
      "tables",
      ".table-controls:has(> .page-breadcrumbs:not(.page-title-placeholder)):not( .home-page > .table-controls )",
    ],
    ["search", ".search-page > .page-breadcrumbs"],
    ["search", ".memory-heading"],
    ["navigation", ".contributor-tools"],
  ])
    expect(rule(file, selector)).toContain("var(--page-header-gap)");
  expect(sheet("chat")).not.toContain("--page-header-gap");
});
