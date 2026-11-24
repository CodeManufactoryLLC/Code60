import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { McpConnectorDefinition } from "../bridge/index.js";
import {
  type CredentialStorePort,
  fileCode,
  lockPrivateState,
  readPrivateJson,
  writePrivateJson,
} from "../platform/index.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
}
// Stable identity/metadata hashes and RAM-only replay fingerprints, never password verifiers.
const hash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export function mcpSecurityFingerprint(definition: McpConnectorDefinition) {
  const { label: _label, enabled: _enabled, ...security } = definition;
  if (security.type === "http" && security.auth.type === "oauth")
    security.auth = {
      ...security.auth,
      clientIdType: security.auth.clientIdType ?? "registered",
      scopes: [...new Set(security.auth.scopes)].sort(),
    };
  return hash(security);
}
export interface CredentialBinding {
  targetId: string;
  serverId: string;
  definition: McpConnectorDefinition;
  reference: string;
  account: string;
}
export const credentialScope = (binding: Pick<CredentialBinding, "targetId" | "serverId">) =>
  hash([binding.targetId, binding.serverId]);
const credentialKey = (binding: CredentialBinding) =>
  hash([
    credentialScope(binding),
    mcpSecurityFingerprint(binding.definition),
    binding.reference,
    binding.account,
  ]);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const recordInput = z
  .unknown()
  .refine((v) => v === null || typeof v !== "object" || !Object.hasOwn(v, "__proto__"));
