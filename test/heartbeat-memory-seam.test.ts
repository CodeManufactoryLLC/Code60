import { fork } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApplicationHost,
  HealthCheckService,
  HeartbeatService,
  openProjectDatabase,
} from "../src/application/index.js";
import { DEFAULT_MEMORY_SETTINGS } from "../src/bridge/index.js";
import { defaultDeps } from "../src/core/index.js";
import { FakeAgents, FakeClock, FakeGit, FakeProcesses } from "./fakes.js";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  fork: vi.fn(),
}));

/**
 * Scriptable fake sidecar at the OS `fork()` boundary only (KB-GOV-002 TEST-1.1.1).
 * ApplicationHost, MemoryService, HealthCheckService, and HeartbeatService all run real code
 * with zero internal method stubs across the seam (TEST-1.1.2, TEST-1.3.1).
 */
class ScriptedMemorySidecar extends EventEmitter {
  connected = true;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  failSnapshots = false;

  send = vi.fn((message: { id: string; op: string }, callback: (error: null) => void) => {
    callback(null);
    queueMicrotask(() => {
      if (message.op === "snapshot" && this.failSnapshots) {
        this.emit("message", {
          id: message.id,
          error: "Memory storage or search failed.",
        });
        return;
      }
      this.emit("message", {
        id: message.id,
        result: {
          settings: structuredClone(DEFAULT_MEMORY_SETTINGS),
          count: 2,
          bytes: 512,
          indexPending: 0,
          indexFailed: false,
          projects: [],
          conversations: [],
        },
      });
    });
  });

  disconnect = vi.fn(() => {
    this.connected = false;
    queueMicrotask(() => {
      this.exitCode = 0;
      this.emit("exit", 0, null);
    });
  });

  kill = vi.fn((signal?: NodeJS.Signals | number) => {
    queueMicrotask(() => {
      this.signalCode = typeof signal === "string" ? signal : "SIGTERM";
      this.emit("exit", null, this.signalCode);
    });
    return true;
  });
}

