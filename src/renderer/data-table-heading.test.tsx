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

it("gives ordinary tables a single text heading", () => {
  const html = renderToStaticMarkup(<TableHeading tableId="polling" />);
  expect(html).not.toContain('aria-label="Page navigation"');
  expect(html).toContain('<h1 class="content-page-title"');
  expect(html).not.toContain("data-icon=");
  expect(html).toContain('<span class="page-title-text">Polling</span>');
});
