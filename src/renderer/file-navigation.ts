import type { DesktopApi, Snapshot } from "../bridge/index.js";

/** Refresh the allowlisted inventory before following a session or worktree link. */
export async function prepareFileNavigation(
  api: Pick<DesktopApi, "poll" | "snapshot">,
  scope: Pick<Snapshot, "database" | "directory">,
  root: string,
): Promise<Snapshot | null> {
  if (!scope.directory) throw new Error("Open a project to browse files.");
  if (root !== scope.directory) await api.poll(["worktrees"]);
  const latest = await api.snapshot();
  // A delayed read must not navigate a different project or database.
  if (latest.database !== scope.database || latest.directory !== scope.directory) return null;
  if (root !== latest.directory && !latest.worktrees?.worktrees.some((item) => item.path === root))
    throw new Error("This worktree is no longer available in the open project.");
  return latest;
}