const versionSchema = z.strictObject({
  key: digest,
  scope: digest,
  reference: digest,
  storage: z.enum(["persistent", "temporary"]),
  state: z.enum([
    "pending",
    "active",
    "revoked",
    "removed",
    "deletion-uncertain",
    "entry-required",
  ]),
  requestId: z.uuid(),
});
const schema = z.strictObject({
  version: z.literal(1),
  installation: z.uuid(),
  clean: z.boolean(),
  heads: recordInput.pipe(z.record(digest, z.uuid())),
  versions: recordInput.pipe(z.record(z.uuid(), versionSchema)),
  operations: recordInput.pipe(
    z.record(z.uuid(), z.strictObject({ key: digest, version: z.uuid() })),
  ),
});
export class CredentialFailure extends Error {
  constructor(readonly status: "locked" | "unavailable" | "uncertain" | "required") {
    super(
      status === "required"
        ? "Authentication required; enter credentials or sign in"
        : `Secure credential storage is ${status}; no plaintext or temporary fallback was used`,
    );
  }
}
/** OS secrets and temporary RAM are deliberately separate from private operation metadata. */
export class McpCredentialVault {
  private opening: Promise<void> | undefined;
  private state: z.infer<typeof schema> = {
    version: 1,
    installation: randomUUID(),
    clean: true,
    heads: {},
    versions: {},
    operations: {},
  };
  private previous: unknown;
  private release: (() => Promise<void>) | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly temporary = new Map<string, string>();
  private readonly receipts = new Map<string, { fingerprint: string; result: Promise<void> }>();
  private readonly generations = new Map<string, number>();
  private readonly denied = new Set<string>();
  private readonly deniedReferences = new Set<string>();
  private closed = false;
  private uncertain = false;
  private closing: Promise<void> | undefined;
  private observed: "not-checked" | "available" | "locked" | "unavailable" | "uncertain" =
    "not-checked";
  constructor(
    private readonly root: string,
    private readonly native: CredentialStorePort,
    private readonly changed: () => void,
  ) {}
  private open() {
    if (this.closed) return Promise.reject(new CredentialFailure("unavailable"));
    this.opening ??= (async () => {
      this.release = await lockPrivateState(this.root);
      try {
        this.previous = await readPrivateJson(
          join(this.root, "metadata.json"),
          2 * 1024 * 1024,
        ).catch((error) => {
          if (fileCode(error) !== "ENOENT") throw error;
          return undefined;
        });
        if (this.previous !== undefined) this.state = schema.parse(this.previous);
        if (
          Object.entries(this.state.heads).some(
            ([key, version]) => this.state.versions[version]?.key !== key,
          ) ||
          Object.entries(this.state.operations).some(([id, operation]) => {
            const version = this.state.versions[operation.version];
            return version?.requestId !== id || version.key !== operation.key;
          })
        )
          throw new Error();
        if (!this.state.clean)
          for (const entry of Object.values(this.state.versions))
            if (entry.state === "active") entry.state = "entry-required";
        for (const entry of Object.values(this.state.versions))
          if (entry.storage === "temporary" && entry.state === "active")
            entry.state = "entry-required";
        this.state.clean = false;
        await this.persist();
      } catch {
        this.uncertain = true;
        await this.release();
        this.release = undefined;
        throw new CredentialFailure("unavailable");
      }
    })();
    return this.opening;
  }
  private async persist() {
    try {
      const published = structuredClone(this.state);
      await writePrivateJson(
        join(this.root, "metadata.json"),
        published,
        this.previous,
        2 * 1024 * 1024,
      );
      this.previous = published;
    } catch {
      this.uncertain = true;
      throw new CredentialFailure("uncertain");
    }
  }
  markUncertain() {
    this.uncertain = true;
  }
  availability() {
    return this.observed;
  }
  private async invoke(...args: Parameters<CredentialStorePort>) {
    const result = await this.native(...args);
    if (this.observed !== result.status) {
      this.observed = result.status;
      this.changed();
    }
    return result;
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      if (this.closed) throw new CredentialFailure("unavailable");
      await this.open();
      return action();
    });
    this.queue = result.catch(() => {});
    return result;
  }
  private address(version: string) {
    return { service: `code60.mcp.${this.state.installation}`, account: hash(version) };
  }
  async status(binding: CredentialBinding) {
    await this.open();
    const entry = this.state.versions[this.state.heads[credentialKey(binding)] ?? ""];
    return { state: entry?.state ?? "entry-required", storage: entry?.storage ?? null };
  }
  async get(
    binding: CredentialBinding,
    signal?: AbortSignal,
  ): Promise<{ secret: string; version: string; storage: "persistent" | "temporary" }> {
    await this.open();
    if (this.closed || this.uncertain) throw new CredentialFailure("unavailable");
    const referenceIdentity = `${credentialScope(binding)}:${hash(binding.reference)}`;
    if (this.denied.has(credentialScope(binding)) || this.deniedReferences.has(referenceIdentity))
      throw new CredentialFailure("required");
    const key = credentialKey(binding);
    const version = this.state.heads[key];
    const entry = version && this.state.versions[version];
    if (
      !version ||
      !entry ||
      entry.state !== "active" ||
      entry.key !== key ||
      entry.scope !== credentialScope(binding) ||
      entry.reference !== hash(binding.reference)
    )
      throw new CredentialFailure("required");
    const generation = this.generations.get(entry.scope) ?? 0;
    const referenceGeneration = this.generations.get(referenceIdentity) ?? 0;
    let secret: string | null | undefined;
    if (entry.storage === "temporary") secret = this.temporary.get(version);
    else {
      const result = await this.invoke({ action: "get", ...this.address(version) }, signal);
      if (result.status !== "available") throw new CredentialFailure(result.status);
      secret = result.secret;
    }
    if (
      !secret ||
      entry.state !== "active" ||
      this.state.heads[key] !== version ||
      generation !== (this.generations.get(entry.scope) ?? 0) ||
      this.denied.has(entry.scope) ||
      this.deniedReferences.has(referenceIdentity) ||
      referenceGeneration !== (this.generations.get(referenceIdentity) ?? 0) ||
      this.closed
    )
      throw new CredentialFailure("required");
    return { secret, version, storage: entry.storage };
  }
  put(
    binding: CredentialBinding,
    secret: string,
    storage: "persistent" | "temporary",
    requestId: string,
    validate: () => Promise<unknown> = async () => {},
  ): Promise<void> {
    const key = credentialKey(binding),
      scope = credentialScope(binding);
    const fingerprint = hash([key, secret, storage]); // RAM only, never persisted.
    const prior = this.receipts.get(requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        return Promise.reject(new Error("Conflicting credential request ID"));
      return prior.result;
    }
    if (this.receipts.size >= 4096)
      return Promise.reject(new Error("Credential request receipt limit reached"));
    const referenceIdentity = `${scope}:${hash(binding.reference)}`;
    const generation = this.generations.get(scope) ?? 0;
    const referenceGeneration = this.generations.get(referenceIdentity) ?? 0;
    const result = this.serial(async () => {
      if (!secret || Buffer.byteLength(secret) > 128 * 1024 || secret.includes("\0"))
        throw new Error("Invalid credential value");
      await validate();
      const operation = this.state.operations[requestId];
      if (operation) {
        if (operation.key !== key) throw new Error("Conflicting credential request ID");
        const current = await this.get(binding);
        if (
          current.version !== operation.version ||
          current.secret !== secret ||
          current.storage !== storage
        )
          throw new Error(
            "Credential write is uncertain or request ID conflicts; review before entering again",
          );
        return;
      }
      if (Object.keys(this.state.versions).length >= 4096)
        throw new Error("Private credential metadata limit reached");
      const version = randomUUID();
      this.state.operations[requestId] = { key, version };
      const entry = {
        key,
        scope,
        reference: hash(binding.reference),
        storage,
        state: "pending" as "pending" | "active" | "revoked",
        requestId,
      };
      this.state.versions[version] = entry;
      this.state.heads[key] = version; // Never fall back to a retired version.
      await this.persist();
      if (storage === "temporary") this.temporary.set(version, secret);
      else {
        const written = await this.invoke({ action: "set", ...this.address(version), secret });
        if (written.status !== "available") throw new CredentialFailure(written.status);
        const checked = await this.invoke({ action: "get", ...this.address(version) });
        if (checked.status !== "available") throw new CredentialFailure(checked.status);
        if (checked.secret !== secret) throw new CredentialFailure("uncertain");
      }
      if (
        generation !== (this.generations.get(scope) ?? 0) ||
        referenceGeneration !== (this.generations.get(referenceIdentity) ?? 0)
      ) {
        entry.state = "revoked";
        this.temporary.delete(version);
        await this.persist();
        throw new CredentialFailure("required");
      }
      // OS publication may already have happened; failed fencing leaves a pending
      // head, never an active credential or a fallback to its older version.
      await validate();
      entry.state = "active";
      await this.persist();
      try {
        await validate();
        if (
          generation !== (this.generations.get(scope) ?? 0) ||
          referenceGeneration !== (this.generations.get(referenceIdentity) ?? 0)
        )
          throw new CredentialFailure("required");
      } catch {
        entry.state = "revoked";
        this.temporary.delete(version);
        await this.persist();
        throw new CredentialFailure("uncertain");
      }
      this.denied.delete(scope);
      this.deniedReferences.delete(referenceIdentity);
      this.changed();
    });
    this.receipts.set(requestId, { fingerprint, result });
    return result;
  }
  /** Revocation takes effect synchronously, before queued native deletion or disk I/O. */
  forget(binding: Pick<CredentialBinding, "targetId" | "serverId">, reference?: string) {
    const scope = credentialScope(binding);
    const referenceHash = reference === undefined ? undefined : hash(reference);
    const generationKey = referenceHash ? `${scope}:${referenceHash}` : scope;
    if (referenceHash) this.deniedReferences.add(generationKey);
    else this.denied.add(scope);
    this.generations.set(generationKey, (this.generations.get(generationKey) ?? 0) + 1);
    const revoke = () => {
      for (const [version, entry] of Object.entries(this.state.versions))
        if (entry.scope === scope && (!referenceHash || entry.reference === referenceHash)) {
          if (entry.state !== "removed")
            entry.state = entry.storage === "temporary" ? "removed" : "revoked";
          this.temporary.delete(version);
        }
    };
    revoke();
    return this.serial(async () => {
      revoke();
      await this.persist();
      this.changed();
      let failed = false;
      const deadline = Date.now() + 10_000;
      for (const [version, entry] of Object.entries(this.state.versions))
        if (
          entry.scope === scope &&
          (!referenceHash || entry.reference === referenceHash) &&
          entry.storage === "persistent" &&
          entry.state !== "removed"
        ) {
          if (failed || Date.now() >= deadline) {
            entry.state = "deletion-uncertain";
            failed = true;
            continue;
          }
          const result = await this.invoke(
            { action: "delete", ...this.address(version) },
            AbortSignal.timeout(Math.max(1, deadline - Date.now())),
          );
          if (result.status !== "available") {
            entry.state = "deletion-uncertain";
            failed = true;
          } else entry.state = "removed";
        }
      await this.persist();
      this.changed();
      if (failed) throw new CredentialFailure("uncertain");
    });
  }
  close(): Promise<void> {
    this.closing ??= this.finishClose();
    void this.closing.catch(() => {
      this.closing = undefined;
    });
    return this.closing;
  }
  private async finishClose() {
    this.closed = true;
    await this.queue;
    this.temporary.clear();
    if (!this.opening) return;
    await this.opening;
    await this.native.close?.();
    if (!this.uncertain) {
      this.state.clean = true;
      await this.persist();
    }
    await this.release?.();
    this.release = undefined;
  }
}
