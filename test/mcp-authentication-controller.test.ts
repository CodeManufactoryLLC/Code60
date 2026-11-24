import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApplicationHost, openProjectDatabase } from "../src/application/index.js";
import { filePreferences } from "../src/application/preferences.js";
import type {
  McpAuthenticationRequest,
  McpConnectorDocument,
  McpTargetAddress,
} from "../src/bridge/index.js";
import { defaultDeps } from "../src/core/index.js";
import { openOAuthCallback } from "../src/gateway/oauth-callback.js";
import type { CredentialStorePort } from "../src/platform/index.js";
import { FakeAgents, FakeClock, FakeGit, FakeProcesses } from "./fakes.js";
import { oauthServer } from "./fixtures/mcp-oauth-server.js";

let root: string, host: ApplicationHost, target: McpTargetAddress, revision: string;
let native: CredentialStorePort, remote: Awaited<ReturnType<typeof oauthServer>>;
const doc: McpConnectorDocument = {
  version: 1,
  servers: {
    docs: {
      type: "stdio",
      label: "Docs",
      enabled: false,
      command: "never-run",
      args: [],
      env: { TOKEN: { credentialRef: "token" } },
    },
  },
};
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "code60-auth-controller-")));
  remote = await oauthServer();
  native = vi.fn<CredentialStorePort>(async () => ({ status: "locked" }));
  host = new ApplicationHost(
    {
      ...defaultDeps(),
      agents: new FakeAgents(),
      git: new FakeGit(),
      clock: new FakeClock(),
      processes: new FakeProcesses(),
    },
    { XDG_CONFIG_HOME: join(root, "config"), XDG_STATE_HOME: join(root, "state") },
    { confirm: async () => true },
    {
      relay: true,
      openDatabase: openProjectDatabase,
      preferences: filePreferences(join(root, "preferences.json")),
      mcpAuthentication: { credentials: native, callback: openOAuthCallback },
    },
  );
  await host.restore();
  target = (await host.mcpTargets()).targets[0]!.address;
  await host.mcpSave({
    target,
    expectedRevision: (await host.mcpRead(target)).revision,
    requestId: randomUUID(),
    document: doc,
  });
  revision = (await host.mcpRead(target)).revision;
});
afterEach(async () => {
  await host.shutdown(true);
  await remote.close();
  await fs.rm(root, { recursive: true, force: true });
});
const capture = () => ({ target, expectedRevision: revision, serverId: "docs" });
const call = (request: McpAuthenticationRequest) => host.mcpAuthentication(request, "page");
it("fences human writes/retries, preserves configuration and exposes no credentials in snapshots", async () => {
  const bytes = await fs.readFile(join(root, "config/code60/mcp.json"));
  expect(await call({ action: "status", ...capture() })).toMatchObject({ status: "required" });
  const review = await call({ action: "preview", ...capture(), allowPrivateIssuer: false });
  const request: McpAuthenticationRequest = {
    action: "credential-write",
    ...capture(),
    requestId: randomUUID(),
    previewId: review.previewId!,
    reference: "token",
    secret: "unique-synthetic-controller-secret",
    storage: "temporary",
  };
  const result = await call(request);
  expect(await call(request)).toEqual(result);
  expect(native).not.toHaveBeenCalled();
  expect(await call({ action: "status", ...capture() })).toMatchObject({ status: "authenticated" });
  await expect(call({ ...request, secret: "different" })).rejects.toThrow("Conflicting");
  await expect(host.mcpAuthentication(request, "other-page")).rejects.toThrow("Conflicting");
  expect(JSON.stringify(host.snapshot())).not.toMatch(
    /unique-synthetic-controller-secret|credentialRef|TOKEN/,
  );
  expect(await fs.readFile(join(root, "config/code60/mcp.json"))).toEqual(bytes);
  expect(
    await call({
      action: "credential-forget",
      ...capture(),
      requestId: randomUUID(),
      previewId: review.previewId!,
      reference: "token",
    }),
  ).toEqual({ completed: true });
  expect(await call({ action: "status", ...capture() })).toMatchObject({ status: "required" });
  await expect(
    call({
      action: "start",
      ...capture(),
      requestId: randomUUID(),
      previewId: review.previewId!,
      storage: "temporary",
    }),
  ).rejects.toThrow("No tool call was replayed");
  await expect(call({ action: "status", ...capture(), serverId: "gone" })).rejects.toThrow(
    "no longer exists",
  );
  await expect(
    call({ action: "status", ...capture(), expectedRevision: "c".repeat(64) }),
  ).rejects.toThrow(/conflict|changed/);
  expect(await call({ action: "cancel", attemptId: randomUUID() })).toEqual({ completed: true });
  const signOut = { action: "sign-out" as const, ...capture(), requestId: randomUUID() };
  expect(await call(signOut)).toMatchObject({ status: "signed-out" });
  expect(await call(signOut)).toMatchObject({ status: "signed-out" });
  host.mcpDetach("page");
  await expect(
    call({ action: "preview", ...capture(), allowPrivateIssuer: false }),
  ).rejects.toThrow("No tool call was replayed");
});
it("surfaces locked storage without fallback and invalidates review after exact revision changes", async () => {
  const preview = await call({ action: "preview", ...capture(), allowPrivateIssuer: false });
  const request: McpAuthenticationRequest = {
    action: "credential-write",
    ...capture(),
    requestId: randomUUID(),
    previewId: preview.previewId!,
    reference: "token",
    secret: "synthetic",
    storage: "persistent",
  };
  await expect(call(request)).rejects.toMatchObject({ status: "locked" });
  await expect(call(request)).rejects.toMatchObject({ status: "locked" });
  expect(native).toHaveBeenCalledOnce();
  await host.mcpSave({
    target,
    expectedRevision: revision,
    requestId: randomUUID(),
    document: { ...doc, servers: { docs: { ...doc.servers.docs!, label: "Edited" } } },
  });
  await expect(call({ ...request, requestId: randomUUID() })).rejects.toThrow(/conflict|changed/);
  expect(await call({ action: "sign-out", ...capture(), requestId: randomUUID() })).toMatchObject({
    status: "deletion-uncertain",
  });
  await host.shutdown(true);
  await expect(call({ action: "status", ...capture() })).rejects.toThrow("unavailable");
});
it("uses actual callback ownership and never starts OAuth from an unapproved or stale project owner", async () => {
  await host.connect(join(root, "projects.sqlite"), true);
  await fs.mkdir(join(root, "project"));
  await host.open(join(root, "project"));
  target = (await host.mcpTargets()).targets.find(
    (entry) => entry.address.scope === "project",
  )!.address;
  await host.mcpSave({
    target,
    expectedRevision: (await host.mcpRead(target)).revision,
    requestId: randomUUID(),
    document: {
      version: 1,
      servers: {
        docs: {
          type: "http",
          label: "OAuth",
          enabled: false,
          url: `${remote.origin}/mcp`,
          headers: {},
          auth: { type: "oauth", scopes: [], clientId: "supplied-native" },
        },
      },
    },
  });
  revision = (await host.mcpRead(target)).revision;
  expect(await call({ action: "status", ...capture() })).toMatchObject({ status: "required" });
  await expect(
    call({ action: "preview", ...capture(), allowPrivateIssuer: false }),
  ).rejects.toThrow("approve");
  expect(remote.events).toHaveLength(0);
  await host.mcpRuntime(
    { action: "approve", target, expectedRevision: revision, requestId: randomUUID() },
    "page",
  );
  const first = await call({ action: "preview", ...capture(), allowPrivateIssuer: false });
  expect(first.issuers).toEqual([remote.issuer]);
  const reviewed = await call({
    action: "preview",
    ...capture(),
    issuer: remote.issuer,
    allowPrivateIssuer: false,
  });
  const started = await call({
    action: "start",
    ...capture(),
    requestId: randomUUID(),
    previewId: reviewed.previewId!,
    storage: "temporary",
  });
  expect(started.status).toBe("pending");
  await call({ action: "cancel", attemptId: started.attemptId! });
  await vi.waitFor(async () =>
    expect(await call({ action: "status", ...capture() })).toMatchObject({ status: "cancelled" }),
  );
  if (target.scope !== "project") throw new Error();
  await host.projectAction({ type: "close", projectId: target.projectId });
  await expect(call({ action: "sign-out", ...capture(), requestId: randomUUID() })).rejects.toThrow(
    /conflict|closed|no longer/,
  );
  expect(remote.counts.token).toBe(0);
});

