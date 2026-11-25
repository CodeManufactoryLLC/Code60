import { describe, expect, it } from "vitest";
import {
  formatHealthBytes,
  formatHealthDuration,
  formatHealthReport,
  type HealthSnapshot,
  parseHealthCheckRequest,
  rollupHealthStatus,
} from "./index.js";

const sampleSnapshot: HealthSnapshot = {
  revision: 3,
  generatedAt: "2026-11-25T14:00:00.000Z",
  runningCount: 0,
  environment: {
    collectedAt: "2026-11-25T14:00:00.000Z",
    platform: "darwin",
    osName: "macOS (Darwin 24.1.0)",
    osRelease: "24.1.0",
    arch: "arm64",
    cpuModel: "Apple M3",
    cpuCores: 8,
    totalMemoryBytes: 16 * 1024 ** 3,
    freeMemoryBytes: 6 * 1024 ** 3,
    uptimeSeconds: 90_000,
    timeZone: "America/Denver",
    localTimeIso: "2026-11-25T14:00:00.000Z",
    code60Version: "0.4.1",
    gatewayVersion: 1,
    nodeVersion: "24.22.0",
    installMode: "managed",
    acpProtocol: "1",
    mcpProtocol: "2025-03-26",
    databaseSchema: "5",
    runRecordFormat: "1",
    embeddingModelId: "jinaai/jina-embeddings-v2-base-code",
    onnxRuntime: "onnxruntime-node 1.30.0 (cpu)",
    shell: "/bin/zsh",
    pathRecovered: true,
    databaseConnected: true,
    openProjectCount: 2,
    activeWorkerCount: 1,
    webServerEnabled: false,
    requirePairing: false,
    host: {
      hostname: "secret-workstation.local",
      localAddresses: [
        { interfaceName: "en0", family: "IPv4", address: "192.168.1.42", primary: true },
      ],
      primaryPrivateIPv4: "192.168.1.42",
      proxyConfigured: true,
      proxySummary: "proxy.internal:8080",
      backendOrigin: "http://127.0.0.1:41234",
      stateRoot: "/Users/alice/.local/state/code60",
      databaseLabel: "default.sqlite",
    },
  },
  checks: [
    {
      id: "backend-connection",
      group: "services",
      title: "Backend server connection",
      question: "Is Code60 connected to the backend server?",
      mode: "passive",
      status: "healthy",
      summary: "Connected to Code60 backend (PID 1234).",
      hostDetail: "Origin http://127.0.0.1:41234",
      checkedAt: "2026-11-25T14:00:00.000Z",
      running: false,
    },
    {
      id: "providers-installed",
      group: "providers",
      title: "Installed providers",
      question: "Which providers are installed?",
      mode: "passive",
      status: "healthy",
      summary: "1 of 7 installed: Claude (Primary).",
      checkedAt: "2026-11-25T14:00:00.000Z",
      running: false,
      targets: [
        {
          id: "claude",
          label: "Claude (Primary)",
          status: "healthy",
          summary: "Installed and enabled (npx).",
          checkedAt: "2026-11-25T14:00:00.000Z",
          running: false,
          canRun: true,
        },
      ],
    },
  ],
};

