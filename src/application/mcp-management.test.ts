import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpConnectorDocument, McpTargetAddress } from "../bridge/index.js";
import { McpManagement } from "./mcp-management.js";

let root: string;
let projects: { projectId: string; databaseEpoch: number; root: string }[];
let services: McpManagement[];
const doc: McpConnectorDocument = {
  version: 1,
  servers: {
    docs: {
      label: "Docs",
      type: "stdio",
      enabled: false,
      command: "never-run-this-command",
      args: [""],
      env: { TOKEN: { credentialRef: "private-token" } },
    },
  },
};
const create = () => {
  const service = new McpManagement(
    join(root, "state/mcp"),
    join(root, "config/code60"),
    () => projects,
  );
  services.push(service);
  return service;
};
const save = async (service: McpManagement, target: McpTargetAddress, document = doc) =>
  service.save({
    target,
    document,
    expectedRevision: (await service.read(target)).revision,
    requestId: randomUUID(),
  });
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "code60-mcp-management-")));
  await mkdir(join(root, "project"));
  projects = [{ projectId: randomUUID(), databaseEpoch: 1, root: join(root, "project") }];
  services = [];
});
afterEach(async () => {
  await Promise.all(services.map((s) => s.close()));
  await rm(root, { recursive: true, force: true });
});
describe("human MCP management", () => {
  it("opens lazily, reads absence without config creation, emits payload-free changes and preserves exact canonical files", async () => {
    const service = create();
    await expect(stat(join(root, "state/mcp"))).rejects.toThrow();
    const targets = await service.targets();
    const user = targets.targets[0]?.address;
    if (!user) throw new Error("missing target");
    expect((await service.read(user)).document).toEqual({ version: 1, servers: {} });
    await expect(stat(join(root, "config"))).rejects.toThrow();
    const changed = vi.fn();
    const unsubscribe = service.subscribe(changed);
    await save(service, user);
    expect(changed).toHaveBeenCalledExactlyOnceWith();
    unsubscribe();
    expect(await readFile(join(root, "config/code60/mcp.json"), "utf8")).toBe(
      `${JSON.stringify(doc, null, 2)}\n`,
    );
    expect((await stat(join(root, "config/code60/mcp.json"))).mode & 0o777).toBe(0o600);
    expect((await service.read(user)).rows[0]).toMatchObject({
      enabled: false,
      eligibility: "disabled",
    });
  });
  it("separates stable canonical storage identity from runtime/database lifetime and refuses replaced roots", async () => {
    const service = create();
    const first = (await service.targets()).targets[1]?.address;
    if (!first) throw new Error("missing project");
    await save(service, first);
    projects = [
      { ...projects[0], root: join(root, "project"), projectId: randomUUID(), databaseEpoch: 2 },
    ];
    const second = (await service.targets()).targets[1]?.address;
    expect(second?.targetId).toBe(first.targetId);
    await expect(service.read(first)).rejects.toThrow("conflict");
    if (!second) throw new Error("missing reopened project");
    expect((await service.read(second)).document).toEqual(doc);
    await rename(join(root, "project"), join(root, "original"));
    await mkdir(join(root, "project"));
    await expect(service.read(second)).rejects.toThrow("conflict");
    expect((await service.targets()).unavailableProjects).toBe(1);
    expect((await service.targets()).targets).toHaveLength(1);
    projects = [{ root: join(root, "project"), projectId: randomUUID(), databaseEpoch: 2 }];
    expect((await service.targets()).targets[1]?.address.targetId).not.toBe(first.targetId);
    expect((await stat(join(root, "original/.code60/mcp.json"))).mode & 0o777).toBe(0o644);
  });
  it("preserves disabled/unapproved shadowing and keeps malformed inheritance explicit", async () => {
    const service = create();
    const [user, project] = (await service.targets()).targets.map((t) => t.address);
    if (!user || !project) throw new Error("missing targets");
    await save(service, user, {
      version: 1,
      servers: { ...doc.servers, user: { ...doc.servers.docs, label: "User only" } },
    } as McpConnectorDocument);
    await save(service, project);
    expect((await service.read(project)).rows.find((r) => r.id === "docs")).toMatchObject({
      source: { scope: "project" },
      shadowedSources: [{ scope: "user" }],
      approval: "required",
      eligibility: "disabled",
    });
    await writeFile(join(root, "config/code60/mcp.json"), '{"SECRET":"do-not-expose",', {
      mode: 0o600,
    });
    const read = await service.read(project);
    expect(read.inheritanceComplete).toBe(false);
    expect(read.rows.map((r) => r.id)).toEqual(["docs"]);
    const malformed = await service.read(user);
    expect(malformed.document).toBeUndefined();
    expect(JSON.stringify(malformed)).not.toContain("do-not-expose");
    expect(JSON.stringify(malformed)).not.toContain("SECRET");
  });
  it("previews collisions and transfers references without credentials, approval or automatic execution", async () => {
    const service = create();
    const [user, project] = (await service.targets()).targets.map((t) => t.address);
    if (!user || !project) throw new Error("missing targets");
    await save(service, user);
    await save(service, project);
    const request = {
      source: user,
      destination: project,
      serverId: "docs",
      expectedSourceRevision: (await service.read(user)).revision,
      expectedDestinationRevision: (await service.read(project)).revision,
    };
    expect(await service.preview(request)).toMatchObject({
      allowed: false,
      credentialReferences: 1,
      userScopeAffected: true,
      reason: "The destination already contains this server ID.",
    });
    await save(service, project, { version: 1, servers: {} });
    request.expectedDestinationRevision = (await service.read(project)).revision;
    expect((await service.preview(request)).allowed).toBe(true);
    const mutation = { ...request, requestId: randomUUID() };
    const moved = await service.move(mutation);
    expect(moved.status).toBe("moved");
    expect(await service.move(mutation)).toEqual(moved);
    expect((await service.read(user)).document?.servers).toEqual({});
    expect((await service.read(project)).document).toEqual(doc);
    expect((await readdir(join(root, "state/mcp"))).some((f) => f.endsWith(".backup"))).toBe(true);
    expect(
      await service.preview({ ...request, expectedDestinationRevision: "a".repeat(64) }),
    ).toMatchObject({ allowed: false });
  });
  it("rejects stale revisions, deduplicates roots, isolates unsafe projects and releases store ownership", async () => {
    const service = create();
    const user = (await service.targets()).targets[0]?.address;
    if (!user) throw new Error("missing user");
    const request = {
      target: user,
      document: doc,
      expectedRevision: (await service.read(user)).revision,
      requestId: randomUUID(),
    };
    const saved = await service.save(request);
    expect(await service.save(request)).toEqual(saved);
    await expect(service.save({ ...request, requestId: randomUUID() })).rejects.toThrow("conflict");
    projects.push({
      ...projects[0],
      root: join(root, "project"),
      projectId: randomUUID(),
      databaseEpoch: 1,
    });
    expect((await service.targets()).targets).toHaveLength(2);
    await chmod(join(root, "project"), 0o777);
    expect((await service.targets()).unavailableProjects).toBe(2);
    expect((await service.read(user)).document).toEqual(doc);
    await service.close();
    expect((await create().targets()).targets[0]?.address).toEqual(user);
    await expect(service.read(user)).rejects.toThrow("closed");
  });
});

it("does not overwrite malformed files through guided saves and isolates failed observers", async () => {
  const service = create();
  const user = (await service.targets()).targets[0]?.address;
  if (!user) throw new Error("missing user");
  service.subscribe(() => {
    throw new Error("observer failure");
  });
  await save(service, user);
  await writeFile(join(root, "config/code60/mcp.json"), "malformed", { mode: 0o600 });
  const request = {
    target: user,
    document: doc,
    expectedRevision: (await service.read(user)).revision,
    requestId: randomUUID(),
  };
  await expect(service.save(request)).rejects.toThrow("invalid");
  expect(await readFile(join(root, "config/code60/mcp.json"), "utf8")).toBe("malformed");
});
