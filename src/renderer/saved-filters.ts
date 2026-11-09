import { useState } from "react";
import { type ColumnFilter, type FilterKind, matchesColumn, type TableId } from "./table-view.js";

export interface FilterField {
  key: string;
  title: string;
  kind: FilterKind;
}
interface FilterCondition extends ColumnFilter {
  id: string;
  column: string;
  kind: FilterKind;
}
export interface SavedFilter {
  version: 1;
  id: string;
  name: string;
  mode: "all" | "any";
  conditions: FilterCondition[];
}
export interface FilterLibrary {
  version: 1;
  definitions: unknown[];
  active: string | null;
}
export const filterKey = (table: TableId, scope: string) =>
  `code60.filters.v1:${table}:${encodeURIComponent(scope)}`;
const emptyLibrary = (): FilterLibrary => ({ version: 1, definitions: [], active: null });
export function parseFilterLibrary(raw: string | null): { library: FilterLibrary; error: string } {
  if (raw === null) return { library: emptyLibrary(), error: "" };
  try {
    const value = JSON.parse(raw);
    if (
      value?.version !== 1 ||
      !Array.isArray(value.definitions) ||
      !(value.active === null || typeof value.active === "string")
    )
      throw new Error();
    const ids = value.definitions.map((item: unknown) => filterIdentity(item).id).filter(Boolean);
    if (new Set(ids).size !== ids.length) throw new Error();
    return { library: value, error: "" };
  } catch {
    return {
      library: emptyLibrary(),
      error:
        "Saved filters could not be read. Their stored data has been kept. Reset saved filters to replace it.",
    };
  }
}
export function filterIdentity(value: unknown): { id?: string; name: string } {
  if (!value || typeof value !== "object") return { name: "Invalid filter" };
  const entry = value as Record<string, unknown>;
  return {
    ...(typeof entry.id === "string" ? { id: entry.id } : {}),
    name: typeof entry.name === "string" ? entry.name : "Invalid filter",
  };
}
export function operators(kind: FilterKind): ColumnFilter["op"][] {
  return kind === "text"
    ? ["contains", "eq", "ne", "empty", "present"]
    : kind === "category"
      ? ["eq", "ne", "empty", "present"]
      : kind === "date"
        ? ["eq", "ne", "ge", "le", "recent", "older", "empty", "present"]
        : ["eq", "ne", "ge", "le", "empty", "present"];
}
/** Structurally readable v1 definitions can be repaired by explicit edits. */
export function editableFilter(value: unknown): value is SavedFilter {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SavedFilter>;
  return (
    item.version === 1 &&
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    (item.mode === "all" || item.mode === "any") &&
    Array.isArray(item.conditions) &&
    item.conditions.every(
      (rule) =>
        rule &&
        typeof rule.id === "string" &&
        typeof rule.column === "string" &&
        ["text", "date", "number", "category"].includes(rule.kind) &&
        typeof rule.op === "string" &&
        typeof rule.value === "string",
    )
  );
}

/** An incompatible definition never becomes a different predicate or a partial predicate. */
export function filterProblem(value: unknown, fields: readonly FilterField[]): string {
  if (!value || typeof value !== "object") return "Invalid filter definition.";
  const filter = value as Partial<SavedFilter>;
  if (filter.version !== 1) return "Unsupported filter version.";
  if (typeof filter.name !== "string" || !filter.name.trim()) return "Enter a filter name.";
  if (typeof filter.id !== "string" || !filter.id) return "Saved filter identifier is missing.";
  if (filter.mode !== "all" && filter.mode !== "any") return "Invalid match mode.";
  if (!Array.isArray(filter.conditions) || !filter.conditions.length)
    return "Add at least one condition.";
  if (new Set(filter.conditions.map((rule) => rule?.id)).size !== filter.conditions.length)
    return "Condition identifiers must be unique.";
  for (const rule of filter.conditions) {
    if (!rule || typeof rule !== "object" || typeof rule.id !== "string")
      return "Invalid condition.";
    const field = fields.find((field) => field.key === rule.column);
    if (!field) return `Column ${String(rule.column)} is no longer available.`;
    if (field.kind !== rule.kind)
      return `${field.title} has changed type. Edit this condition before applying.`;
    if (!operators(field.kind).includes(rule.op))
      return `Unsupported comparison for ${field.title}.`;
    if (typeof rule.value !== "string") return `Invalid value for ${field.title}.`;
    if (rule.op === "empty" || rule.op === "present") continue;
    if (!rule.value.trim()) return `Enter a value for ${field.title}.`;
    if (field.kind === "number" || rule.op === "recent" || rule.op === "older") {
      if (
        !Number.isFinite(Number(rule.value)) ||
        ((rule.op === "recent" || rule.op === "older") && Number(rule.value) < 0)
      )
        return `Enter a valid number for ${field.title}.`;
    } else if (field.kind === "date" && !Number.isFinite(Date.parse(rule.value)))
      return `Enter a valid date for ${field.title}.`;
  }
  return "";
}
export function matchesSavedFilter(
  filter: SavedFilter,
  get: (column: string) => { raw: unknown; text: string },
  now = Date.now(),
): boolean {
  const match = (rule: FilterCondition) => {
    const cell = get(rule.column);
    return matchesColumn(cell.raw, cell.text, rule.kind, rule, now);
  };
  return filter.mode === "all" ? filter.conditions.every(match) : filter.conditions.some(match);
}
export function useSavedFilters(table: TableId, scope: string) {
  const key = filterKey(table, scope);
  const read = () => {
    try {
      return { key, ...parseFilterLibrary(localStorage.getItem(key)) };
    } catch {
      return { key, library: emptyLibrary(), error: "Saved filter storage is unavailable." };
    }
  };
  const [stored, setStored] = useState(read);
  const current = stored.key === key ? stored : read();
  const update = (library: FilterLibrary) => {
    try {
      localStorage.setItem(key, JSON.stringify(library));
      setStored({ key, library, error: "" });
    } catch {
      setStored({
        key,
        library,
        error: "Filters could not be stored. Changes last until the app closes.",
      });
    }
  };
  return { ...current, update };
}