describe("Heartbeat + ApplicationHost + MemoryService + HealthCheck seam", () => {
  let stateDir: string;
  let children: ScriptedMemorySidecar[];
  let failNewWorkers: boolean;
  let controller: ApplicationHost | undefined;
  let healthCheck: HealthCheckService | undefined;
  let heartbeat: HeartbeatService | undefined;
  let nowMs: number;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "code60-hb-mem-seam-"));
    children = [];
    failNewWorkers = false;
    nowMs = Date.parse("2026-11-28T03:30:00.000Z");

    vi.mocked(fork).mockImplementation(() => {
      const child = new ScriptedMemorySidecar();
      child.failSnapshots = failNewWorkers;
      children.push(child);
      return child as unknown as ReturnType<typeof fork>;
    });

    const env = {
      HOME: stateDir,
      XDG_CONFIG_HOME: join(stateDir, "config"),
      XDG_STATE_HOME: join(stateDir, "state"),
      XDG_DATA_HOME: join(stateDir, "data"),
      SHELL: "/bin/sh",
    };
    const processes = new FakeProcesses();
    processes.alive.add(process.pid);
    const deps = {
      ...defaultDeps(),
      agents: new FakeAgents(),
      git: new FakeGit(),
      clock: new FakeClock(),
      processes,
      ownerPid: process.pid,
    };

    const app = new ApplicationHost(
      deps,
      env,
      { confirm: async () => true },
      {
        memory: true,
        openDatabase: openProjectDatabase,
        preferences: {
          read: async () => undefined,
          write: async () => {},
          agentSetup: async () => null,
          setAgentSetup: async () => {},
          orchestrationProvider: async () => null,
          setOrchestrationProvider: async () => {},
        },
      },
    );
    controller = app;

    const health = new HealthCheckService({
      env,
      now: () => new Date(nowMs),
      gateway: () => ({
        appVersion: "1.0.0-alpha.1",
        gatewayVersion: 1,
        pid: process.pid,
        origin: "http://127.0.0.1:4319",
        webServerEnabled: false,
        requirePairing: false,
        startedAt: "2026-11-28T03:00:00.000Z",
        installMode: "source",
      }),
      appSnapshot: () => app.snapshot(false, true),
      schedulerStatus: async () => ({
        status: {
          installed: false,
          nativeState: "running",
          service: null,
        },
        error: null,
        recentLowDiskCount: 0,
        recentFailedCount: 0,
      }),
      providers: () => [],
      refreshPath: async () => true,
      detectProvider: async () => {},
      probeProvider: async () => {},
      gitVersion: async () => "git version 2.47.0",
      projectGitStatuses: async () => [],
      memorySnapshot: () => app.memory.snapshot(),
      ragStatus: async () => ({
        status: {
          databaseKey: "seam-test",
          revision: 1,
          model: "Jina",
          index: null,
          operation: null,
          error: null,
        },
        modelRoot: join(stateDir, "models"),
      }),
      mcpSummary: async () => ({
        targetCount: 0,
        unavailableProjects: 0,
        recoveryPending: 0,
        issueCount: 0,
      }),
      logStatus: () => ({
        unavailable: false,
        dropped: 0,
        persistenceFailures: 0,
        malformed: 0,
      }),
      volumeSpace: async (inputs) =>
        inputs.map((i) => ({
          id: i.id,
          label: i.label,
          path: i.path,
          availableBytes: 50 * 1024 ** 3,
          totalBytes: 100 * 1024 ** 3,
          freePercent: 50,
        })),
      verifyEmbeddingAssets: async () => ({
        present: 6,
        total: 6,
        verifiedHashes: false,
        mismatched: [],
      }),
    });
    healthCheck = health;

    const hb = new HeartbeatService({
      env,
      deps,
      now: () => new Date(nowMs),
      tempDir: () => join(stateDir, "tmp"),
      runPassiveHealthCheck: async () =>
        health.handle({ action: "run", scope: { kind: "all", includeActive: false } }),
      probeVolumes: async (inputs) =>
        inputs.map((i) => ({
          id: i.id,
          label: i.label,
          path: i.path,
          availableBytes: 50 * 1024 ** 3,
          totalBytes: 100 * 1024 ** 3,
          freePercent: 50,
        })),
      scheduler: {
        status: () => ({
          version: 1,
          appVersion: "1.0.0-alpha.1",
          pid: process.pid,
          startedAt: "2026-11-28T03:00:00.000Z",
          revision: 1,
          pausedAll: false,
          block: null,
          activeExecutionId: null,
          activeExecutionIds: [],
        }),
        executionCount: () => 0,
        listEnabledJobs: () => [],
        resolveBlock: async () => true,
        pauseAll: async () => {},
        resumeAll: async () => {},
      },
      runtime: {
        repoPaths: () => app.heartbeatRepoPaths(),
        pinnedWorktreesAndRuns: () => app.heartbeatPinnedWorktreesAndRuns(),
        inspectWedgedRuns: () => app.heartbeatInspectWedgedRuns(),
        recoverWedgedRun: (runId) => app.heartbeatRecoverWedgedRun(runId),
        healRuntime: (opts) => app.heartbeatHealRuntime(opts),
      },
    });
    heartbeat = hb;
    await hb.start();
  });

  afterEach(async () => {
    await heartbeat?.stop();
    healthCheck?.dispose();
    await controller?.shutdown();
    await rm(stateDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("recovers an unresponsive sidecar without latching closed, keeps Health Check healthy across consecutive sweeps, and preserves responsive warnings", async () => {
    if (!controller || !healthCheck || !heartbeat) throw new Error("Missing seam fixture");
    // 1. Healthy baseline + transient startup availability warning clears automatically.
    controller.memory.reportUnavailable("Saved memory is unavailable. Check private storage.");
    const baseline = await healthCheck.handle({
      action: "run",
      scope: { kind: "check", checkId: "memory-health" },
    });
    const baselineCheck = baseline.checks.find((c) => c.id === "memory-health");
    expect(baselineCheck?.status).toBe("healthy");
    expect(children).toHaveLength(1);

    // 2. Fault injection: make worker #1 fail snapshot IPC (real worker error shape).
    const firstWorker = children[0];
    if (!firstWorker) throw new Error("Expected worker #1");
    firstWorker.failSnapshots = true;

    // Sweep 1 (maintain): Heartbeat detects unresponsive sidecar, retires it via retireSidecar(),
    // spawns worker #2, and verifies recovery without closing MemoryService.
    const sweep1 = await heartbeat.handle({ action: "run", mode: "maintain" });
    const heal1 = sweep1.lastCompletedRun?.actions.find((a) => a.actionId === "runtime-self-heal");
    expect(heal1?.status).toBe("remediated");
    expect(heal1?.remediatedCount).toBe(1);
    expect(heal1?.findings.some((f) => f.code === "sidecar_restarted")).toBe(true);
    expect(firstWorker.disconnect).toHaveBeenCalledOnce();
    expect(children).toHaveLength(2);
    expect(controller.memory.paused).toBe(false);

    // Post-heal liveness check via HealthCheckService (must NEVER report "Memory service is stopping").
    const afterHealHealth = await healthCheck.handle({
      action: "run",
      scope: { kind: "check", checkId: "memory-health" },
    });
    const afterHealCheck = afterHealHealth.checks.find((c) => c.id === "memory-health");
    expect(afterHealCheck?.status).toBe("healthy");
    expect(afterHealCheck?.detail ?? "").not.toContain("Memory service is stopping");

    // 3. Sweep 2 (steady-state multi-cycle invariant): stays healthy with zero restarts.
    nowMs += 60_000;
    const sweep2 = await heartbeat.handle({ action: "run", mode: "maintain" });
    const heal2 = sweep2.lastCompletedRun?.actions.find((a) => a.actionId === "runtime-self-heal");
    expect(heal2?.status).toBe("passed");
    expect(heal2?.remediatedCount).toBe(0);
    expect(heal2?.findings).toEqual([]);
    expect(children).toHaveLength(2);

    // 4. Operational warning on a responsive sidecar: Heartbeat surfaces warning without killing sidecar.
    controller.memory.report(
      "Learning is unavailable. Check the verified provider and available storage.",
    );
    nowMs += 60_000;
    const sweep3 = await heartbeat.handle({ action: "run", mode: "maintain" });
    const heal3 = sweep3.lastCompletedRun?.actions.find((a) => a.actionId === "runtime-self-heal");
    expect(heal3?.status).toBe("warning");
    expect(heal3?.remediatedCount).toBe(0);
    expect(children).toHaveLength(2);

    const warnHealth = await healthCheck.handle({
      action: "run",
      scope: { kind: "check", checkId: "memory-health" },
    });
    const warnCheck = warnHealth.checks.find((c) => c.id === "memory-health");
    expect(warnCheck?.status).toBe("warning");
    expect(warnCheck?.detail).toContain("Learning is unavailable");
    expect(warnCheck?.detail).not.toContain("Memory service is stopping");
  });

  it("enforces the restart cap under persistent sidecar failures without permanently closing MemoryService", async () => {
    if (!controller || !healthCheck || !heartbeat) throw new Error("Missing seam fixture");
    // Seed initial healthy worker, then simulate persistent failure on all workers.
    await controller.memory.snapshot();
    failNewWorkers = true;
    for (const child of children) child.failSnapshots = true;

    // 3 sweeps exhaust SIDECAR_MAX_RESTARTS_PER_WINDOW (3 within 15 minutes).
    for (let i = 0; i < 3; i++) {
      nowMs += 10_000;
      const run = await heartbeat.handle({ action: "run", mode: "maintain" });
      const heal = run.lastCompletedRun?.actions.find((a) => a.actionId === "runtime-self-heal");
      expect(heal?.remediatedCount).toBe(1);
      expect(heal?.findings.some((f) => f.summary.includes("did not respond after restart"))).toBe(
        true,
      );
    }

    // 4th sweep within the window escalates with sidecar_restart_capped and does NOT restart.
    const workersBeforeCap = children.length;
    nowMs += 10_000;
    const capped = await heartbeat.handle({ action: "run", mode: "maintain" });
    const healCapped = capped.lastCompletedRun?.actions.find(
      (a) => a.actionId === "runtime-self-heal",
    );
    expect(healCapped?.status).toBe("escalated");
    expect(healCapped?.remediatedCount).toBe(0);
    expect(healCapped?.findings.some((f) => f.code === "sidecar_restart_capped")).toBe(true);
    expect(children).toHaveLength(workersBeforeCap);

    // Once the underlying sidecar fault clears, Health Check succeeds (service was never closed).
    failNewWorkers = false;
    for (const child of children) child.failSnapshots = false;
    const recovered = await healthCheck.handle({
      action: "run",
      scope: { kind: "check", checkId: "memory-health" },
    });
    const memCheck = recovered.checks.find((c) => c.id === "memory-health");
    expect(memCheck?.status).toBe("healthy");
    expect(memCheck?.detail ?? "").not.toContain("Memory service is stopping");
  });
});
