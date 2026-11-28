import { describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../bridge/index.js";
import { CODE60_VERSION } from "../core/index.js";
import {
  buildProviderDescriptors,
  type HealthCheckPorts,
  HealthCheckService,
} from "./health-check.js";

function makeAppSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    directory: "/tmp/project",
    workspace: "/tmp/project",
    database: "/tmp/code60/default.sqlite",
    databaseError: null,
    openProjects: [{ id: "p1", path: "/tmp/project", active: false, chatIds: [], workerIds: [] }],
    projects: [],
    configurations: [],
    commands: [],
    agents: ["claude"],
    defaultAgent: "claude",
    maxParallel: 4,
    turnTimeout: "30m",
    runs: [],
    liveIds: [],
    active: false,
    warnings: [],
    events: [],
    worktrees: { repository: "/tmp/project", worktrees: [] },
    files: null,
    polling: { paused: false, sources: [] },
    prompts: [],
    workers: [],
    revision: 1,
    versions: {
      code60: CODE60_VERSION,
      databaseSchema: 5,
      runRecordFormat: 1,
      acpProtocol: 1,
      mcpProtocol: "2025-03-26",
      electron: null,
      chromium: null,
      node: "24.22.0",
      embeddingModel: {
        id: "jinaai/jina-embeddings-v2-base-code",
        revision: "516f4baf",
        dimensions: 768,
        dtype: "q8",
      },
      onnxRuntime: { name: "onnxruntime-node", version: "1.30.0", execution: "cpu" },
    },
    orchestration: { provider: "claude", allowAll: false, connection: "connected", error: null },
    agentSetup: {
      complete: true,
      primary: "claude",
      enabled: ["claude"],
      providers: [],
      session: null,
    },
    chat: {
      kind: "relay",
      run: { id: "relay-1", status: "idle" } as unknown as Snapshot["chat"]["run"],
      directory: null,
      error: null,
      events: [],
      updates: { paused: false, pending: 0 },
      historySaving: "available",
    },
    chats: [
      {
        kind: "relay",
        run: { id: "relay-1", status: "idle" } as unknown as Snapshot["chat"]["run"],
        directory: null,
        error: null,
        events: [],
        updates: { paused: false, pending: 0 },
        historySaving: "available",
      },
    ],
    ...overrides,
  } as unknown as Snapshot;
}

