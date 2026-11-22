import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import {
  pageDefinitions,
  pages,
  settingsIcons,
  settingsLabels,
  settingsSectionIds,
} from "./navigation.js";
import { PageTitle, PageTitleNavigationContext } from "./page-title.js";
import { SettingsHeader } from "./settings-layout.js";

it("shares each page and Settings section's navigation icon with its heading", () => {
  for (const page of pages) {
    const html = renderToStaticMarkup(
      <PageTitle page={page.id} id="title" className="table-title" />,
    );
    expect(html).toContain('<h1 id="title" class="page-title table-title">');
    expect(html).toContain(`data-icon="${pageDefinitions[page.id].icon}"`);
    expect(html).toContain(
      `<span class="page-title-text${page.id === "home" ? " sr-only" : ""}">${page.label}</span>`,
    );
    expect(html.indexOf('class="navigation-icon"')).toBeLessThan(
      html.indexOf('class="page-title-text'),
    );
  }
  for (const page of settingsSectionIds) {
    const html = renderToStaticMarkup(<SettingsHeader page={page} />);
    expect(html).toContain('<h1 class="page-title">');
    expect(html).toContain(`data-icon="${settingsIcons[page]}"`);
    expect(html).toContain(`<span class="page-title-text">${settingsLabels[page]}</span>`);
  }
});

it.each(["memories", "rag"] as const)(
  "keeps the non-Settings %s header at its existing level",
  (page) => {
    const html = renderToStaticMarkup(<SettingsHeader page={page} />);
    expect(html).toContain('<h2 class="page-title">');
    expect(html).not.toContain("<h1");
  },
);

it.each([
  ["relay", "app-steering-wheel"],
  ["orchestrator", "app-communication"],
  ["worker", "app-down-right"],
] as const)("keeps the %s heading decorative beside a safe dynamic title", (page, icon) => {
  const html = renderToStaticMarkup(
    <PageTitle page={page} as="h2">
      {"<custom title>"}
    </PageTitle>,
  );
  expect(html).toContain('<h2 class="page-title">');
  expect(html).toContain(`data-icon="${icon}"`);
  expect(html).toContain('alt="" aria-hidden="true" draggable="false"');
  expect(html).toContain(
    page === "relay"
      ? "&lt;custom title&gt;"
      : page === "orchestrator"
        ? ">Agent</span>"
        : ">Subagent</span>",
  );
  if (page !== "relay") expect(html).not.toContain("&lt;custom title&gt;");
  expect(html).toContain('aria-label="Breadcrumb"');
  expect(html).toContain('aria-current="page"');
  expect(html).not.toMatch(/tabindex|<custom title>/);
});

it.each([
  ["about", ["Settings"], ["app-cogwheel", "app-info"]],
  ["logs", ["Apps", "Data Viewer"], ["app-apps", "app-database", "app-table"]],
  [
    "rag",
    ["Settings", "Advanced", "Experiments"],
    ["app-cogwheel", "app-analyze", "app-chemical", "flask"],
  ],
] as const)("renders clickable parents and a single current %s heading", (page, parents, icons) => {
  const open = vi.fn(async () => true);
  const html = renderToStaticMarkup(
    <PageTitleNavigationContext.Provider
      value={{
        open,
        pending: false,
        projects: [],
        chats: [],
        runs: [],
      }}
    >
      <PageTitle page={page} id="current" />
    </PageTitleNavigationContext.Provider>,
  );
  expect(html).toContain(
    '<nav data-slot="breadcrumb" class="page-breadcrumbs" aria-label="Breadcrumb"><ol data-slot="breadcrumb-list"',
  );
  expect(html.match(/class="breadcrumb-link(?: breadcrumb-home)?"/g)).toHaveLength(
    parents.length + 1,
  );
  expect(html.match(/class="carbon-icon breadcrumb-separator"/g)).toHaveLength(parents.length + 1);
  expect([...html.matchAll(/data-icon="([^"]+)"/g)].map((match) => match[1])).toEqual([
    "app-home2",
    ...icons,
  ]);
  expect(html).toContain('class="breadcrumb-link breadcrumb-home" title="Home"');
  expect(html).toContain('<span class="sr-only">Home</span>');
  expect(html).not.toContain('<span class="breadcrumb-text">Home</span>');
  let previous = -1;
  for (const parent of parents) {
    const index = html.indexOf(`<span class="breadcrumb-text">${parent}</span></button>`);
    expect(index).toBeGreaterThan(previous);
    previous = index;
  }
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html.match(/<h1\b/g)).toHaveLength(1);
  expect(open).not.toHaveBeenCalled();
});

it("retains ancestor icons without a navigation provider", () => {
  const html = renderToStaticMarkup(<PageTitle page="logs" />);
  expect(html.match(/class="breadcrumb-label(?: breadcrumb-home)?"/g)).toHaveLength(3);
  expect([...html.matchAll(/data-icon="([^"]+)"/g)].map((match) => match[1])).toEqual([
    "app-home2",
    "app-apps",
    "app-database",
    "app-table",
  ]);
  expect(html).not.toContain('class="breadcrumb-link"');
});

it("keeps the current Home heading icon-only and accessible without a duplicate root", () => {
  const html = renderToStaticMarkup(<PageTitle page="home" />);
  expect(html).toContain('<span class="page-title-text sr-only">Home</span>');
  expect(html.match(/data-icon="app-home2"/g)).toHaveLength(1);
  expect(html).not.toContain("breadcrumb-separator");
});

it("keeps standalone secondary headings and embedded rename buttons out of nested buttons", () => {
  const secondary = renderToStaticMarkup(<PageTitle page="memories" as="h2" breadcrumbs={false} />);
  expect(secondary).not.toContain("<nav");
  const html = renderToStaticMarkup(
    <PageTitle page="orchestrator">
      <button type="button">Rename safe title</button>
    </PageTitle>,
  );
  expect(html.match(/<button\b/g)).toHaveLength(1);
  expect(html).toContain('<span class="page-title-text"><button type="button">Agent</button>');
});
