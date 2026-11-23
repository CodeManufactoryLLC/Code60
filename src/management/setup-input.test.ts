import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { checkSetup, launchSetup } from "./index.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
it("validates prerequisites and flags without writing installation state", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "code60 prerequisites ")));
  roots.push(home);
  await expect(checkSetup(["--invalid"], { HOME: home })).rejects.toThrow("Use code60 setup");
  await expect(checkSetup([], { HOME: home, PATH: "/missing" })).rejects.toThrow("git");
  await expect(checkSetup([], { HOME: home, XDG_DATA_HOME: "relative" })).rejects.toThrow(
    "absolute",
  );
});
it("preserves child exit status and rejects cancellation before spawning", async () => {
  expect(await launchSetup(process.execPath, ["-e", "process.exit(7)"], {})).toBe(7);
  await expect(launchSetup("/missing", [], {})).rejects.toThrow();
  const aborted = new AbortController();
  aborted.abort();
  await expect(launchSetup("/missing", [], {}, aborted.signal)).rejects.toThrow();
});
it("forwards interruption and awaits child exit", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60 interrupt ")));
  roots.push(directory);
  const ready = join(directory, "ready");
  const controller = new AbortController();
  const result = launchSetup(
    process.execPath,
    [
      "-e",
      `require('node:fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)`,
      ready,
    ],
    {},
    controller.signal,
  );
  await vi.waitFor(async () => expect(await readFile(ready, "utf8")).toBe("ready"));
  controller.abort();
  expect(await result).toBe(143);
});
