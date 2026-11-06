import { readFileSync } from "node:fs";

/** The Code60 version. `package.json` is the only place it is set. */
export const CODE60_VERSION: string = readVersion();

/**
 * The format written to each run.json. Raise it only when older Code60 versions could no longer
 * read new records correctly.
 */
export const RUN_RECORD_FORMAT = 1;

function readVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  const version = (manifest as { version?: unknown } | null)?.version;
  if (typeof version !== "string") throw new Error("package.json has no version");
  return version;
}
