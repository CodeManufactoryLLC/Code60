import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CredentialStorePort } from "../platform/index.js";
import {
  type CredentialBinding,
  McpCredentialVault,
  mcpSecurityFingerprint,
} from "./mcp-credentials.js";

let root: string, vault: McpCredentialVault;
let state: "available" | "locked" | "unavailable";
let native: CredentialStorePort;
let secrets: Map<string, string>;
const binding = (): CredentialBinding => ({
  targetId: "a".repeat(64),
  serverId: "docs",
  reference: "token",
  account: "binding",
  definition: {
    label: "Docs",
    enabled: false,
    type: "stdio",
    command: "node",
    args: ["server"],
    env: { TOKEN: { credentialRef: "token" } },
  },
});
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "code60-vault-"));
  state = "available";
  secrets = new Map();
  native = vi.fn<CredentialStorePort>(async (request) => {
    if (state !== "available") return { status: state };
    const key = `${request.service}:${request.account}`;
    if (request.action === "set") secrets.set(key, request.secret);
    if (request.action === "delete") secrets.delete(key);
    return {
      status: "available",
      ...(request.action === "get" ? { secret: secrets.get(key) ?? null } : {}),
    };
  });
  vault = new McpCredentialVault(join(root, "vault"), native, () => {});
});
afterEach(async () => {
  await vault.close();
  await rm(root, { recursive: true, force: true });
});
it("persists only non-secret version metadata; label and enabled edits do not rebind credentials", async () => {
  const value = binding(),
    secret = `synthetic-${randomUUID()}`;
  await vault.put(value, secret, "persistent", randomUUID());
  expect((await vault.get(value)).secret).toBe(secret);
  value.definition.label = "New label";
  value.definition.enabled = true;
  expect((await vault.get(value)).secret).toBe(secret);
  expect(await readFile(join(root, "vault/metadata.json"), "utf8")).not.toContain(secret);
  expect([...secrets.keys()][0]).toMatch(/^code60\.mcp\.[a-f0-9-]{36}:[a-f0-9]{64}$/);
});
it("security changes, source moves, server IDs and account identities have independent namespaces", async () => {
  const value = binding();
  await vault.put(value, "synthetic", "persistent", randomUUID());
  const fingerprint = mcpSecurityFingerprint(value.definition);
  for (const variant of [
    { ...value, targetId: "b".repeat(64) },
    { ...value, serverId: "other" },
    { ...value, reference: "other" },
    { ...value, account: "other" },
    { ...value, definition: { ...value.definition, command: "different" } },
  ])
    await expect(vault.get(variant)).rejects.toMatchObject({ status: "required" });
  expect(mcpSecurityFingerprint({ ...value.definition, label: "Changed", enabled: true })).toBe(
    fingerprint,
  );
  if (value.definition.type !== "stdio") throw new Error("Expected stdio fixture");
  expect(mcpSecurityFingerprint({ ...value.definition, env: {} })).not.toBe(fingerprint);
});
it("keeps explicitly temporary entries in RAM only and never reactivates an older persistent head", async () => {
  const value = binding();
  await vault.put(value, "old-persistent", "persistent", randomUUID());
  vi.mocked(native).mockClear();
  await vault.put(value, "temporary-only", "temporary", randomUUID());
  expect(await vault.get(value)).toMatchObject({ secret: "temporary-only", storage: "temporary" });
  expect(native).not.toHaveBeenCalled();
  await vault.close();
  vault = new McpCredentialVault(join(root, "vault"), native, () => {});
  await expect(vault.get(value)).rejects.toMatchObject({ status: "required" });
  expect(await readFile(join(root, "vault/metadata.json"), "utf8")).not.toMatch(
    /temporary-only|old-persistent/,
  );
});
it.each(["locked", "unavailable"] as const)(
  "reports %s storage without a temporary fallback or write replay",
  async (failure) => {
    state = failure;
    const id = randomUUID(),
      value = binding();
    await expect(vault.put(value, "synthetic", "persistent", id)).rejects.toMatchObject({
      status: failure,
    });
    await expect(vault.put(value, "synthetic", "persistent", id)).rejects.toMatchObject({
      status: failure,
    });
    expect(native).toHaveBeenCalledOnce();
    await expect(vault.get(value)).rejects.toMatchObject({ status: "required" });
    expect(await readFile(join(root, "vault/metadata.json"), "utf8")).toContain(
      '"state":"pending"',
    );
  },
);
it("refuses conflicting secret reuse and verifies a durable identical write without writing again", async () => {
  const id = randomUUID(),
    value = binding();
  await vault.put(value, "synthetic", "persistent", id);
  await expect(vault.put(value, "different", "persistent", id)).rejects.toThrow("Conflicting");
  await vault.close();
  vault = new McpCredentialVault(join(root, "vault"), native, () => {});
  vi.mocked(native).mockClear();
  await vault.put(value, "synthetic", "persistent", id);
  expect(vi.mocked(native).mock.calls.every(([request]) => request.action === "get")).toBe(true);
  await expect(vault.put(value, "different", "persistent", id)).rejects.toThrow("Conflicting");
});
it("revokes immediately and retains an honest deletion tombstone while locked, including after restart", async () => {
  const value = binding();
  await vault.put(value, "synthetic", "persistent", randomUUID());
  state = "locked";
  await expect(vault.forget(value)).rejects.toMatchObject({ status: "uncertain" });
  await expect(vault.get(value)).rejects.toMatchObject({ status: "required" });
  await vault.close();
  state = "available";
  vault = new McpCredentialVault(join(root, "vault"), native, () => {});
  await expect(vault.get(value)).rejects.toMatchObject({ status: "required" });
  expect(secrets.size).toBe(1);
  expect(await readFile(join(root, "vault/metadata.json"), "utf8")).toContain("deletion-uncertain");
  await vault.forget(value);
  expect(secrets.size).toBe(0);
});
it("requires fresh entry after an unclean Gateway epoch instead of resurrecting uncertain authority", async () => {
  const value = binding();
  await vault.put(value, "synthetic", "persistent", randomUUID());
  await vault.close();
  const path = join(root, "vault/metadata.json"),
    metadata = JSON.parse(await readFile(path, "utf8"));
  metadata.clean = false;
  await writeFile(path, `${JSON.stringify(metadata)}\n`);
  vault = new McpCredentialVault(join(root, "vault"), native, () => {});
  await expect(vault.get(value)).rejects.toMatchObject({ status: "required" });
  expect(secrets.size).toBe(1);
});
it("blocks a second live writer and preserves first-owner credentials", async () => {
  const value = binding();
  await vault.put(value, "synthetic", "temporary", randomUUID());
  const second = new McpCredentialVault(join(root, "vault"), native, () => {});
  await expect(second.get(value)).rejects.toThrow();
  await expect(second.close()).rejects.toThrow();
  expect((await vault.get(value)).secret).toBe("synthetic");
});
it("does not activate a write that finishes after sign-out", async () => {
  const value = binding();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const perform = native;
  native = vi.fn<CredentialStorePort>(async (request, signal) => {
    if (request.action === "set") await gate;
    return perform(request, signal);
  });
  await vault.close();
  vault = new McpCredentialVault(join(root, "vault"), native, () => {});
  const writing = vault.put(value, "synthetic", "persistent", randomUUID());
  const rejected = expect(writing).rejects.toMatchObject({ status: "required" });
  await vi.waitFor(() => expect(native).toHaveBeenCalledOnce());
  const forgotten = vault.forget(value);
  release();
  await rejected;
  await forgotten;
  expect(secrets.size).toBe(0);
  await expect(vault.get(value)).rejects.toMatchObject({ status: "required" });
});

