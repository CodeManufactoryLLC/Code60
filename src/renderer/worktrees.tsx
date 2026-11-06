import type { Rectangle } from "@glideapps/glide-data-grid";
import { useMemo } from "react";
import type { PollState, WorktreeListing } from "../bridge/index.js";
import { DataTable, type TableOptions } from "./data-table.js";

type GitWorktree = WorktreeListing["worktrees"][number];

interface WorktreeRow extends GitWorktree {
  id: string;
  repository: string;
}

const columns = [
  { key: "path", title: "Worktree", width: 360 },
  { key: "branch", title: "Branch", width: 180 },
  { key: "createdAt", title: "Created", width: 180, filter: "date" },
  { key: "repository", title: "Repository", width: 180 },
  { key: "sizeBytes", title: "Size", width: 110, filter: "number" },
] satisfies {
  key: keyof WorktreeRow & string;
  title: string;
  width: number;
  filter?: "date" | "number";
}[];

const date = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });
const size = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];

export function formatWorktreeSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = "B";
  for (const candidate of units) {
    value /= 1024;
    unit = candidate;
    if (value < 1024) break;
  }
  return `${size.format(value)} ${unit}`;
}

const display = (row: WorktreeRow, key: keyof WorktreeRow & string): string => {
  switch (key) {
    case "branch":
      return row.branch ?? "Detached HEAD";
    case "createdAt":
      return row.createdAt ? date.format(new Date(row.createdAt)) : "Unknown";
    case "sizeBytes":
      return formatWorktreeSize(row.sizeBytes);
    default:
      return String(row[key]);
  }
};

export function WorktreesPage({
  listing,
  pollState,
  directory,
  workspace,
  lines,
  density,
  fit,
  textStyles,
  onActions,
}: Pick<TableOptions, "workspace" | "lines" | "density" | "fit" | "textStyles"> & {
  listing: WorktreeListing | null;
  pollState: PollState | undefined;
  directory: string | null;
  onActions(path: string, bounds: Rectangle): void;
}) {
  const currentListing = listing;
  const currentError = pollState?.lastError;
  const loading = pollState?.status === "polling";
  const rows = useMemo(
    () =>
      (currentListing?.worktrees ?? []).map((worktree) => ({
        ...worktree,
        id: worktree.path,
        repository: currentListing?.repository ?? "",
      })),
    [currentListing],
  );

  return (
    <main className="sessions" aria-label="Worktrees" data-heading-lines={lines.heading}>
      {loading && (
        <p className="configuration-empty muted" role="status">
          Reading worktrees and calculating file sizes…
        </p>
      )}
      {currentError && (
        <div className="error-banner" role="alert">
          {currentError}
        </div>
      )}
      {!directory && !loading && (
        <p className="configuration-empty muted">Open a project to view its worktrees.</p>
      )}
      {directory && currentListing?.repository === null && !loading && (
        <p className="configuration-empty muted">This project is not a Git repository.</p>
      )}
      {directory && currentListing?.repository && rows.length === 0 && !loading && (
        <p className="configuration-empty muted">No worktrees were found.</p>
      )}
      {directory && currentListing?.repository && (
        <DataTable
          tableId="worktrees"
          workspace={workspace}
          rows={rows}
          columns={columns}
          display={display}
          initialSort="createdAt"
          initialDescending
          selected={undefined}
          onSelect={() => {}}
          onActions={onActions}
          lines={lines}
          density={density}
          fit={fit}
          textStyles={textStyles}
          align={(key) => (key === "sizeBytes" ? "right" : "left")}
        />
      )}
    </main>
  );
}
