import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_HEARTBEAT_POLICY, type HealthSnapshot } from "../bridge/index.js";
import { defaultDeps } from "../core/index.js";
import { type HeartbeatPorts, HeartbeatService } from "./heartbeat.js";

const tempDirs: string[] = [];
afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function makeStateEnv() {
  const dir = await mkdtemp(join(tmpdir(), "code60-hb-svc-"));
  tempDirs.push(dir);
  return { XDG_STATE_HOME: dir };
}

function healthyHealthSnapshot(): HealthSnapshot {
  return {
    revision: 1,
    generatedAt: "2026-11-27T12:00:00.000Z",
    runningCount: 0,
    environment: {
      collectedAt: "2026-11-27T12:00:00.000Z",
      code60Version: "0.5.0-beta",
      gatewayVersion: 1,
      installMode: "source",
      osName: "macOS",
      platform: "darwin",
      arch: "arm64",
      osRelease: "24.0.0",
      cpuCores: 8,
      cpuModel: "Apple",
      freeMemoryBytes: 8_000_000_000,
      totalMemoryBytes: 16_000_000_000,
      uptimeSeconds: 3600,
      timeZone: "UTC",
      localTimeIso: "2026-11-27T12:00:00.000Z",
      nodeVersion: "v24.22.0",
      acpProtocol: "1",
      mcpProtocol: "2025-03-26",
      databaseSchema: "5",
      runRecordFormat: "1",
      embeddingModelId: null,
      onnxRuntime: null,
      shell: "/bin/zsh",
      pathRecovered: true,
      databaseConnected: true,
      openProjectCount: 0,
      activeWorkerCount: 0,
      webServerEnabled: false,
      requirePairing: false,
      host: {
        hostname: "localhost",
        localAddresses: [],
        primaryPrivateIPv4: null,
        proxyConfigured: false,
        proxySummary: null,
        backendOrigin: null,
        stateRoot: "/tmp",
        databaseLabel: null,
      },
    },
    checks: [
      {
        id: "backend-connection",
        group: "services",
        title: "Backend connection",
        question: "Is backend reachable?",
        mode: "passive",
        status: "healthy",
        summary: "Connected",
        checkedAt: "2026-11-27T12:00:00.000Z",
        running: false,
      },
    ],
  };
}

function makePorts(
  env: Readonly<NodeJS.ProcessEnv>,
  overrides: Partial<HeartbeatPorts> = {},
): HeartbeatPorts {
  let pausedAll = false;
  let block: {
    reason: "leftover_agent" | "persistence_failed";
    executionId: string | null;
    runId: string | null;
  } | null = null;
  return {
    env,
    deps: defaultDeps(),
    now: () => new Date("2026-11-27T12:00:00.000Z"),
    tempDir: () => env.XDG_STATE_HOME ?? tmpdir(),
    runPassiveHealthCheck: async () => healthyHealthSnapshot(),
    probeVolumes: async (inputs) =>
      inputs.map((i) => ({
        id: i.id,
        label: i.label,
        path: i.path,
        availableBytes: 20 * 1024 ** 3,
        totalBytes: 100 * 1024 ** 3,
        freePercent: 20,
      })),
    scheduler: {
      status: () => ({
        version: 1,
        appVersion: "0.5.0-beta",
        pid: process.pid,
        startedAt: "2026-11-27T10:00:00.000Z",
        revision: 1,
        pausedAll,
        block,
        activeExecutionId: null,
        activeExecutionIds: [],
      }),
      executionCount: () => 5,
      listEnabledJobs: () => [],
      resolveBlock: async () => {
        block = null;
        return true;
      },
      pauseAll: async () => {
        pausedAll = true;
      },
      resumeAll: async () => {
        pausedAll = false;
      },
    },
    runtime: {
      repoPaths: () => [],
      pinnedWorktreesAndRuns: () => ({ worktrees: new Set(), runIds: new Set() }),
      inspectWedgedRuns: () => [],
      recoverWedgedRun: async () => true,
      healRuntime: async () => ({
        restartedSidecars: 0,
        sidecarIssues: [],
        relayReconnected: false,
        relayError: null,
      }),
    },
    ...overrides,
  };
}

