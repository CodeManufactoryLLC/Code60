import { randomUUID } from "node:crypto";
import { link, lstat, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  absoluteInstallationPath,
  createInstallationParents,
  createPrivateFileSync,
  installationDirectory,
  installationFileCode,
  removeOwnedInstallationFile,
  syncInstallationDirectory,
  userHome,
} from "../platform/index.js";
import type { DesktopPreferences } from "./preferences.js";
import { openProjectDatabase, SCHEMA } from "./projects.js";

export function setupDatabasePath(env: NodeJS.ProcessEnv) {
  const base = absoluteInstallationPath(env.XDG_DATA_HOME || join(userHome(env), ".local/share"));
  return join(base, "code60/databases/default.sqlite");
}
/** A read-only inspection: never initializes empty SQLite files or migrates schemas. */
export async function inspectSetupDatabase(path: string) {
  absoluteInstallationPath(path);
  await installationDirectory(dirname(path));
  const before = await lstat(path, { bigint: true });
  if (
    !before.isFile() ||
    before.nlink !== 1n ||
    before.uid !== BigInt(process.getuid?.() ?? -1) ||
    before.mode & 0o7022n
  )
    throw Error("Unsafe database file; existing data preserved");
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=2000");
    const values = new Map(
      db
        .prepare("SELECT key,value FROM code60_meta LIMIT 16")
        .all()
        .map((row) => [row.key, row.value]),
    );
    if (values.get("app") !== "code60") throw Error("Not a Code60 database");
    const schema = Number(values.get("schema"));
    if (schema > SCHEMA) throw Error("Database was created by a newer version of Code60");
    if (!Number.isInteger(schema) || schema < 1) throw Error("Unsupported Code60 database schema");
    for (const table of [
      "code60_projects",
      "code60_commands",
      "code60_run_configurations",
      "code60_prompt_templates",
    ])
      if (table === "code60_projects" || schema === SCHEMA)
        db.prepare(`SELECT * FROM ${table} LIMIT 0`).all();
    const after = await lstat(path, { bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino || after.ctimeNs !== before.ctimeNs)
      throw Error("Database identity changed during inspection");
  } finally {
    db.close();
  }
}
export async function prepareSetupDatabase(
  env: NodeJS.ProcessEnv,
  preferences: DesktopPreferences,
  connected?: string,
) {
  if (!preferences.selection || !preferences.selectInitial)
    throw Error("Strict database selection is unavailable");
  const selection = await preferences.selection();
  const path = selection.path ?? setupDatabasePath(env);
  if (connected && connected !== path)
    throw Error(
      "The connected database differs from saved selection; use the browser to resolve it",
    );
  if (!selection.path) {
    await createInstallationParents(dirname(path), true);
    const exists = await lstat(path).catch((error: unknown) => {
      if (installationFileCode(error) !== "ENOENT") throw error;
      return null;
    });
    if (!exists) {
      const temporary = join(dirname(path), `.code60-database-${randomUUID()}.sqlite`);
      createPrivateFileSync(temporary);
      const owned = await lstat(temporary, { bigint: true });
      try {
        openProjectDatabase(temporary, true).close();
        const file = await open(temporary, "r");
        try {
          await file.sync();
        } finally {
          await file.close();
        }
        await inspectSetupDatabase(temporary);
        await link(temporary, path).catch((error: unknown) => {
          if (installationFileCode(error) !== "EEXIST") throw error;
        });
      } finally {
        await removeOwnedInstallationFile(temporary, owned);
      }
      await syncInstallationDirectory(dirname(path));
    }
  }
  await inspectSetupDatabase(path);
  // Compare the entire private preference identity, preserving concurrent edits.
  if (!selection.path) await preferences.selectInitial(path, selection.identity);
  else if (
    JSON.stringify((await preferences.selection()).identity) !== JSON.stringify(selection.identity)
  )
    throw Error("Database selection changed during setup");
  return path;
}
