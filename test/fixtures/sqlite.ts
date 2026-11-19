import type { DatabaseSync } from "node:sqlite";

/** Node 22.12 exposes SQLite with a flag but does not bundle the FTS5 module. */
export function sqliteFtsAvailable(
  open: () => Pick<DatabaseSync, "exec" | "close"> | undefined = () => {
    const sqlite = process.getBuiltinModule("node:sqlite");
    return sqlite ? new sqlite.DatabaseSync(":memory:") : undefined;
  },
): boolean {
  let database: ReturnType<typeof open>;
  try {
    database = open();
    if (!database) return false;
    database.exec("CREATE VIRTUAL TABLE feature_probe USING fts5(content)");
    return true;
  } catch {
    return false;
  } finally {
    database?.close();
  }
}