describe("health check bridge contracts", () => {
  it("parses valid snapshot, granular run and cancel requests", () => {
    expect(parseHealthCheckRequest({ action: "snapshot" })).toEqual({ action: "snapshot" });
    expect(
      parseHealthCheckRequest({ action: "run", scope: { kind: "all", includeActive: true } }),
    ).toEqual({ action: "run", scope: { kind: "all", includeActive: true } });
    expect(
      parseHealthCheckRequest({ action: "run", scope: { kind: "group", groupId: "providers" } }),
    ).toEqual({ action: "run", scope: { kind: "group", groupId: "providers" } });
    expect(
      parseHealthCheckRequest({
        action: "run",
        scope: { kind: "check", checkId: "providers-authenticated", targetId: "claude" },
      }),
    ).toEqual({
      action: "run",
      scope: { kind: "check", checkId: "providers-authenticated", targetId: "claude" },
    });
    expect(parseHealthCheckRequest({ action: "cancel" })).toEqual({ action: "cancel" });
    expect(
      parseHealthCheckRequest({
        action: "cancel",
        checkId: "providers-authenticated",
        targetId: "claude",
      }),
    ).toEqual({
      action: "cancel",
      checkId: "providers-authenticated",
      targetId: "claude",
    });
  });

  it("rejects unknown fields, invalid check IDs and unsafe target IDs", () => {
    expect(() => parseHealthCheckRequest({ action: "snapshot", extra: true })).toThrow();
    expect(() =>
      parseHealthCheckRequest({
        action: "run",
        scope: { kind: "check", checkId: "unknown-check" },
      }),
    ).toThrow();
    expect(() =>
      parseHealthCheckRequest({
        action: "run",
        scope: { kind: "check", checkId: "disk-space", targetId: "../../etc/passwd" },
      }),
    ).toThrow();
    expect(() =>
      parseHealthCheckRequest({
        action: "run",
        scope: { kind: "group", groupId: "invalid-group" },
      }),
    ).toThrow();
  });

  it("formats bytes, durations and rolls up health statuses predictably", () => {
    expect(formatHealthBytes(512)).toBe("512 B");
    expect(formatHealthBytes(2048)).toBe("2.00 KiB");
    expect(formatHealthBytes(15 * 1024 ** 2)).toBe("15.0 MiB");
    expect(formatHealthBytes(150 * 1024 ** 3)).toBe("150 GiB");
    expect(formatHealthBytes(-1)).toBe("Unavailable");

    expect(formatHealthDuration(300)).toBe("5m");
    expect(formatHealthDuration(7_500)).toBe("2h 5m");
    expect(formatHealthDuration(90_000)).toBe("1d 1h");
    expect(formatHealthDuration(-5)).toBe("Unavailable");

    expect(rollupHealthStatus(["healthy", "running"])).toBe("running");
    expect(rollupHealthStatus(["healthy", "warning", "error"])).toBe("error");
    expect(rollupHealthStatus(["healthy", "unavailable"])).toBe("error");
    expect(rollupHealthStatus(["healthy", "warning"])).toBe("warning");
    expect(rollupHealthStatus(["healthy", "not_configured"])).toBe("healthy");
    expect(rollupHealthStatus(["not_configured", "not_checked"])).toBe("not_configured");
    expect(rollupHealthStatus(["not_checked"])).toBe("not_checked");
  });

  it("redacts host & network identifiers by default and includes them only when opted in", () => {
    const redacted = formatHealthReport(sampleSnapshot, {
      clientVersion: "0.4.1",
      clientGatewayVersion: 1,
      clientOnline: true,
    });
    expect(redacted).toContain("Redacted (host & network identifiers omitted)");
    expect(redacted).toContain("Code60 Backend: 0.4.1");
    expect(redacted).toContain("[Healthy] Backend server connection");
    expect(redacted).toContain("Claude (Primary): [Healthy]");
    expect(redacted).not.toContain("secret-workstation.local");
    expect(redacted).not.toContain("192.168.1.42");
    expect(redacted).not.toContain("proxy.internal:8080");
    expect(redacted).not.toContain("/Users/alice/.local/state/code60");
    expect(redacted).not.toContain("http://127.0.0.1:41234");

    const full = formatHealthReport(sampleSnapshot, {
      includeHostContext: true,
      clientVersion: "0.4.1",
      clientGatewayVersion: 1,
      clientOnline: false,
    });
    expect(full).toContain("Full (includes host & network context)");
    expect(full).toContain("secret-workstation.local");
    expect(full).toContain("192.168.1.42");
    expect(full).toContain("proxy.internal:8080");
    expect(full).toContain("/Users/alice/.local/state/code60");
    expect(full).toContain("http://127.0.0.1:41234");
    expect(full).toContain("Browser network: Offline");
  });
});
