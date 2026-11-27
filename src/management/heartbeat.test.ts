import { describe, expect, it, vi } from "vitest";
import { DEFAULT_HEARTBEAT_POLICY, type HeartbeatSnapshot } from "../contracts/index.js";
import { formatHeartbeatCliSummary, parseHeartbeatCliArgs, runHeartbeatCli } from "./heartbeat.js";

describe("management heartbeat CLI", () => {
  it("parses status, run, --inspect, --json, and rejects invalid arguments", () => {
    expect(parseHeartbeatCliArgs([])).toEqual({
      help: false,
      subcommand: "status",
      inspect: false,
      json: false,
    });
    expect(parseHeartbeatCliArgs(["run", "--inspect", "--json"])).toEqual({
      help: false,
      subcommand: "run",
      inspect: true,
      json: true,
    });
    expect(parseHeartbeatCliArgs(["--help"]).help).toBe(true);
    expect(() => parseHeartbeatCliArgs(["status", "--inspect"])).toThrow();
    expect(() => parseHeartbeatCliArgs(["bogus"])).toThrow();
  });

  it("formats heartbeat timing, needs-attention fix steps, and per-action audit rows", () => {
    const snapshot: HeartbeatSnapshot = {
      revision: 1,
      policy: { ...DEFAULT_HEARTBEAT_POLICY },
      nextRunAt: "2026-11-27T12:15:00.000Z",
      running: false,
      lowDiskPausedByHeartbeat: false,
      currentRun: null,
      lastCompletedRun: {
        id: "00000000-0000-4000-8000-000000000001",
        sequence: 1,
        trigger: "manual",
        mode: "maintain",
        status: "warning",
        startedAt: "2026-11-27T12:00:00.000Z",
        endedAt: "2026-11-27T12:00:01.250Z",
        durationMs: 1250,
        actions: [
          {
            actionId: "passive-health-sweep",
            title: "Passive health sweep",
            area: "health",
            behavior: "check",
            status: "warning",
            startedAt: "2026-11-27T12:00:00.000Z",
            endedAt: "2026-11-27T12:00:00.400Z",
            durationMs: 400,
            summary: "1 passive health warning detected.",
            remediatedCount: 0,
            findings: [
              {
                code: "health_warning",
                audience: "user",
                severity: "warning",
                title: "Agent providers installed",
                summary: "No agent provider CLI found.",
                howToFix: "Install and verify at least one agent provider in Providers.",
                remediation: "user_action",
              },
            ],
          },
        ],
      },
      recentRuns: [],
      storageWarning: null,
    };

    const output = formatHeartbeatCliSummary(snapshot);
    expect(output).toContain("Source:     Human-Triggered");
    expect(output).toContain("Initiated:  2026-11-27T12:00:00.000Z");
    expect(output).toContain("Terminated: 2026-11-27T12:00:01.250Z");
    expect(output).toContain("Duration:   1.25 s");
    expect(output).toContain("Needs attention (1):");
    expect(output).toContain("Agent providers installed");
    expect(output).toContain("Fix: Install and verify at least one agent provider in Providers.");
    expect(output).toContain("Passive health sweep");
  });

  it("calls managementRequest with the expected action payload", async () => {
    const request = vi.fn(async () => ({
      revision: 1,
      policy: { ...DEFAULT_HEARTBEAT_POLICY },
      nextRunAt: null,
      running: false,
      lowDiskPausedByHeartbeat: false,
      currentRun: null,
      lastCompletedRun: null,
      recentRuns: [],
      storageWarning: null,
    }));
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runHeartbeatCli(["run", "--inspect", "--json"], {}, request as never);
      expect(request).toHaveBeenCalledWith({}, "heartbeat", { action: "run", mode: "inspect" });
    } finally {
      spy.mockRestore();
    }
  });
});
