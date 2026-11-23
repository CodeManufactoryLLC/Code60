import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { lockPrivateState, privateDirectory } from "../platform/index.js";
import { pairingControl } from "./pairing.js";
import { gatewayRoot } from "./server.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-pairing-")));
  directories.push(directory);
  const env = { HOME: directory, XDG_STATE_HOME: join(directory, "state") };
  return { directory, env, root: gatewayRoot(env) };
}
it("reads the default without writing and saves the preference before enrollment", async () => {
  const { directory, env, root } = await fixture();
  expect(await pairingControl(env)).toEqual({ requirePairing: false });
  expect(await readdir(directory)).toEqual([]);
  await pairingControl(env, true);
  expect(JSON.parse(await readFile(join(root, "settings.json"), "utf8"))).toEqual({
    requirePairing: true,
  });
  expect(await pairingControl(env)).toEqual({ requirePairing: true });
  await pairingControl(env, false);
  expect(await pairingControl(env)).toEqual({ requirePairing: false });
});
it("does not overwrite settings under a live owner or accept malformed policy values", async () => {
  const { env, root } = await fixture();
  await privateDirectory(root);
  const release = await lockPrivateState(root);
  try {
    await expect(pairingControl(env, true)).rejects.toThrow("already running");
  } finally {
    await release();
  }
  await writeFile(join(root, "settings.json"), JSON.stringify({ requirePairing: "false" }), {
    mode: 0o600,
  });
  await expect(pairingControl(env)).rejects.toThrow();
  expect(JSON.parse(await readFile(join(root, "settings.json"), "utf8"))).toEqual({
    requirePairing: "false",
  });
});
