import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MCP_TEXT_LIMITS } from "../bridge/index.js";
import type { GuardedFileIo } from "../platform/index.js";
import { McpConfigurationStore, McpStorageError } from "./index.js";

const empty = '{"version":1,"servers":{}}';
const content = (label = "Docs") =>
  JSON.stringify({
    version: 1,
    servers: {
      docs: {
        label,
        enabled: true,
        type: "stdio",
        command: "node",
        env: { TOKEN: { credentialRef: "local-only" } },
      },
    },
  });
type Options = Parameters<typeof McpConfigurationStore.open>[0];

describe("MCP configuration store (supporting filesystem integration)", () => {
  let root: string;
  let options: Options;
  const stores: McpConfigurationStore[] = [];
  const open = async (extra: Partial<Options> = {}) => {
    const store = await McpConfigurationStore.open({ ...options, ...extra });
    stores.push(store);
    const user = store.targetIds().find((target) => target.scope === "user")?.targetId;
    const project = store.targetIds().find((target) => target.scope === "project")?.targetId;
    if (!user || !project) throw new Error("Missing test target");
    return { store, user, project };
  };
  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "code60-mcp-store-")));
    const project = join(root, "project");
    await fs.mkdir(project);
    let clock = 0;
    options = {
      stateRoot: join(root, "state", "mcp"),
      userDirectory: join(root, "config", "code60"),
      projects: [{ projectId: "owned-project", root: project }],
      now: () => ++clock,
    };
  });
  afterEach(async () => {
    try {
      const results = await Promise.allSettled(stores.splice(0).map((store) => store.close()));
      for (const result of results) if (result.status === "rejected") throw result.reason;
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  const save = async (store: McpConfigurationStore, targetId: string, text = content()) =>
    store.save({
      targetId,
      text,
      expectedRevision: (await store.read(targetId)).revision,
      requestId: randomUUID(),
    });
  const requestMove = async (store: McpConfigurationStore, user: string, project: string) => ({
    sourceId: user,
    destinationId: project,
    serverId: "docs",
    expectedSourceRevision: (await store.read(user)).revision,
    expectedDestinationRevision: (await store.read(project)).revision,
    requestId: randomUUID(),
  });
  const recover = async (
    store: McpConfigurationStore,
    transactionId: string,
    targets: string[],
    action: "complete" | "rollback",
  ) => {
    const expectedRevisions: Record<string, string> = {};
    for (const target of targets) expectedRevisions[target] = (await store.read(target)).revision;
    return store.recover({ transactionId, action, expectedRevisions, requestId: randomUUID() });
  };

  it("reads missing files without creating config directories, validates before any durable mutation, and returns safe errors", async () => {
    const { store, user } = await open();
    const initial = await store.read(user);
    expect(initial).toMatchObject({
      exists: false,
      text: null,
      document: { version: 1, servers: {} },
      issues: [],
      pendingRecovery: [],
    });
    await expect(fs.stat(options.userDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    const inventory = await fs.readdir(options.stateRoot);
    const request = {
      targetId: user,
      text: '{"synthetic-private-credential": bad}',
      expectedRevision: initial.revision,
      requestId: randomUUID(),
    };
    try {
      await store.save(request);
      expect.fail("accepted malformed JSON");
    } catch (error) {
      expect(error).toBeInstanceOf(McpStorageError);
      expect(JSON.stringify(error)).not.toContain("synthetic-private-credential");
    }
    expect(await fs.readdir(options.stateRoot)).toEqual(inventory);
    await expect(store.read("unknown-target")).rejects.toMatchObject({ code: "unavailable" });
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 100 * 1024 * 1024 + 1])(
    "never bypasses the production ceiling with invalid budget %#",
    async (budgetBytes) => {
      await expect(McpConfigurationStore.open({ ...options, budgetBytes })).rejects.toMatchObject({
        code: "invalid",
      });
      await expect(fs.stat(options.stateRoot)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("preserves exact text, privacy, immutable reads, no-op revisions and durable request replay", async () => {
    const { store, user, project } = await open();
    const text = ` \n${content("Unicode 文😀")}\n `;
    const request = {
      targetId: user,
      text,
      expectedRevision: (await store.read(user)).revision,
      requestId: randomUUID(),
    };
    const result = await store.save(request);
    expect(result.status).toBe("saved");
    expect(await fs.readFile(join(options.userDirectory, "mcp.json"), "utf8")).toBe(text);
    expect((await fs.stat(join(options.userDirectory, "mcp.json"))).mode & 0o777).toBe(0o600);
    expect(await store.save(request)).toEqual(result);
    await expect(store.save({ ...request, text: empty })).rejects.toMatchObject({
      code: "conflict",
    });
    expect((await save(store, user, text)).status).toBe("unchanged");
    expect(await store.listBackups(user)).toHaveLength(1);
    const snapshot = await store.read(user);
    if (snapshot.document?.servers.docs) snapshot.document.servers.docs.label = "local mutation";
    expect((await store.read(user)).document?.servers.docs?.label).toBe("Unicode 文😀");
    await save(store, project);
    expect((await fs.stat(join(root, "project", ".code60", "mcp.json"))).mode & 0o777).toBe(0o644);
    for (const name of await fs.readdir(options.stateRoot))
      if (name !== ".writer")
        expect((await fs.stat(join(options.stateRoot, name))).mode & 0o077).toBe(0);
    await store.close();
    const reopened = await open();
    expect(await reopened.store.save(request)).toEqual(result);
    await expect(store.read(user)).rejects.toMatchObject({ code: "closed" });
  });

  it("preserves malformed and invalid-UTF8 preimages while allowing validated repairs", async () => {
    await fs.mkdir(options.userDirectory, { recursive: true, mode: 0o700 });
    const path = join(options.userDirectory, "mcp.json");
    await fs.writeFile(path, '{ broken secret: "do not echo" }', { mode: 0o600 });
    const { store, user } = await open();
    expect((await store.read(user)).issues[0]?.code).toBe("syntax");
    await save(store, user, empty);
    const backup = (await store.listBackups(user))[0];
    expect(backup?.valid).toBe(false);
    await expect(
      store.restore({
        targetId: user,
        expectedRevision: (await store.read(user)).revision,
        backupId: backup?.backupId ?? "",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await fs.writeFile(path, Buffer.from([0xff, 0xfe]));
    expect(await store.read(user)).toMatchObject({ text: null, issues: [{ code: "encoding" }] });
    await save(store, user, empty);
    expect((await store.read(user)).document).toEqual({ version: 1, servers: {} });
    await fs.writeFile(path, `\ufeff${empty}`);
    expect((await store.read(user)).text).toBe(`\ufeff${empty}`);
    expect((await store.read(user)).issues[0]?.code).toBe("syntax");
  });

  it("detects stale revisions and same-byte inode replacement without making backups", async () => {
    const { store, user } = await open();
    await save(store, user);
    const old = await store.read(user);
    const path = join(options.userDirectory, "mcp.json");
    const replacement = join(options.userDirectory, "replacement");
    await fs.writeFile(replacement, old.text ?? "", { mode: 0o600 });
    await fs.rename(replacement, path);
    const backups = await store.listBackups(user);
    await expect(
      store.save({
        targetId: user,
        text: empty,
        expectedRevision: old.revision,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await store.listBackups(user)).toEqual(backups);
    expect(await fs.readFile(path, "utf8")).toBe(old.text);
  });

  it.each(["symlink", "hardlink", "directory", "permissions", "oversized", "read-only"] as const)(
    "refuses %s targets without overwriting them",
    async (kind) => {
      await fs.mkdir(options.userDirectory, { recursive: true, mode: 0o700 });
      const path = join(options.userDirectory, "mcp.json");
      const foreign = join(root, "foreign");
      await fs.writeFile(foreign, empty, { mode: 0o600 });
      if (kind === "symlink") await fs.symlink(foreign, path);
      else if (kind === "hardlink") await fs.link(foreign, path);
      else if (kind === "directory") await fs.mkdir(path);
      else
        await fs.writeFile(
          path,
          kind === "oversized" ? " ".repeat(MCP_TEXT_LIMITS.bytes + 1) : empty,
          { mode: kind === "permissions" ? 0o644 : kind === "read-only" ? 0o400 : 0o600 },
        );
      const { store, user } = await open();
      if (kind === "read-only")
        await expect(save(store, user)).rejects.toMatchObject({ code: "unsafe" });
      else await expect(store.read(user)).rejects.toBeInstanceOf(McpStorageError);
      expect(await fs.readFile(foreign, "utf8")).toBe(empty);
    },
  );

  it("rejects linked managed directories, replaced project roots and concurrent ownership", async () => {
    const { store, project } = await open();
    await expect(McpConfigurationStore.open(options)).rejects.toThrow();
    const outside = join(root, "outside");
    await fs.mkdir(outside);
    await fs.symlink(outside, join(root, "project", ".code60"));
    await expect(store.read(project)).rejects.toMatchObject({ code: "unsafe" });
    await fs.unlink(join(root, "project", ".code60"));
    await fs.rename(join(root, "project"), join(root, "old-project"));
    await fs.mkdir(join(root, "project"));
    await expect(store.read(project)).rejects.toMatchObject({ code: "conflict" });
  });

  it("moves destination first, retains references, leaves an empty source and rejects collisions", async () => {
    const { store, user, project } = await open();
    await save(store, user);
    await save(store, project);
    const collision = await requestMove(store, user, project);
    await expect(store.move(collision)).rejects.toMatchObject({ code: "invalid" });
    await save(store, project, empty);
    const request = await requestMove(store, user, project);
    expect((await store.move(request)).status).toBe("moved");
    expect((await store.read(user)).document?.servers).toEqual({});
    expect((await store.read(project)).document?.servers.docs).toMatchObject({
      env: { TOKEN: { credentialRef: "local-only" } },
    });
    expect((await store.read(user)).exists).toBe(true);
    expect((await store.move(request)).status).toBe("moved");
  });

  it.each(["complete", "rollback"] as const)(
    "retains interrupted moves across reopen and requires explicit %s",
    async (action) => {
      let fail = false;
      const io: GuardedFileIo = {
        ...fs,
        checkpoint: async (step, target) => {
          if (fail && step === "rename" && target === join(options.userDirectory, "mcp.json"))
            throw new Error("synthetic disk failure");
        },
      };
      const { store, user, project } = await open({ io });
      await save(store, user);
      const original = await fs.readFile(join(options.userDirectory, "mcp.json"), "utf8");
      fail = true;
      const request = await requestMove(store, user, project);
      expect(await store.move(request)).toMatchObject({ status: "recovery-required" });
      expect(await fs.readFile(join(options.userDirectory, "mcp.json"), "utf8")).toBe(original);
      expect((await store.read(project)).document?.servers.docs).toBeDefined();
      await expect(save(store, user, empty)).rejects.toMatchObject({ code: "recovery-required" });
      expect((await store.listBackups(user)).some((backup) => backup.pinned)).toBe(true);
      await store.close();
      fail = false;
      const reopened = await open({ io });
      expect(await reopened.store.listPendingRecovery()).toHaveLength(1);
      expect(await fs.readFile(join(options.userDirectory, "mcp.json"), "utf8")).toBe(original);
      expect(
        (await recover(reopened.store, request.requestId, [user, project], action)).status,
      ).toBe(action === "complete" ? "completed" : "rolled-back");
      expect(await reopened.store.listPendingRecovery()).toEqual([]);
      expect((await reopened.store.read(user)).document?.servers.docs !== undefined).toBe(
        action === "rollback",
      );
      expect((await reopened.store.read(project)).document?.servers.docs !== undefined).toBe(
        action === "complete",
      );
      expect((await reopened.store.move(request)).status).toBe(
        action === "complete" ? "completed" : "rolled-back",
      );
      expect(
        (await fs.readdir(options.userDirectory)).filter((name) => name.endsWith(".tmp")),
      ).toEqual([]);
    },
  );

  it("reports post-rename sync uncertainty and refuses recovery over newer edits", async () => {
    let fail = true;
    const { store, user } = await open({
      io: {
        ...fs,
        checkpoint: async (step) => {
          if (fail && step === "directory-sync") throw new Error("synthetic sync failure");
        },
      },
    });
    const result = await save(store, user);
    expect(result.status).toBe("recovery-required");
    expect(await fs.readFile(join(options.userDirectory, "mcp.json"), "utf8")).toBe(content());
    fail = false;
    await fs.writeFile(join(options.userDirectory, "mcp.json"), empty);
    await expect(recover(store, result.transactionId, [user], "rollback")).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await fs.readFile(join(options.userDirectory, "mcp.json"), "utf8")).toBe(empty);
    expect(await store.listPendingRecovery()).toHaveLength(1);
  });

  it.each(["backup", "journal", "receipt"] as const)(
    "preserves file data across %s metadata failures",
    async (step) => {
      let fail = false;
      const { store, user } = await open({
        checkpoint: async (current) => {
          if (fail && current === step) throw new Error("synthetic-private-credential");
        },
      });
      await save(store, user);
      const before = await fs.readFile(join(options.userDirectory, "mcp.json"), "utf8");
      fail = true;
      const request = {
        targetId: user,
        text: empty,
        expectedRevision: (await store.read(user)).revision,
        requestId: randomUUID(),
      };
      if (step === "journal")
        await expect(store.save(request)).rejects.toMatchObject({ code: "unavailable" });
      else expect((await store.save(request)).status).toBe("recovery-required");
      if (step !== "receipt")
        expect(await fs.readFile(join(options.userDirectory, "mcp.json"), "utf8")).toBe(before);
      fail = false;
      if (step !== "journal")
        expect((await recover(store, request.requestId, [user], "rollback")).status).toBe(
          "rolled-back",
        );
      expect(await fs.readFile(join(options.userDirectory, "mcp.json"), "utf8")).toBe(before);
    },
  );

  it("restores exact valid backups, retains the last twenty per target, and preserves replay receipts", async () => {
    const { store, user, project } = await open();
    for (let i = 0; i < 23; i++) await save(store, user, content(`revision-${i}`));
    await save(store, project);
    expect(await store.listBackups(user)).toHaveLength(20);
    expect(await store.listBackups(project)).toHaveLength(1);
    const backup = (await store.listBackups(user))[0];
    if (!backup) throw new Error("Missing backup");
    const result = await store.restore({
      targetId: user,
      expectedRevision: (await store.read(user)).revision,
      backupId: backup.backupId,
      requestId: randomUUID(),
    });
    expect(result.status).toBe("restored");
    expect((await store.read(user)).text).toBe(content("revision-21"));
    expect(await store.listBackups(user)).toHaveLength(20);
  });

  it("rejects oversized reservations, preserves pinned evidence, and does not prune corrupt artifacts", async () => {
    const { store, user } = await open({
      budgetBytes: 60_000,
      io: {
        ...fs,
        checkpoint: async (step) => {
          if (step === "rename") throw new Error("hold recovery");
        },
      },
    });
    expect((await save(store, user)).status).toBe("recovery-required");
    const inventory = await fs.readdir(options.stateRoot);
    await expect(save(store, user, empty)).rejects.toMatchObject({ code: "recovery-required" });
    expect(await fs.readdir(options.stateRoot)).toEqual(inventory);
    await fs.writeFile(join(options.stateRoot, "unknown-evidence"), "preserve", { mode: 0o600 });
    await expect(store.listBackups(user)).rejects.toMatchObject({ code: "unsafe" });
    expect(await fs.readFile(join(options.stateRoot, "unknown-evidence"), "utf8")).toBe("preserve");
  });

  it("bounds quota before publication and supports pre-publication cancellation", async () => {
    const { store, user } = await open({ budgetBytes: 40_000 });
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      store.save(
        {
          targetId: user,
          text: content(),
          expectedRevision: (await store.read(user)).revision,
          requestId: randomUUID(),
        },
        cancelled.signal,
      ),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect((await store.read(user)).exists).toBe(false);
    await expect(save(store, user, content().padEnd(30_000))).rejects.toMatchObject({
      code: "storage-limit",
    });
    expect((await store.read(user)).exists).toBe(false);
    expect(await store.listBackups(user)).toEqual([]);
  });

  it("serializes competing writes and replays identical arguments independent of object-key order", async () => {
    const { store, user } = await open();
    const revision = (await store.read(user)).revision;
    const first = {
      targetId: user,
      expectedRevision: revision,
      text: content("first"),
      requestId: randomUUID(),
    };
    const results = await Promise.allSettled([
      store.save(first),
      store.save({ ...first, requestId: randomUUID(), text: content("second") }),
    ]);
    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]?.status).toBe("rejected");
    expect(
      await store.save({
        requestId: first.requestId,
        text: first.text,
        expectedRevision: revision,
        targetId: user,
      }),
    ).toEqual(results[0]?.status === "fulfilled" ? results[0].value : undefined);
    expect((await store.read(user)).text).toBe(first.text);
  });

  it("completes a post-rename uncertain save without publishing again", async () => {
    let fail = true;
    let renames = 0;
    const { store, user } = await open({
      io: {
        ...fs,
        checkpoint: async (step) => {
          if (step === "rename") renames++;
          if (fail && step === "directory-sync") throw new Error("synthetic sync failure");
        },
      },
    });
    const result = await save(store, user);
    expect(result.status).toBe("recovery-required");
    const identity = (await fs.stat(join(options.userDirectory, "mcp.json"), { bigint: true })).ino;
    fail = false;
    expect((await recover(store, result.transactionId, [user], "complete")).status).toBe(
      "completed",
    );
    expect(renames).toBe(1);
    expect((await fs.stat(join(options.userDirectory, "mcp.json"), { bigint: true })).ino).toBe(
      identity,
    );
  });

  it("cancels a move after publishing its destination and rolls back only on explicit recovery", async () => {
    const signal = new AbortController();
    let armed = false;
    const { store, user, project } = await open({
      io: {
        ...fs,
        checkpoint: async (step, path) => {
          if (armed && step === "directory-sync" && path.includes(".code60")) signal.abort();
        },
      },
    });
    await save(store, user);
    armed = true;
    const result = await store.move(await requestMove(store, user, project), signal.signal);
    expect(result.status).toBe("recovery-required");
    expect((await store.read(user)).document?.servers.docs).toBeDefined();
    expect((await store.read(project)).document?.servers.docs).toBeDefined();
    expect((await recover(store, result.transactionId, [user, project], "rollback")).status).toBe(
      "rolled-back",
    );
    expect((await store.read(project)).exists).toBe(false);
  });

  it("restores a malformed original only through explicit rollback and protects other scopes", async () => {
    await fs.mkdir(options.userDirectory, { recursive: true, mode: 0o700 });
    const path = join(options.userDirectory, "mcp.json");
    const original = '{ invalid raw "synthetic-secret"';
    await fs.writeFile(path, original, { mode: 0o600 });
    let fail = true;
    const { store, user, project } = await open({
      io: {
        ...fs,
        checkpoint: async (step, target) => {
          if (fail && step === "directory-sync" && target === path) throw new Error("uncertain");
        },
      },
    });
    const result = await save(store, user, empty);
    expect(result.status).toBe("recovery-required");
    expect((await save(store, project)).status).toBe("saved");
    fail = false;
    expect((await recover(store, result.transactionId, [user], "rollback")).status).toBe(
      "rolled-back",
    );
    expect(await fs.readFile(path, "utf8")).toBe(original);
    expect((await store.listBackups(user))[0]?.valid).toBe(false);
  });

  it("prunes only completed backups across scopes to respect the global ceiling", async () => {
    const { store, user, project } = await open({ budgetBytes: 70_000 });
    for (let i = 0; i < 20; i++)
      await save(store, i % 2 ? user : project, content(`version-${i}`).padEnd(1000));
    expect(
      (await store.listBackups(user)).length + (await store.listBackups(project)).length,
    ).toBeLessThan(20);
    let total = 0;
    for (const name of await fs.readdir(options.stateRoot))
      if (name !== ".writer") total += (await fs.stat(join(options.stateRoot, name))).size;
    expect(total).toBeLessThanOrEqual(70_000);
  });

  it("cleans an uncheckpointed owned stage and recovers without orphaning temporary files", async () => {
    let journalWrites = 0;
    let failAt = Number.POSITIVE_INFINITY;
    const { store, user } = await open({
      checkpoint: async (step) => {
        if (step === "journal" && ++journalWrites === failAt)
          throw new Error("synthetic journal sync boundary");
      },
    });
    await save(store, user);
    failAt = journalWrites + 2;
    const result = await save(store, user, empty);
    expect(result.status).toBe("recovery-required");
    expect(
      (await fs.readdir(options.userDirectory)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
    expect((await recover(store, result.transactionId, [user], "complete")).status).toBe(
      "completed",
    );
    expect((await store.read(user)).text).toBe(empty);
  });

  it("detects altered journal preimages and preserves corrupt evidence without applying it", async () => {
    let fail = false;
    const { store, user } = await open({
      io: {
        ...fs,
        checkpoint: async (step) => {
          if (fail && step === "rename") throw new Error("hold recovery");
        },
      },
    });
    await save(store, user);
    fail = true;
    const result = await save(store, user, empty);
    expect(result.status).toBe("recovery-required");
    const path = join(options.stateRoot, `${result.transactionId}.journal`);
    const journal = JSON.parse(await fs.readFile(path, "utf8"));
    journal.changes[0].before.data = Buffer.from("corrupt").toString("base64");
    await fs.writeFile(path, JSON.stringify(journal));
    const evidence = await fs.readFile(path, "utf8");
    await expect(store.listPendingRecovery()).rejects.toMatchObject({ code: "unsafe" });
    expect(await fs.readFile(path, "utf8")).toBe(evidence);
    expect(await fs.readFile(join(options.userDirectory, "mcp.json"), "utf8")).toBe(content());
  });
});
