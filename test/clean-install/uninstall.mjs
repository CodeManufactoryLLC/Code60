import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { cp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { uninstallJourney } from "../fixtures/uninstall-journey.mjs";
import { application, environment, launcher, publicConnection } from "./support.mjs";

const env = {
  ...environment("/work/home"),
  SHELL: "/bin/bash",
  XDG_DATA_HOME: "/installation",
  CODE60_TEST_BACKEND_SOCKET: "/work/backend-supervisor.sock",
};
await assert.rejects(stat("/work/bootstrap-cache"), { code: "ENOENT" });
const original = JSON.parse(await readFile("/work/control/public.json", "utf8"));
const signal = AbortSignal.timeout(9 * 60_000);
const { result, ...connection } = await uninstallJourney({
  root: "/installation/code60",
  application,
  launcher,
  env,
  selection: "/work/home/state/code60/desktop.json",
  database: original.setupDatabase,
  project: "/work/home/project with spaces",
  processLog: "/work/processes",
  promptLog: "/work/prompts",
  connection: publicConnection,
  output: "/evidence",
  signal,
  async install() {
    await cp("/harness/bootstrap", "/work/reinstall-cache", { recursive: true });
    try {
      const { installPayload } = await import(
        pathToFileURL("/work/reinstall-cache/lib/index.mjs").href
      );
      return await installPayload({
        env,
        signal,
        acquisition: { transport: () => createReadStream("/input/package.tgz") },
      });
    } finally {
      await rm("/work/reinstall-cache", { recursive: true });
    }
  },
});
await assert.rejects(stat("/work/reinstall-cache"), { code: "ENOENT" });
await writeFile("/work/control/public.json", JSON.stringify({ ...original, ...connection }));
assert.equal(result.status, "PASS");
