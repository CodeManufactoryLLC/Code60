import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./common.mjs";

const directory = join(process.env.RUNNER_TEMP, "code60-signing");
if (process.argv[2] === "prepare") {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const keychains = [
    ...run("/usr/bin/security", ["list-keychains", "-d", "user"]).matchAll(/"([^"]+)"/g),
  ].map((match) => match[1]);
  await writeFile(join(directory, "keychains.json"), JSON.stringify(keychains));
  if (!process.env.APPLE_API_KEY_P8?.includes("-----BEGIN PRIVATE KEY-----"))
    throw new Error("Missing Apple team API private key");
  const key = join(directory, "AuthKey.p8");
  await writeFile(key, process.env.APPLE_API_KEY_P8, { mode: 0o600 });
  await writeFile(
    join(directory, "environment.json"),
    JSON.stringify({ tmpdir: process.env.TMPDIR || process.env.RUNNER_TEMP }),
  );
  await appendFile(
    process.env.GITHUB_ENV,
    `APPLE_API_KEY=${key}\nAPP_BUILDER_TMP_DIR=${directory}\nTMPDIR=${directory}\n`,
  );
} else if (process.argv[2] === "cleanup") {
  try {
    const keychains = JSON.parse(await readFile(join(directory, "keychains.json"), "utf8"));
    for (const file of await readdir(directory)) {
      if (/\.keychain(-db)?$/.test(file)) {
        try {
          run("/usr/bin/security", ["delete-keychain", join(directory, file)]);
        } catch {
          /* Builder may have already removed it. */
        }
      }
    }
    run("/usr/bin/security", ["list-keychains", "-d", "user", "-s", ...keychains]);
    const original = JSON.parse(await readFile(join(directory, "environment.json"), "utf8"));
    await appendFile(
      process.env.GITHUB_ENV,
      `TMPDIR=${original.tmpdir}\nAPP_BUILDER_TMP_DIR=\nAPPLE_API_KEY=\n`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
} else throw new Error("Expected prepare or cleanup");
