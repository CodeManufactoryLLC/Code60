import type { DesktopApi, FileContext, Snapshot } from "../bridge/index.js";

export function sameFileContext(
  first: FileContext | null | undefined,
  second: FileContext | null | undefined,
): boolean {
  return (
    !!first &&
    !!second &&
    first.projectId === second.projectId &&
    first.databaseEpoch === second.databaseEpoch &&
    first.project === second.project &&
    first.root === second.root &&
    first.preview === second.preview &&
    (first.active ?? true) === (second.active ?? true) &&
    first.directories.length === second.directories.length &&
    first.directories.every((path, index) => path === second.directories[index])
  );
}

/** Project workers retain their bound file view, independent of Relay's selection. */
export function showsProjectFiles(
  snapshot: Pick<Snapshot, "chat" | "runs"> | undefined,
  workerId: string | undefined,
): boolean {
  if (!snapshot) return false;
  if (workerId) {
    const worker = snapshot.runs.find((run) => run.record.id === workerId);
    return !!worker && !worker.relay;
  }
  return snapshot.chat.kind !== "relay";
}

/** Legacy links always browse the project; discard navigation if its scope changed. */
export async function prepareFileNavigation(
  api: Pick<DesktopApi, "snapshot">,
  scope: Pick<Snapshot, "database" | "directory" | "projectInstanceId" | "databaseEpoch">,
  _root?: string,
): Promise<Snapshot | null> {
  if (!scope.directory) throw new Error("Open a project to browse files.");
  const latest = await api.snapshot();
  // A delayed read must not navigate a different project or database.
  if (
    latest.database !== scope.database ||
    latest.directory !== scope.directory ||
    (scope.projectInstanceId !== undefined &&
      latest.projectInstanceId !== scope.projectInstanceId) ||
    (scope.databaseEpoch !== undefined && latest.databaseEpoch !== scope.databaseEpoch)
  )
    return null;
  return latest;
}
