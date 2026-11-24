import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpConfigurationStore } from "./mcp-configuration-store.js";
import { McpManagement } from "./mcp-management.js";

const original =
  '{"version":1,"servers":{"docs":{"label":"PRIVATE_LABEL","enabled":false,"type":"stdio","command":"PRIVATE_COMMAND","env":{"TOKEN":{"credentialRef":"PRIVATE_REF"}}}}}\n';
describe("reviewed MCP recovery (supporting filesystem integration)", () => {
  let root: string;
  let store: McpConfigurationStore;
  let management: McpManagement | undefined;
  let user: string;
  let project: string;
  let armed: boolean;
  const owner = { projectId: randomUUID(), databaseEpoch: 1, root: "" };
  let projects: (typeof owner)[];
  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "code60-mcp-recovery-")));
    await fs.mkdir(join(root, "project"));
    owner.root = join(root, "project");
    projects = [owner];
    armed = false;
    store = await McpConfigurationStore.open({
      stateRoot: join(root, "state"),
      userDirectory: join(root, "config"),
      io: {
        ...fs,
        checkpoint: async (step) => {
          if (armed && step === "directory-sync") throw new Error("private synthetic failure");
        },
      },
    });
    user = store.targetIds().find((t) => t.scope === "user")!.targetId;
    project = await store.registerProject(owner.root);
    await store.save({
      targetId: user,
      expectedRevision: (await store.read(user)).revision,
      text: original,
      requestId: randomUUID(),
    });
  });
  afterEach(async () => {
    armed = false;
    await management?.close();
    management = undefined;
    await store.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  async function interrupt() {
    armed = true;
    const id = randomUUID();
    expect(
      (
        await store.move({
          sourceId: user,
          destinationId: project,
          serverId: "docs",
          expectedSourceRevision: (await store.read(user)).revision,
          expectedDestinationRevision: (await store.read(project)).revision,
          requestId: id,
        })
      ).status,
    ).toBe("recovery-required");
    armed = false;
    return id;
  }
  const recover = (
    review: Awaited<ReturnType<typeof store.previewRecovery>>,
    direction: "complete" | "rollback",
    requestId = randomUUID(),
  ) => ({
    transactionId: review.transactionId,
    action: direction,
    expectedJournalRevision: review.reviewRevision,
    expectedRevisions: Object.fromEntries(
      review.targets.map((t) => [t.targetId, t.expectedRevision]),
    ),
    requestId,
  });
  it.each(["complete", "rollback"] as const)(
    "reviews exact destination-first states and %s with durable replay",
    async (direction) => {
      const id = await interrupt();
      const review = await store.previewRecovery(id);
      expect(review.targets.map((t) => [t.targetId, t.state])).toEqual([
        [project, "after"],
        [user, "before"],
      ]);
      expect(review.allowed).toBe(true);
      expect(review.targets.map((target) => target.changedServerIds)).toEqual([["docs"], ["docs"]]);
      expect(JSON.stringify(review)).not.toMatch(/PRIVATE_|TOKEN|path|command|credentialRef/);
      const request = recover(review, direction);
      const result = await store.recover(request);
      expect(result.status).toBe(direction === "complete" ? "completed" : "rolled-back");
      expect(await store.recover(request)).toEqual(result);
      await expect(
        store.recover({ ...request, action: direction === "complete" ? "rollback" : "complete" }),
      ).rejects.toThrow("conflict");
      expect(await fs.readFile(join(root, "config/mcp.json"), "utf8")).toBe(
        direction === "rollback" ? original : '{\n  "version": 1,\n  "servers": {}\n}\n',
      );
      if (direction === "rollback")
        await expect(fs.stat(join(root, "project/.code60/mcp.json"))).rejects.toThrow();
      else expect((await fs.stat(join(root, "project/.code60/mcp.json"))).mode & 0o777).toBe(0o644);
      expect((await fs.stat(join(root, "config/mcp.json"))).mode & 0o777).toBe(0o600);
      expect(await store.listPendingRecovery()).toEqual([]);
    },
  );
  it("refuses a same-byte replaced journal after review, then allows a fresh review", async () => {
    const id = await interrupt();
    const review = await store.previewRecovery(id);
    const file = join(root, `state/${id}.journal`);
    const data = await fs.readFile(file);
    await fs.rename(file, `${file}.old`);
    await fs.writeFile(file, data, { mode: 0o600 });
    await fs.unlink(`${file}.old`);
    await expect(store.recover(recover(review, "complete"))).rejects.toThrow("conflict");
    expect((await store.previewRecovery(id)).reviewRevision).not.toBe(review.reviewRevision);
    expect((await store.recover(recover(await store.previewRecovery(id), "complete"))).status).toBe(
      "completed",
    );
  });
  it("shows a third state without exposing bytes and refuses stale reviewed file identity", async () => {
    const id = await interrupt();
    const review = await store.previewRecovery(id);
    await fs.writeFile(join(root, "config/mcp.json"), original + " ");
    const changed = await store.previewRecovery(id);
    expect(changed.allowed).toBe(false);
    expect(changed.targets[1]?.state).toBe("conflict");
    await expect(store.recover(recover(review, "rollback"))).rejects.toThrow("conflict");
    expect(await store.listPendingRecovery()).toHaveLength(1);
  });
  it("requires all captured live owners, never retargets reopened projects, and scopes pending records", async () => {
    const id = await interrupt();
    await store.close();
    management = new McpManagement(join(root, "state"), join(root, "config"), () => projects);
    const targets = (await management.targets()).targets;
    const address = targets.find((t) => t.address.scope === "user")!.address;
    const review = (
      await management.recovery({ action: "review", target: address, transactionId: id })
    ).review!;
    expect(review.targets.map((t) => t.label)).toEqual(["project", "User"]);
    const request = {
      action: "recover" as const,
      direction: "complete" as const,
      transactionId: id,
      reviewRevision: review.reviewRevision,
      targets: review.targets.map(({ target, expectedRevision }) => ({ target, expectedRevision })),
      requestId: randomUUID(),
    };
    projects = [];
    expect((await management.recovery({ action: "list", target: address })).pending).toEqual([
      { transactionId: id, available: false },
    ]);
    await expect(management.recovery(request)).rejects.toThrow("conflict");
    projects = [{ ...owner, projectId: randomUUID(), databaseEpoch: 2 }];
    await management.targets();
    await expect(management.recovery(request)).rejects.toThrow("conflict");
    const fresh = (
      await management.recovery({ action: "review", target: address, transactionId: id })
    ).review!;
    const committed = {
      ...request,
      targets: fresh.targets.map(({ target, expectedRevision }) => ({ target, expectedRevision })),
      requestId: randomUUID(),
    };
    expect((await management.recovery(committed)).result?.status).toBe("completed");
    expect((await management.recovery(committed)).result?.status).toBe("completed");
    projects = [{ ...owner, projectId: randomUUID(), databaseEpoch: 3 }];
    const reopened = (await management.targets()).targets.find(
      (entry) => entry.address.scope === "project",
    )!.address;
    await expect(
      management.recovery({
        ...committed,
        targets: committed.targets.map((entry) => ({
          ...entry,
          target: entry.target.scope === "project" ? reopened : entry.target,
        })),
      }),
    ).rejects.toThrow("conflict");
  });
});