function makePorts(overrides: Partial<HealthCheckPorts> = {}): HealthCheckPorts {
  return {
    env: { HOME: "/tmp/home", SHELL: "/bin/zsh" },
    now: () => new Date("2026-11-25T14:00:00.000Z"),
    gateway: () => ({
      appVersion: CODE60_VERSION,
      gatewayVersion: 1,
      pid: 999,
      origin: "http://127.0.0.1:43210",
      webServerEnabled: false,
      requirePairing: false,
      startedAt: "2026-11-25T13:00:00.000Z",
      installMode: "managed",
    }),
    appSnapshot: () => makeAppSnapshot(),
    schedulerStatus: async () => ({
      status: {
        installed: true,
        nativeState: "running",
        service: {
          version: 1,
          appVersion: CODE60_VERSION,
          pid: 999,
          startedAt: "2026-11-25T13:00:00.000Z",
          revision: 2,
          pausedAll: false,
          block: null,
          activeExecutionId: null,
        },
      },
      error: null,
      recentLowDiskCount: 0,
      recentFailedCount: 0,
    }),
    providers: () => [
      {
        id: "claude",
        name: "Claude",
        primary: true,
        enabled: true,
        configured: true,
        commandDrifted: false,
        commandLabel: "npx",
      },
      {
        id: "codex",
        name: "Codex",
        primary: false,
        enabled: false,
        configured: true,
        commandDrifted: false,
        commandLabel: "npx",
      },
    ],
    refreshPath: async () => true,
    detectProvider: async (id) => {
      if (id !== "claude") throw new Error(`${id} was not found.`);
    },
    probeProvider: async (id) => {
      if (id !== "claude") throw new Error("Authentication required");
    },
    gitVersion: async () => "git version 2.47.0",
    projectGitStatuses: async () => [{ id: "p1", label: "project", status: "ready" }],
    memorySnapshot: async () => ({
      settings: { version: 2, enabled: true, retentionDays: 90 },
      provider: "claude",
      warning: null,
      busy: false,
      count: 12,
      bytes: 4096,
      indexPending: 0,
      indexFailed: false,
      projects: [],
      conversations: [],
    }),
    ragStatus: async () => ({
      status: {
        databaseKey: "abc",
        revision: 1,
        model: "Jina",
        index: null,
        operation: null,
        error: null,
      },
      modelRoot: "/tmp/models",
    }),
    mcpSummary: async () => ({
      targetCount: 2,
      unavailableProjects: 0,
      recoveryPending: 0,
      issueCount: 0,
    }),
    logStatus: () => ({ unavailable: false, dropped: 0, persistenceFailures: 0, malformed: 0 }),
    machineInfo: async () => ({
      platform: "darwin",
      osName: "macOS (Darwin 24.1.0)",
      osRelease: "24.1.0",
      arch: "arm64",
      cpuModel: "Apple M3",
      cpuCores: 8,
      totalMemoryBytes: 16 * 1024 ** 3,
      freeMemoryBytes: 8 * 1024 ** 3,
      uptimeSeconds: 3600,
      timeZone: "America/Denver",
      localTimeIso: "2026-11-25T14:00:00.000Z",
      hostname: "dev-mac.local",
      localAddresses: [
        { interfaceName: "en0", family: "IPv4", address: "192.168.1.10", primary: true },
      ],
      primaryPrivateIPv4: "192.168.1.10",
      proxyConfigured: false,
      proxySummary: null,
    }),
    volumeSpace: async (inputs) =>
      inputs.map((input) => ({
        id: input.id,
        label: input.label,
        availableBytes: 50 * 1024 ** 3,
        totalBytes: 250 * 1024 ** 3,
        freePercent: 20,
      })),
    auditPrivateDir: async () => ({ status: "ok" }),
    directorySize: async () => ({
      bytes: 1024 * 1024,
      entries: 5,
      truncated: false,
      missing: false,
    }),
    verifyEmbeddingAssets: async (_root, verifyHashes) => ({
      present: 6,
      total: 6,
      verifiedHashes: verifyHashes,
      mismatched: [],
    }),
    ...overrides,
  };
}

