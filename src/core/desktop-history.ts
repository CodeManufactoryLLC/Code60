import type { RecordStore } from "./records.js";

/** Existing IDs keep their original store; only newly created runs use the repository store. */
export function withDirectoryHistory(primary: RecordStore, legacy: RecordStore): RecordStore {
  const transcriptOwners = new Map<string, RecordStore>();
  const sources = async (strict = false) => {
    const [current, previous] = await Promise.all([primary.list(strict), legacy.list(strict)]);
    const ids = new Set(current.map((record) => record.id));
    if (previous.some((record) => ids.has(record.id)))
      throw new Error("Conflicting run IDs in project history stores");
    transcriptOwners.clear();
    for (const record of current) transcriptOwners.set(record.id, primary);
    for (const record of previous) transcriptOwners.set(record.id, legacy);
    return { current, previous };
  };
  const owner = async (id: string) => {
    const { previous } = await sources();
    return previous.some((record) => record.id === id) ? legacy : primary;
  };
  return {
    dir: primary.dir,
    save: async (record) => (await owner(record.id)).save(record),
    appendEvent: async (event) => (await owner(event.runId)).appendEvent(event),
    read: async (id) => (await owner(id)).read(id),
    // A listing already pinned each transcript's store. Mutations still recheck both stores.
    readEvents: async (id) => (transcriptOwners.get(id) ?? (await owner(id))).readEvents(id),
    list: async (strict = false) => {
      const { current, previous } = await sources(strict);
      return [...current, ...previous].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },
  };
}
