import type { Rectangle } from "@glideapps/glide-data-grid";
import { useMemo } from "react";
import type { RunConfiguration } from "../bridge/index.js";
import { DataTable, type TableOptions } from "./data-table.js";

export function agentCount(configuration: RunConfiguration): number {
  return configuration.settings.agents.length === 1
    ? Number(configuration.settings.parallel ?? 1)
    : configuration.settings.agents.length;
}

export function providers(configuration: RunConfiguration): string {
  return [...new Set(configuration.settings.agents)].join(", ");
}

const columns = [
  { key: "name", title: "Name", width: 260 },
  { key: "provider", title: "Preset Provider", width: 220 },
  { key: "agents", title: "# Agents", width: 100, filter: "number" },
  { key: "uses", title: "Uses", width: 100, filter: "number" },
  { key: "lastUsed", title: "Last Used", width: 220, filter: "date" },
] satisfies {
  key: keyof ConfigurationRow;
  title: string;
  width: number;
  filter?: "date" | "number";
}[];

interface ConfigurationRow {
  id: string;
  name: string;
  provider: string;
  agents: number;
  uses: number;
  lastUsed: string;
}

const date = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });
const display = (row: ConfigurationRow, key: keyof ConfigurationRow) =>
  key === "lastUsed"
    ? row.lastUsed
      ? date.format(new Date(row.lastUsed))
      : "Never"
    : String(row[key]);
const align = (key: keyof ConfigurationRow) =>
  key === "agents" || key === "uses" ? ("right" as const) : ("left" as const);

export function ConfigurationsTable({
  configurations,
  ...options
}: TableOptions & {
  configurations: RunConfiguration[];
  onAdd(): void;
  addDisabled: boolean;
  onActions(id: string, bounds: Rectangle, contextual?: boolean): void;
}) {
  const rows = useMemo(
    () =>
      configurations.map((entry) => ({
        id: entry.id,
        name: entry.name,
        provider: providers(entry),
        agents: agentCount(entry),
        uses: entry.uses,
        lastUsed: entry.lastUsed ?? "",
      })),
    [configurations],
  );
  return (
    <DataTable
      {...options}
      addLabel="New run configuration"
      rows={rows}
      columns={columns}
      display={display}
      initialSort="name"
      align={align}
    />
  );
}
