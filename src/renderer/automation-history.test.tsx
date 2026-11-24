import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { AutomationHistoryEntry } from "../bridge/index.js";
import { AutomationHistory, historyRows } from "./automation-history.js";

const row = (
  id: string,
  sequence: number,
  changes: Partial<AutomationHistoryEntry> = {},
): AutomationHistoryEntry => ({
  id,
  sequence,
  automationId: "job",
  automationName: "Checks",
  status: "finished",
  scheduledFor: null,
  startedAt: "2026-11-23T10:00:00Z",
  endedAt: null,
  reason: null,
  denials: 0,
  runId: null,
  ...changes,
});
it("sorts timestamps and denied-request numbers without mutating backend page order", () => {
  const rows = [
    row("a", 1),
    row("b", 2, { startedAt: "2026-11-23T11:00:00Z", denials: 12 }),
    row("c", 3, { startedAt: null, denials: 2 }),
  ];
  expect(historyRows(rows, "", "startedAt", true).map((r) => r.id)).toEqual(["b", "a", "c"]);
  expect(historyRows(rows, "", "denials", false).map((r) => r.id)).toEqual(["a", "c", "b"]);
  expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
});
it("searches only supplied evidence across names, statuses, raw and display values", () => {
  const rows = [
    row("a", 1),
    row("b", 2, { automationName: "Weekly build", reason: "turn_timeout" }),
  ];
  expect(historyRows(rows, " WEEKLY ", "status", false).map((r) => r.id)).toEqual(["b"]);
  expect(historyRows(rows, "turn timeout", "status", false).map((r) => r.id)).toEqual(["b"]);
  expect(historyRows(rows, "turn_timeout", "status", false).map((r) => r.id)).toEqual(["b"]);
  expect(historyRows(rows, "missing", "status", false)).toEqual([]);
  expect(historyRows(rows, "", "status", true).map((r) => r.id)).toEqual(["a", "b"]);
});
it("exposes single selection, sortable headers and an explicit empty state", () => {
  const html = renderToStaticMarkup(
    <AutomationHistory rows={[row("a", 1)]} selected="a" onSelect={() => {}} />,
  );
  expect(html).toContain('type="radio"');
  expect(html).toContain('checked=""');
  expect(html).toContain('aria-sort="descending"');
  expect(html).toContain("Select execution Checks 1");
  expect(
    renderToStaticMarkup(<AutomationHistory rows={[]} selected={undefined} onSelect={() => {}} />),
  ).toContain("No executions yet.");
});
