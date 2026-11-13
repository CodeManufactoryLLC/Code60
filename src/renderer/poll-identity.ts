import type { Polling, ProjectRequestIdentity } from "../bridge/index.js";

/** Use the displayed source address, never fetch a replacement epoch before Refresh. */
export function pollRequestIdentity(polling: Polling): ProjectRequestIdentity | undefined {
  const target = polling.sources.find((source) => source.scope?.kind === "target")?.scope;
  const database = polling.sources.find((source) => source.scope?.kind === "database")?.scope;
  if (!target && !database) return undefined;
  return {
    projectId: target?.id,
    databaseEpoch: database ? Number(database.id) : undefined,
  };
}
