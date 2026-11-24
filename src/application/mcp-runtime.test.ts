import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpRuntime, type McpRuntimePorts, type McpRuntimeSnapshot } from "./mcp-runtime.js";

const targetId = "a".repeat(64);
const projectId = "b".repeat(64);
const revision = "c".repeat(64);
const nextRevision = "d".repeat(64);
const definition = {
  label: "Fixture",
  enabled: true,
  type: "stdio" as const,
  command: "synthetic",
  args: [],
  env: {},
};
const snapshot = (): McpRuntimeSnapshot => ({
  role: "relay",
  user: { targetId, revision, document: { version: 1, servers: { fixture: definition } } },
});
describe("MCP runtime ownership and policy", () => {
  let directory: string;
  let runtime: McpRuntime;
  let exposures: Parameters<McpRuntimePorts["expose"]>[0][];
  let inputs: Parameters<McpRuntimePorts["connect"]>[0][];
  let ports: McpRuntimePorts;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "code60-mcp-runtime-"));
    inputs = [];
    exposures = [];
    ports = {
      async connect(input) {
        inputs.push(input);
        return {
          tools: [{ name: "tool" }],
          call: async () => ({ content: [] }),
          close: async () => {},
        };
      },
      async expose(input) {
        exposures.push(input);
        return {
          descriptor: {
            type: "stdio",
            name: input.id,
            command: "/fixed-adapter",
            args: [],
            env: [],
          },
          revoke: async () => {},
        };
      },
    };
    runtime = new McpRuntime(join(directory, "runtime"), ports, () => {}, {
      PATH: "/approved/path",
    });
  });
  afterEach(async () => {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  });
  const controls = () => ({
    idle: () => true,
    canRestore: () => true,
    reconnect: vi.fn(async () => {}),
  });
  const context = () => ({
    runId: randomUUID(),
    provider: "fixture",
    cwd: "/actual/worker-worktree",
    controls: controls(),
  });
  it("uses actual execution cwd but canonical project configuration and exact-revision approval", async () => {
    const value = snapshot();
    value.role = "worker";
    value.project = {
      projectId,
      revision,
      document: { version: 1, servers: { fixture: { ...definition, command: "project-command" } } },
    };
    const factory = runtime.factory(
      async () => value,
      () => {},
    );
    const blocked = await factory(context());
    expect(blocked.servers).toEqual([]);
    expect(inputs).toEqual([]);
    await runtime.approve(projectId, revision, randomUUID(), true);
    const active = await factory(context());
    expect(active.servers).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      cwd: "/actual/worker-worktree",
      definition: { command: "project-command" },
    });
    expect((await stat(join(directory, "runtime/trust.json"))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(directory, "runtime/trust.json"), "utf8")).not.toContain(
      "project-command",
    );
    value.project.revision = nextRevision;
    expect((await factory(context())).servers).toEqual([]);
    value.project.document.servers.fixture!.enabled = false;
    await runtime.approve(projectId, nextRevision, randomUUID(), true);
    expect((await factory(context())).servers).toEqual([]);
    expect(inputs).toHaveLength(1);
    expect(runtime.status(projectId).flatMap((session) => session.connectors)[0]?.revision).toBe(
      revision,
    );
  });
  it.each([
    "scheduler",
    "provider-verification",
    "memory-helper",
    "search-helper",
    "isolated-helper",
  ] as const)("excludes %s", async (role) => {
    const value = snapshot();
    value.role = role;
    const resources = await runtime.factory(
      async () => value,
      () => {},
    )(context());
    expect(resources.servers).toEqual([]);
    expect(inputs).toEqual([]);
  });
  it("keeps unresolved references and OAuth separate from enablement/approval", async () => {
    const value = snapshot();
    value.user.document.servers.fixture = {
      ...definition,
      env: { TOKEN: { credentialRef: "token" } },
    };
    value.user.document.servers.oauth = {
      type: "http",
      label: "OAuth",
      enabled: true,
      url: "https://example.invalid/mcp",
      headers: {},
      auth: { type: "oauth", scopes: [] },
    };
    const warnings: string[] = [];
    const resources = await runtime.factory(
      async () => value,
      (message) => warnings.push(message),
    )(context());
    expect(resources.servers).toEqual([]);
    expect(inputs).toEqual([]);
    expect(warnings).toHaveLength(2);
    expect(
      runtime.status(targetId)[0]?.connectors.map((connector) => connector.connection),
    ).toEqual(["authentication-required", "authentication-required"]);
  });
  it("rejects late completions after cancellation, while a fresh turn gets fresh authority", async () => {
    let complete!: (value: unknown) => void;
    let callSignal: AbortSignal | undefined;
    ports.connect = async () => ({
      tools: [{ name: "tool", annotations: { readOnlyHint: true } }],
      close: async () => {},
      call: async (_name, _args, signal) => {
        callSignal = signal;
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    });
    const resources = await runtime.factory(
      async () => snapshot(),
      () => {},
    )(context());
    const exposure = exposures[0]!;
    await expect(exposure.call("tool", {}, new AbortController().signal)).rejects.toThrow(
      "not authorized",
    );
    resources.beginTurn(Date.now() + 10_000);
    const pending = exposure.call("tool", {}, new AbortController().signal);
    resources.endTurn();
    expect(callSignal?.aborted).toBe(true);
    resources.beginTurn(Date.now() + 10_000);
    complete({ content: [] });
    await expect(pending).rejects.toThrow("must not be replayed");
    await resources.close();
    await expect(exposure.call("tool", {}, new AbortController().signal)).rejects.toThrow(
      "not authorized",
    );
  });
  it("requires idle/supported restoration, previews every affected connector and replays a connection action only once", async () => {
    let idle = false;
    let supported = false;
    const reconnect = vi.fn(async () => {});
    const value = snapshot();
    value.user.document.servers.second = { ...definition };
    await runtime.factory(
      async () => value,
      () => {},
    )({ ...context(), controls: { idle: () => idle, canRestore: () => supported, reconnect } });
    const generation = runtime.status(targetId)[0]!.sessionGeneration;
    expect(() => runtime.preview(targetId, generation, "reconnect", ["fixture"])).toThrow("idle");
    idle = true;
    expect(() => runtime.preview(targetId, generation, "reconnect", ["fixture"])).toThrow(
      "load/resume",
    );
    supported = true;
    expect(runtime.preview(targetId, generation, "reconnect", ["fixture"]).connectors).toHaveLength(
      2,
    );
    const id = randomUUID();
    await runtime.connectionAction(
      targetId,
      generation,
      "reconnect",
      ["fixture"],
      id,
      async () => {},
    );
    await runtime.connectionAction(targetId, generation, "reconnect", ["fixture"], id, async () => {
      throw new Error();
    });
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(() =>
      runtime.connectionAction(targetId, generation, "disconnect", ["fixture"], id, async () => {}),
    ).toThrow("Conflicting");
  });
  it("retains exact-revision approvals privately across restart and invalidates identity/revision changes", async () => {
    const id = randomUUID();
    await runtime.approve(projectId, revision, id, true);
    await runtime.close();
    runtime = new McpRuntime(join(directory, "runtime"), ports, () => {}, {});
    expect(await runtime.approval(projectId, revision)).toBe(true);
    expect(await runtime.approval(targetId, revision)).toBe(false);
    expect(await runtime.approval(projectId, nextRevision)).toBe(false);
    await runtime.approve(projectId, revision, id, true, async () => {
      throw new Error("Must not re-approve on replay");
    });
    await expect(runtime.approve(projectId, revision, id, false)).rejects.toThrow("Conflicting");
  });
  it("caps concurrent initialization at four and drains page-owned tests on detach/shutdown", async () => {
    let active = 0;
    let peak = 0;
    ports.connect = async ({ signal }) => {
      active++;
      peak = Math.max(peak, active);
      try {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
        });
        throw new Error();
      } finally {
        active--;
      }
    };
    const tests = Array.from({ length: 7 }, () =>
      runtime.test({
        targetId,
        serverId: "fixture",
        revision,
        definition,
        cwd: directory,
        page: "page",
        requestId: randomUUID(),
      }),
    );
    await expect.poll(() => active).toBe(4);
    runtime.detach("other-page");
    expect(active).toBe(4);
    runtime.detach("page");
    expect((await Promise.all(tests)).every((result) => result.connection === "cancelled")).toBe(
      true,
    );
    expect(peak).toBe(4);
    expect(active).toBe(0);
  });
  it("refuses excess connections without evicting existing instances", async () => {
    const value = snapshot();
    value.user.document.servers = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [`server-${index}`, { ...definition }]),
    );
    const resources = [];
    for (let index = 0; index < 4; index++)
      resources.push(
        await runtime.factory(
          async () => value,
          () => {},
        )(context()),
      );
    expect(inputs).toHaveLength(256);
    const warnings: string[] = [];
    const excess = await runtime.factory(
      async () => snapshot(),
      (warning) => warnings.push(warning),
    )(context());
    expect(excess.servers).toEqual([]);
    expect(inputs).toHaveLength(256);
    expect(
      runtime
        .status(targetId)
        .flatMap((session) => session.connectors)
        .filter((connector) => connector.connection === "connected"),
    ).toHaveLength(256);
    expect(warnings).toHaveLength(1);
    await Promise.all(resources.map((resource) => resource.close()));
  });
  it("binds reviewed reconnection to its page and all captured configuration, while disconnect remains possible after malformed replacement", async () => {
    let invalid = false;
    const value = snapshot();
    await runtime.factory(
      async () => {
        if (invalid) throw new Error("invalid document");
        return value;
      },
      () => {},
    )(context());
    const generation = runtime.status(targetId)[0]!.sessionGeneration;
    const reviewed = await runtime.review(targetId, generation, "reconnect", ["fixture"], "page");
    await expect(
      runtime.validateReview(reviewed.previewId, "other-page", targetId, generation, "reconnect", [
        "fixture",
      ]),
    ).rejects.toThrow("expired");
    value.user.revision = nextRevision;
    await expect(
      runtime.validateReview(reviewed.previewId, "page", targetId, generation, "reconnect", [
        "fixture",
      ]),
    ).rejects.toThrow("changed");
    invalid = true;
    const disconnect = await runtime.review(
      targetId,
      generation,
      "disconnect",
      ["fixture"],
      "page",
    );
    await runtime.validateReview(disconnect.previewId, "page", targetId, generation, "disconnect", [
      "fixture",
    ]);
    await runtime.connectionAction(
      targetId,
      generation,
      "disconnect",
      ["fixture"],
      randomUUID(),
      async () => {},
    );
    expect(runtime.status(targetId)[0]?.connectors[0]?.connection).toBe("disconnected");
  });
  it("retains cleanup ownership and reports uncertainty until verification succeeds", async () => {
    let available = false;
    const cleanup = vi.fn(async () => {
      if (!available) throw new Error("unverified group");
    });
    ports.connect = async () => {
      throw Object.assign(new Error("failed setup"), { cleanup });
    };
    await runtime.factory(
      async () => snapshot(),
      () => {},
    )(context());
    expect(runtime.status(targetId)[0]?.connectors[0]?.connection).toBe("cleanup-unresolved");
    await expect(runtime.close()).rejects.toThrow("cleanup remains unresolved");
    available = true;
    await runtime.close();
    expect(cleanup.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it("uses prototype-free binding maps and rejects transport-owned HTTP headers", async () => {
    const value = snapshot();
    value.user.document.servers.fixture = {
      ...definition,
      env: { constructor: { value: "explicit literal" } },
    };
    const resources = await runtime.factory(
      async () => value,
      () => {},
    )(context());
    expect(inputs[0]?.environment.constructor).toBe("explicit literal");
    expect(Object.getPrototypeOf(inputs[0]?.environment)).toBeNull();
    await resources.close();
    for (const name of ["Host", "Mcp-Method", "TE", "Trailer", "Keep-Alive", "Proxy-Connection"]) {
      const invalid = snapshot();
      invalid.user.document.servers.fixture = {
        label: "HTTP",
        enabled: true,
        type: "http",
        url: "https://example.invalid/mcp",
        headers: { [name]: { value: "forbidden" } },
        auth: { type: "none" },
      };
      expect(
        (
          await runtime.factory(
            async () => invalid,
            () => {},
          )(context())
        ).servers,
      ).toEqual([]);
    }
    expect(inputs).toHaveLength(1);
  });
  it("records test outcomes once per identical request and never silently relaunches an uncertain cleanup", async () => {
    const request = {
      targetId,
      serverId: "fixture",
      revision,
      definition,
      cwd: directory,
      page: "page",
      requestId: randomUUID(),
    };
    expect(await runtime.test(request)).toEqual({ connection: "connected", tools: 1 });
    expect(await runtime.test(request)).toEqual({ connection: "connected", tools: 1 });
    expect(inputs).toHaveLength(1);
    expect(() => runtime.test({ ...request, cwd: "/different" })).toThrow("Conflicting");
  });
});

it.each(["upstream", "adapter"] as const)(
  "does not revive a connector disconnected during %s setup",
  async (stage) => {
    const directory = await mkdtemp(join(tmpdir(), "code60-mcp-setup-revoke-"));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const close = vi.fn(async () => {});
    const revoke = vi.fn(async () => {});
    const expose = vi.fn(async () => {
      if (stage === "adapter") await gate;
      return { descriptor: { name: "fixture", command: "/fixed", args: [], env: [] }, revoke };
    });
    const connect = vi.fn(async () => {
      if (stage === "upstream") await gate;
      return { tools: [], call: async () => ({}), close };
    });
    const runtime = new McpRuntime(join(directory, "runtime"), { connect, expose }, () => {}, {});
    try {
      const pending = runtime.factory(
        async () => snapshot(),
        () => {},
      )({
        runId: randomUUID(),
        provider: "fixture",
        cwd: "/actual",
        controls: { idle: () => true, canRestore: () => true, reconnect: async () => {} },
      });
      await vi.waitFor(() =>
        expect(stage === "upstream" ? connect : expose).toHaveBeenCalledOnce(),
      );
      const generation = runtime.status(targetId)[0]!.sessionGeneration;
      await runtime.connectionAction(
        targetId,
        generation,
        "disconnect",
        ["fixture"],
        randomUUID(),
        async () => {},
      );
      release();
      expect((await pending).servers).toEqual([]);
      expect(close).toHaveBeenCalledOnce();
      if (stage === "adapter") expect(revoke).toHaveBeenCalledOnce();
      else expect(expose).not.toHaveBeenCalled();
    } finally {
      release();
      await runtime.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