it("refuses cross-namespace private heads and inconsistent receipts before any native lookup", async () => {
  const value = binding();
  await vault.put(value, "synthetic", "persistent", randomUUID());
  await vault.close();
  const path = join(root, "vault/metadata.json"),
    original = JSON.parse(await readFile(path, "utf8"));
  const version = Object.keys(original.versions)[0]!;
  for (const corrupt of [
    { ...structuredClone(original), heads: { ["f".repeat(64)]: version } },
    {
      ...structuredClone(original),
      operations: { [randomUUID()]: { key: original.versions[version].key, version } },
    },
  ]) {
    const bytes = `${JSON.stringify(corrupt)}\n`;
    await writeFile(path, bytes);
    vi.mocked(native).mockClear();
    const broken = new McpCredentialVault(join(root, "vault"), native, () => {});
    await expect(broken.get(value)).rejects.toMatchObject({ status: "unavailable" });
    await expect(broken.close()).rejects.toThrow();
    expect(native).not.toHaveBeenCalled();
    expect(await readFile(path, "utf8")).toBe(bytes);
  }
});
it("refuses a mismatched scope/reference even when a private head has the expected key", async () => {
  const value = binding();
  await vault.put(value, "synthetic", "persistent", randomUUID());
  await vault.close();
  const path = join(root, "vault/metadata.json"),
    metadata = JSON.parse(await readFile(path, "utf8"));
  const version = Object.keys(metadata.versions)[0]!;
  metadata.versions[version].scope = "f".repeat(64);
  await writeFile(path, JSON.stringify(metadata));
  vi.mocked(native).mockClear();
  vault = new McpCredentialVault(join(root, "vault"), native, () => {});
  await expect(vault.get(value)).rejects.toMatchObject({ status: "required" });
  expect(native).not.toHaveBeenCalled();
});
