import type { RecordStore } from "./records.js";

/** Existing IDs keep their original store; only newly created runs use the repository store. */
export function withDirectoryHistory(primary: RecordStore, legacy: RecordStore): RecordStore {
  const sources = async (strict = false) => {
    const [current, previous] = await Promise.all([primary.list(strict), legacy.list(strict)]);
    const ids = new Set(current.map((record) => record.id));
    if (previous.some((record) => ids.has(record.id)))
      throw new Error("Conflicting run IDs in project history stores");
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
    readEvents: async (id) => (await owner(id)).readEvents(id),
    list: async (strict = false) => {
      const { current, previous } = await sources(strict);
      return [...current, ...previous].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },
  };
}