describe("HealthCheckService", () => {
  it("runs passive checks on scope all(includeActive=false) without invoking active ACP probes", async () => {
    const probeProvider = vi.fn(async () => {});
    const service = new HealthCheckService(makePorts({ probeProvider }));

    const result = await service.handle({
      action: "run",
      scope: { kind: "all", includeActive: false },
    });

    expect(probeProvider).not.toHaveBeenCalled();
    expect(result.environment.host.hostname).toBe("dev-mac.local");
    expect(result.environment.host.primaryPrivateIPv4).toBe("192.168.1.10");

    const byId = new Map(result.checks.map((check) => [check.id, check]));
    expect(byId.get("backend-connection")?.status).toBe("healthy");
    expect(byId.get("backend-version")?.status).toBe("healthy");
    expect(byId.get("scheduler-status")?.status).toBe("healthy");
    expect(byId.get("scheduler-registration")?.status).toBe("healthy");
    expect(byId.get("scheduler-health")?.status).toBe("healthy");
    expect(byId.get("providers-installed")?.status).toBe("healthy");
    expect(byId.get("providers-authenticated")?.status).toBe("not_checked");
    expect(byId.get("git-toolchain")?.status).toBe("healthy");
    expect(byId.get("relay-health")?.status).toBe("healthy");
    expect(byId.get("database-health")?.status).toBe("healthy");
    expect(byId.get("storage-safety")?.status).toBe("healthy");
    expect(byId.get("memory-health")?.status).toBe("healthy");
    expect(byId.get("embeddings-rag")?.status).toBe("healthy");
    expect(byId.get("mcp-servers")?.status).toBe("healthy");
    expect(byId.get("disk-space")?.status).toBe("healthy");
    expect(byId.get("code60-quotas")?.status).toBe("healthy");
    expect(byId.get("diagnostic-logs")?.status).toBe("healthy");
    service.dispose();
  });

  it("supports granular single-provider auth probing and single-group rechecks", async () => {
    const probeProvider = vi.fn(async (id: string) => {
      if (id === "codex") throw new Error("Sign in to Codex");
    });
    const service = new HealthCheckService(
      makePorts({
        detectProvider: async () => {},
        probeProvider,
      }),
    );

    const claudeOnly = await service.handle({
      action: "run",
      scope: { kind: "check", checkId: "providers-authenticated", targetId: "claude" },
    });
    expect(probeProvider).toHaveBeenCalledTimes(1);
    expect(probeProvider).toHaveBeenCalledWith("claude", expect.any(AbortSignal));
    const authCheck = claudeOnly.checks.find((c) => c.id === "providers-authenticated");
    expect(authCheck?.status).toBe("healthy");
    expect(authCheck?.targets?.find((t) => t.id === "claude")?.status).toBe("healthy");
    expect(authCheck?.targets?.find((t) => t.id === "codex")?.status).toBe("not_checked");

    const codexOnly = await service.handle({
      action: "run",
      scope: { kind: "check", checkId: "providers-authenticated", targetId: "codex" },
    });
    const authAfter = codexOnly.checks.find((c) => c.id === "providers-authenticated");
    expect(authAfter?.targets?.find((t) => t.id === "codex")?.status).toBe("warning");
    expect(authAfter?.targets?.find((t) => t.id === "claude")?.status).toBe("healthy");
    service.dispose();
  });

  it("flags scheduler version mismatch, recovery blocks, low disk, unsafe storage and MCP recovery", async () => {
    const service = new HealthCheckService(
      makePorts({
        schedulerStatus: async () => ({
          status: {
            installed: true,
            nativeState: "stopped",
            service: {
              version: 1,
              appVersion: "0.3.9",
              pid: 555,
              startedAt: "2026-11-25T10:00:00.000Z",
              revision: 1,
              pausedAll: false,
              block: { reason: "leftover_agent", executionId: null, runId: "r1" },
              activeExecutionId: null,
            },
          },
          error: null,
          recentLowDiskCount: 0,
          recentFailedCount: 0,
        }),
        volumeSpace: async (inputs) =>
          inputs.map((input) => ({
            id: input.id,
            label: input.label,
            availableBytes: 1 * 1024 ** 3,
            totalBytes: 100 * 1024 ** 3,
            freePercent: 1,
          })),
        auditPrivateDir: async () => ({ status: "unsafe", code: "broad_permissions" }),
        logStatus: () => ({ unavailable: true, dropped: 3, persistenceFailures: 2, malformed: 0 }),
        mcpSummary: async () => ({
          targetCount: 1,
          unavailableProjects: 0,
          recoveryPending: 1,
          issueCount: 0,
        }),
      }),
    );

    const snapshot = await service.handle({
      action: "run",
      scope: { kind: "all", includeActive: true },
    });
    const byId = new Map(snapshot.checks.map((c) => [c.id, c]));
    expect(byId.get("scheduler-status")?.status).toBe("warning");
    expect(byId.get("scheduler-status")?.summary).toContain("0.3.9");
    expect(byId.get("scheduler-registration")?.status).toBe("warning");
    expect(byId.get("scheduler-health")?.status).toBe("error");
    expect(byId.get("disk-space")?.status).toBe("error");
    expect(byId.get("storage-safety")?.status).toBe("error");
    expect(byId.get("diagnostic-logs")?.status).toBe("error");
    expect(byId.get("mcp-servers")?.status).toBe("error");
    service.dispose();
  });

  it("handles cancellation of an in-flight probe cleanly and notifies subscribers", async () => {
    let releaseProbe!: () => void;
    const probeProvider = vi.fn(
      (_id: string, signal: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          releaseProbe = resolve;
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
    const service = new HealthCheckService(
      makePorts({ detectProvider: async () => {}, probeProvider }),
    );
    const updates: number[] = [];
    const off = service.subscribe((snap) => updates.push(snap.runningCount));

    const runningPromise = service.handle({
      action: "run",
      scope: { kind: "check", checkId: "providers-authenticated", targetId: "claude" },
    });
    await vi.waitFor(() => expect(service.snapshot().runningCount).toBe(1));

    const cancelled = await service.handle({
      action: "cancel",
      checkId: "providers-authenticated",
      targetId: "claude",
    });
    expect(cancelled.runningCount).toBe(0);
    await runningPromise;
    releaseProbe();
    off();
    expect(updates).toContain(1);
    expect(updates.at(-1)).toBe(0);
    service.dispose();
  });

  it("handles Relay error, missing Git, disabled Memory, and incomplete embeddings", async () => {
    const service = new HealthCheckService(
      makePorts({
        appSnapshot: () =>
          makeAppSnapshot({
            database: null,
            openProjects: [],
            chats: [
              {
                kind: "relay",
                run: null,
                directory: null,
                error: "Journal validation failed",
                events: [],
                updates: { paused: false, pending: 0 },
                historySaving: "unavailable",
              } as unknown as Snapshot["chats"][number],
            ],
          }),
        gitVersion: async () => null,
        memorySnapshot: async () => ({
          settings: { version: 2, enabled: false, retentionDays: 0 },
          provider: "claude",
          warning: null,
          busy: false,
          count: 4,
          bytes: 1024,
          indexPending: 0,
          indexFailed: false,
          projects: [],
          conversations: [],
        }),
        verifyEmbeddingAssets: async () => ({
          present: 3,
          total: 6,
          verifiedHashes: false,
          mismatched: ["onnx/model_quantized.onnx"],
        }),
      }),
    );
    const result = await service.handle({
      action: "run",
      scope: { kind: "all", includeActive: false },
    });
    const byId = new Map(result.checks.map((c) => [c.id, c]));
    expect(byId.get("relay-health")?.status).toBe("error");
    expect(byId.get("database-health")?.status).toBe("not_configured");
    expect(byId.get("git-toolchain")?.status).toBe("error");
    expect(byId.get("memory-health")?.status).toBe("not_configured");
    expect(byId.get("embeddings-rag")?.status).toBe("warning");
    service.dispose();
  });

  it("builds provider descriptors with primary, enabled and command drift flags", () => {
    const descriptors = buildProviderDescriptors(
      makeAppSnapshot(),
      (id) => (id === "claude" ? ["custom-claude", "acp"] : undefined),
      { claude: "stale-hash" },
    );
    const claude = descriptors.find((d) => d.id === "claude");
    expect(claude).toMatchObject({
      primary: true,
      enabled: true,
      commandDrifted: true,
      commandLabel: "custom-claude",
    });
    expect(descriptors.length).toBeGreaterThanOrEqual(7);
  });

  it("aborts a hung memory-health check promptly when cancelled", async () => {
    let startedResolve!: () => void;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const service = new HealthCheckService(
      makePorts({
        memorySnapshot: () => {
          startedResolve();
          return new Promise(() => {});
        },
      }),
    );

    const running = service.handle({
      action: "run",
      scope: { kind: "check", checkId: "memory-health" },
    });
    await started;
    const cancelled = service.cancel("memory-health");
    expect(cancelled.checks.find((c) => c.id === "memory-health")?.running).toBe(false);
    await running;
    service.dispose();
  });
});
