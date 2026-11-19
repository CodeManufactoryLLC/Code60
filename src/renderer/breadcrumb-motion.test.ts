import { expect, it } from "vitest";
import { matchBreadcrumbItems } from "./breadcrumb-motion.js";

const items = (...entries: [string, string][]) =>
  new Map(entries.map(([key, appearance]) => [key, { appearance }]));

it("keeps identical Agent breadcrumbs opaque when the conversation identity changes", () => {
  const matches = matchBreadcrumbItems(
    items(["home", "Home"], ["project:p", "Project"], ["conversation:a", "Agent"]),
    items(["home", "Home"], ["project:p", "Project"], ["conversation:b", "Agent"]),
  );
  expect([...matches]).toEqual([
    ["home", "home"],
    ["project:p", "project:p"],
    ["conversation:b", "conversation:a"],
  ]);
});

it("reserves retained identities before matching visually identical siblings", () => {
  expect([
    ...matchBreadcrumbItems(
      items(["a", "Subagent"], ["b", "Subagent"]),
      items(["c", "Subagent"], ["a", "Subagent"]),
    ),
  ]).toEqual([
    ["a", "a"],
    ["c", "b"],
  ]);
});

it("matches each old item once and leaves changed appearance to enter and exit", () => {
  expect([
    ...matchBreadcrumbItems(
      items(["a", "Agent"]),
      items(["b", "Agent"], ["c", "Agent"], ["d", "Subagent"]),
    ),
  ]).toEqual([["b", "a"]]);
});

it("retains an exact target while its text changes, without reusing it for another target", () => {
  expect([
    ...matchBreadcrumbItems(
      items(["a", "Old title"]),
      items(["a", "New title"], ["b", "Old title"]),
    ),
  ]).toEqual([["a", "a"]]);
});
