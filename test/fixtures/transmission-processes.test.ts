import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readNativeEndpoint } from "./transmission-processes.js";

let root: string;
const token = "a".repeat(64);
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "code60 native endpoint ' ")));
});
afterEach(async () => {
  await rm(root, { recursive: true });
});
it("reads only a bounded private numeric-loopback endpoint", async () => {
  expect(await readNativeEndpoint(root)).toBeNull();
  await writeFile(join(root, "endpoint.json"), JSON.stringify({ port: 43160, token }), {
    mode: 0o600,
  });
  expect(await readNativeEndpoint(root)).toEqual({ port: 43160, token });
});
it.each([
  { port: "43160@attacker.invalid", token },
  { port: 0, token },
  { port: 65536, token },
  { port: 1.5, token },
  { port: 43160, token: "invalid" },
  { port: 43160, token, extra: true },
  null,
])("rejects malformed connection metadata before any request: %j", async (value) => {
  await writeFile(join(root, "endpoint.json"), JSON.stringify(value), { mode: 0o600 });
  await expect(readNativeEndpoint(root)).rejects.toThrow();
});
it("rejects non-private metadata instead of using it for cleanup", async () => {
  await writeFile(join(root, "endpoint.json"), JSON.stringify({ port: 43160, token }), {
    mode: 0o644,
  });
  await expect(readNativeEndpoint(root)).rejects.toThrow();
});
it("rejects damaged or excessive metadata instead of treating it as missing", async () => {
  for (const body of ["{", " ".repeat(4097)]) {
    await writeFile(join(root, "endpoint.json"), body, { mode: 0o600 });
    await expect(readNativeEndpoint(root)).rejects.toThrow();
  }
});