it("projects explicit troubleshooting reads into counts only and preserves malformed files and unrelated runtime", async () => {
  const report = (await host.mcpRuntime({ action: "report", target }, "page")).report;
  expect(report).toMatchObject({
    version: 1,
    scope: "user",
    configuration: "valid",
    definitions: 1,
    enabled: 0,
    projectApproval: "not-required",
    authentication: { notChecked: 1 },
    connections: { notTested: 1 },
  });
  expect(JSON.stringify(report)).not.toMatch(
    /credentialRef|TOKEN|token|docs|command|targetId|serverId|url|path/,
  );
  const file = join(root, "config/code60/mcp.json");
  const malformed = '{"SECRET_KEY":"SYNTHETIC_SECRET",';
  await fs.writeFile(file, malformed, { mode: 0o600 });
  const invalid = (await host.mcpRuntime({ action: "report", target }, "page")).report;
  expect(invalid).toMatchObject({ configuration: "invalid", definitions: 0, enabled: 0 });
  expect(invalid?.issues).toBeGreaterThan(0);
  expect(JSON.stringify(invalid)).not.toMatch(/SECRET_KEY|SYNTHETIC_SECRET/);
  expect(await fs.readFile(file, "utf8")).toBe(malformed);
  expect(await host.mcpRecovery({ action: "list", target })).toEqual({ pending: [] });
  expect(() => host.mcpRecovery({ action: "list", target, path: "/private" } as never)).toThrow(
    "Invalid MCP management request",
  );
  expect(
    await host.mcpRuntime({ action: "verify-cleanup", target, requestId: randomUUID() }, "page"),
  ).toEqual({ completed: true, unresolvedCleanup: 0 });
  expect(native).not.toHaveBeenCalled();
});
