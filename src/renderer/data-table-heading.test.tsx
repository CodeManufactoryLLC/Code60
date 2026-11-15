import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TableHeading } from "./data-table.js";

it.each([
  ["automations", "Schedules"],
  ["automation-history", "Execution history"],
] as const)("renders %s once as a compact, icon-free card heading", (tableId, title) => {
  const html = renderToStaticMarkup(<TableHeading tableId={tableId} />);
  expect(html).toBe(`<h2 class="table-card-title">${title}</h2>`);
});

it("retains page breadcrumbs and icons on ordinary tables", () => {
  const html = renderToStaticMarkup(<TableHeading tableId="polling" />);
  expect(html).toContain('aria-label="Breadcrumb"');
  expect(html).toContain('<h1 class="page-title table-title">');
  expect(html).toContain('data-icon="app-table"');
  expect(html).toContain('<span class="page-title-text">Polling</span>');
});
