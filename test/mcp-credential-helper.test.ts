import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type CredentialStorePort, nativeCredentialStore } from "../src/platform/index.js";

let root: string, credential: CredentialStorePort;
const address = (mode = "a") => ({
  service: `code60.mcp.${randomUUID()}`,
  account: mode.repeat(64),
});
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "code60-credential-pipe-"));
  credential = nativeCredentialStore(
    { ...process.env, HOME: root, CODE60_PRIVATE_SENTINEL: "must-not-inherit" },
    resolve("test/fixtures/credential-helper.mjs"),
  );
});
afterEach(async () => {
  await credential.close?.();
  await rm(root, { recursive: true, force: true });
});
it("uses private stdin/stdout, a fixed helper argument and an allowlisted environment", async () => {
  const secret = `synthetic-${randomUUID()}`;
  expect(await credential({ action: "set", ...address(), secret })).toEqual({
    status: "available",
  });
  const observed = JSON.parse(await readFile(join(root, "observed.json"), "utf8"));
  expect(observed).toMatchObject({
    argumentsSafe: true,
    environmentSafe: true,
    receivedStdin: true,
  });
  expect(() => process.kill(observed.pid, 0)).toThrow();
  expect((await readFile(join(root, "observed.json"), "utf8")).includes(secret)).toBe(false);
  const response = await credential({ action: "get", ...address() });
  expect(response.status === "available" && response.secret === "synthetic-private-response").toBe(
    true,
  );
});
it.each(["c", "d"])(
  "rejects oversized/malformed helper output (%s) without returning it",
  async (mode) => {
    expect(await credential({ action: "get", ...address(mode) })).toEqual({
      status: "unavailable",
    });
    const observed = JSON.parse(await readFile(join(root, "observed.json"), "utf8"));
    expect(() => process.kill(observed.pid, 0)).toThrow();
  },
);
it("preserves locked state and does not invent a plaintext or temporary fallback", async () => {
  expect(await credential({ action: "delete", ...address("e") })).toEqual({ status: "locked" });
});
it("cancels owned helper and grandchild process groups, then refuses work after close", async () => {
  const abort = new AbortController();
  const operation = credential(
    { action: "set", ...address("b"), secret: "synthetic" },
    abort.signal,
  );
  let observed: { pid: number; child: number } | undefined;
  await vi.waitFor(async () => {
    observed = JSON.parse(await readFile(join(root, "observed.json"), "utf8"));
    expect(observed?.child).toBeGreaterThan(0);
  });
  abort.abort();
  expect(await operation).toEqual({ status: "uncertain" });
  expect(() => process.kill(observed!.pid, 0)).toThrow();
  expect(() => process.kill(observed!.child, 0)).toThrow();
  await credential.close?.();
  expect(await credential({ action: "get", ...address() })).toEqual({ status: "unavailable" });
});
it("drains a launch racing close and returns fixed errors for invalid addresses", async () => {
  const result = credential({ action: "get", ...address("b") });
  await credential.close?.();
  expect((await result).status).toBe("unavailable");
  const invalid = { ...address(), service: "unrelated-secret-name" };
  expect(await credential({ action: "get", ...invalid })).toEqual({ status: "uncertain" });
});