describe("HeartbeatService", () => {
  it("runs a manual sweep, records initiation/termination/duration, persists state, and emits updates", async () => {
    const env = await makeStateEnv();
    let tick = Date.parse("2026-11-27T12:00:00.000Z");
    const service = new HeartbeatService(
      makePorts(env, {
        now: () => {
          tick += 50;
          return new Date(tick);
        },
      }),
    );
    const updates = vi.fn();
    service.subscribe(updates);
    await service.start();

    const snap = await service.handle({ action: "run", mode: "maintain" });
    expect(snap.running).toBe(false);
    expect(snap.lastCompletedRun).not.toBeNull();
    expect(snap.lastCompletedRun?.trigger).toBe("manual");
    expect(snap.lastCompletedRun?.startedAt).toBeTruthy();
    expect(snap.lastCompletedRun?.endedAt).toBeTruthy();
    expect((snap.lastCompletedRun?.durationMs ?? 0) > 0).toBe(true);
    expect(snap.lastCompletedRun?.actions).toHaveLength(8);
    expect(updates).toHaveBeenCalled();

    const redacted = service.redactedStatus();
    expect(redacted.lastRun?.status).toBe("healthy");
    expect(redacted.lastRun?.startedAt).toBe(snap.lastCompletedRun?.startedAt);

    await service.stop();

    const reloaded = new HeartbeatService(makePorts(env));
    await reloaded.start();
    expect(reloaded.snapshot().recentRuns).toHaveLength(1);
    expect(reloaded.snapshot().lastCompletedRun?.id).toBe(snap.lastCompletedRun?.id);
    await reloaded.stop();
  });

  it("applies 2 GiB pause and 4 GiB hysteresis resume without overriding manual pause", async () => {
    const env = await makeStateEnv();
    let availableBytes = 1 * 1024 ** 3;
    let pausedAll = false;
    const pauseAll = vi.fn(async () => {
      pausedAll = true;
    });
    const resumeAll = vi.fn(async () => {
      pausedAll = false;
    });

    const service = new HeartbeatService(
      makePorts(env, {
        probeVolumes: async (inputs) =>
          inputs.map((i) => ({
            id: i.id,
            label: i.label,
            path: i.path,
            availableBytes,
            totalBytes: 100 * 1024 ** 3,
            freePercent: Math.round((availableBytes / (100 * 1024 ** 3)) * 100),
          })),
        scheduler: {
          status: () => ({
            version: 1,
            appVersion: "0.5.0-beta",
            pid: process.pid,
            startedAt: "2026-11-27T10:00:00.000Z",
            revision: 1,
            pausedAll,
            block: null,
            activeExecutionId: null,
            activeExecutionIds: [],
          }),
          executionCount: () => 10,
          listEnabledJobs: () => [],
          resolveBlock: async () => true,
          pauseAll,
          resumeAll,
        },
      }),
    );
    await service.start();

    const pausedSnap = await service.handle({ action: "run", mode: "maintain" });
    expect(pauseAll).toHaveBeenCalledTimes(1);
    expect(pausedSnap.lowDiskPausedByHeartbeat).toBe(true);

    availableBytes = 3 * 1024 ** 3;
    await service.handle({ action: "run", mode: "maintain" });
    expect(resumeAll).not.toHaveBeenCalled();

    availableBytes = 5 * 1024 ** 3;
    const resumedSnap = await service.handle({ action: "run", mode: "maintain" });
    expect(resumeAll).toHaveBeenCalledTimes(1);
    expect(resumedSnap.lowDiskPausedByHeartbeat).toBe(false);
    await service.stop();
  });

  it("auto-clears verified leftover_agent scheduler block and persists updated policy", async () => {
    const env = await makeStateEnv();
    let block: { reason: "leftover_agent"; executionId: string; runId: string } | null = {
      reason: "leftover_agent",
      executionId: "00000000-0000-4000-8000-000000000001",
      runId: "auto-1",
    };
    const resolveBlock = vi.fn(async () => {
      block = null;
      return true;
    });

    const service = new HeartbeatService(
      makePorts(env, {
        scheduler: {
          status: () => ({
            version: 1,
            appVersion: "0.5.0-beta",
            pid: process.pid,
            startedAt: "2026-11-27T10:00:00.000Z",
            revision: 1,
            pausedAll: false,
            block,
            activeExecutionId: null,
            activeExecutionIds: [],
          }),
          executionCount: () => 4500,
          listEnabledJobs: () => [],
          resolveBlock,
          pauseAll: async () => {},
          resumeAll: async () => {},
        },
      }),
    );
    await service.start();

    const snap = await service.handle({ action: "run", mode: "maintain" });
    expect(resolveBlock).toHaveBeenCalledTimes(1);
    const watchdog = snap.lastCompletedRun?.actions.find(
      (a) => a.actionId === "stuck-execution-watchdog",
    );
    expect(watchdog?.status).toBe("remediated");
    expect(watchdog?.findings.some((f) => f.code === "leftover_block_cleared")).toBe(true);

    const drift = snap.lastCompletedRun?.actions.find(
      (a) => a.actionId === "scheduler-drift-audit",
    );
    expect(drift?.status).toBe("warning");
    expect(drift?.findings.some((f) => f.code === "execution_capacity_warning")).toBe(true);

    const updated = await service.handle({
      action: "updatePolicy",
      policy: { ...DEFAULT_HEARTBEAT_POLICY, enabled: false, intervalMinutes: 30 },
    });
    expect(updated.policy.enabled).toBe(false);
    expect(updated.policy.intervalMinutes).toBe(30);
    expect(updated.nextRunAt).toBeNull();
    await service.stop();
  });
});
