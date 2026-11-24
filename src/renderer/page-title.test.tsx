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

it("puts every page's label in its sole content title without a breadcrumb menu", () => {
  for (const page of pages) {
    const html = renderToStaticMarkup(<PageTitle page={page.id} id="title" />);
    expect(html).toContain('<h1 id="title" class="content-page-title"');
    expect(html).not.toContain(`data-icon="${pageDefinitions[page.id].icon}"`);
    expect(html).toContain(`<span class="page-title-text">${page.label}</span>`);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/role="combobox"|<nav|<button/);
  }
  for (const page of settingsSectionIds) {
    const html = renderToStaticMarkup(<SettingsHeader page={page} />);
    expect(html).toContain('<h1 class="content-page-title"');
    expect(html).not.toContain(`data-icon="${settingsIcons[page]}"`);
    expect(html).toContain(`<span class="page-title-text">${settingsLabels[page]}</span>`);
  }
});

it.each(["memories", "rag"] as const)("preserves the %s secondary heading level", (page) => {
  const html = renderToStaticMarkup(<SettingsHeader page={page} />);
  expect(html).toContain('<h2 class="content-page-title"');
  expect(html).not.toContain("<h1");
});

it.each([
  ["relay", "app-steering-wheel"],
  ["orchestrator", "app-communication"],
  ["worker", "app-down-right"],
  ["project", "app-folder"],
  ["provider", "app-helmet"],
] as const)("uses a safe actual %s title without artwork", (page, icon) => {
  const html = renderToStaticMarkup(
    <PageTitle page={page} as="h2">
      {"<custom title>"}
    </PageTitle>,
  );
  expect(html).not.toContain(`data-icon="${icon}"`);
  expect(html).not.toContain("<img");
  expect(html).toContain('<span class="page-title-text">&lt;custom title&gt;</span>');
  expect(html).not.toMatch(/<custom title>|role="combobox"/);
});

it("preserves pending header ownership and commands without creating navigation controls", () => {
  const run = vi.fn();
  const html = renderToStaticMarkup(
    <PageTitleNavigationContext value={{ selectionPending: true }}>
      <PageTitle page="logs" actions={[{ id: "refresh", label: "Refresh", run }]} />
    </PageTitleNavigationContext>,
  );
  expect(html).toContain('<header class="content-page-heading" inert=""');
  expect(html).toContain('aria-label="Logs actions"');
  expect(html).not.toContain('role="combobox"');
  expect(run).not.toHaveBeenCalled();
});

it("preserves standalone headings while extracting embedded title text without a rename button", () => {
  const secondary = renderToStaticMarkup(<PageTitle page="memories" as="h2" breadcrumbs={false} />);
  expect(secondary).toContain('<h2 class="page-title"');
  expect(secondary).not.toContain("content-page-heading");
  const html = renderToStaticMarkup(
    <PageTitle page="orchestrator">
      <button type="button">Named chat</button>
    </PageTitle>,
  );
  expect(html).toContain('<span class="page-title-text">Named chat</span>');
  expect(html).not.toContain("<button");
});
