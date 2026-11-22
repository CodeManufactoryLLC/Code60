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
    expect(html).toContain('<h1 id="title" class="page-title table-title"');
    expect(html).toContain(`data-icon="${pageDefinitions[page.id].icon}"`);
    expect(html).toContain(`<span class="page-title-text">${page.label}</span>`);
    expect(html.indexOf('class="navigation-icon"')).toBeLessThan(
      html.indexOf('class="page-title-text'),
    );
  }
  for (const page of settingsSectionIds) {
    const html = renderToStaticMarkup(<SettingsHeader page={page} />);
    expect(html).toContain('<h1 class="page-title"');
    expect(html).toContain(`data-icon="${settingsIcons[page]}"`);
    expect(html).toContain(`<span class="page-title-text">${settingsLabels[page]}</span>`);
  }
});

it.each(["memories", "rag"] as const)(
  "keeps the non-Settings %s header at its existing level",
  (page) => {
    const html = renderToStaticMarkup(<SettingsHeader page={page} />);
    expect(html).toContain('<h2 class="page-title"');
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
  expect(html).toContain('<h2 class="page-title"');
  expect(html).toContain(`data-icon="${icon}"`);
  expect(html).toContain('alt="" aria-hidden="true" draggable="false"');
  expect(html).toContain(
    page === "relay"
      ? "&lt;custom title&gt;"
      : page === "orchestrator"
        ? ">Agent</span>"
        : ">Subagent</span>",
  );
  expect(html).toContain('<h2 class="content-page-title">&lt;custom title&gt;</h2>');
  expect(html).toContain('aria-label="Page navigation"');
  expect(html).toContain('aria-current="page"');
  expect(html).not.toMatch(/tabindex|<custom title>/);
});

it.each(["about", "logs", "rag"] as const)(
  "replaces the %s trail with one current-page combobox and heading",
  (page) => {
    const open = vi.fn(async () => true);
    const html = renderToStaticMarkup(
      <PageTitleNavigationContext.Provider
        value={{ open, pending: false, projects: [], chats: [], runs: [] }}
      >
        <PageTitle page={page} id="current" />
      </PageTitleNavigationContext.Provider>,
    );
    expect(html).toContain('aria-label="Page navigation"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-label="Current page"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('class="breadcrumb-link');
    expect(html).not.toContain("breadcrumb-separator");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('id="current"');
    expect(open).not.toHaveBeenCalled();
  },
);

it("shows Home as the selected page with its label and single icon", () => {
  const html = renderToStaticMarkup(<PageTitle page="home" />);
  expect(html).toContain('<span class="page-title-text">Home</span>');
  expect(html.match(/data-icon="app-home2"/g)).toHaveLength(1);
  expect(html).not.toContain("breadcrumb-separator");
});

it("keeps a pending selection's visible selector disabled", () => {
  const html = renderToStaticMarkup(
    <PageTitleNavigationContext.Provider
      value={{
        open: vi.fn(),
        pending: true,
        selectionPending: true,
        projects: [],
        chats: [],
        runs: [],
      }}
    >
      <PageTitle page="relay" />
    </PageTitleNavigationContext.Provider>,
  );
  expect(html).toContain('disabled=""');
  expect(html).toContain('aria-expanded="false"');
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
  expect(html).toContain('<span class="page-title-text">Agent</span>');
  expect(html).not.toContain("page-selector-rename");
  expect(html).toContain('<h2 class="content-page-title">Rename safe title</h2>');
  expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/);
});
