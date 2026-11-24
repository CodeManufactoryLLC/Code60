import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { orderedRows } from "./data-table.js";
import { TablePreview } from "./table-preview.js";
import { defaultView } from "./table-view.js";
import { defaultTextStyles } from "./typography.js";

it("sorts roots stably by raw values without losing a selected row's identity or mixing children", () => {
  const rows = [
    { id: "b", count: 8 },
    { id: "child", count: 1, parent: "a" },
    { id: "a", count: 12 },
    { id: "c", count: 8 },
  ];
  const original = structuredClone(rows);
  expect(
    orderedRows(
      rows,
      { key: "count", desc: true },
      () => true,
      (row) => row.parent,
    ).map((row) => row.id),
  ).toEqual(["a", "b", "c"]);
  expect(
    orderedRows(
      rows,
      { key: "count", desc: false },
      (row) => row.count > 8,
      (row) => row.parent,
    ).map((row) => row.id),
  ).toEqual(["a"]);
  expect(rows).toEqual(original);
});
it("previews real Carbon table density, saved widths, order, hidden columns and line choices", () => {
  const view = {
    ...defaultView({
      lines: { horizontal: false, vertical: true, heading: true },
      density: "high",
      fit: false,
    }),
    order: ["b", "a"],
    hidden: ["c"],
    widths: { b: 320 },
  };
  const html = renderToStaticMarkup(
    <TablePreview
      tableId="logs"
      columns={[
        { key: "a", title: "First", width: 120 },
        { key: "b", title: "Second", width: 160 },
        { key: "c", title: "Hidden", width: 80 },
      ]}
      view={view}
      actions
      textStyles={defaultTextStyles}
    />,
  );
  expect(html).toContain('aria-label="Table appearance preview"');
  expect(html).toContain("cds--data-table--sm");
  expect(html).not.toContain("<canvas");
  expect(html.indexOf(">Second<")).toBeLessThan(html.indexOf(">First<"));
  expect(html).not.toContain(">Hidden<");
  expect(html).toContain("width:320px");
  expect(html).toContain('data-horizontal="false"');
  expect(html).toContain('data-fit-columns="false"');
});
