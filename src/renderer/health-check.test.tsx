import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { HealthSnapshot } from "../bridge/index.js";
import { HealthCheckPage } from "./health-check.js";

const emptySnapshot: HealthSnapshot = {
  revision: 0,
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
    uptimeSeconds: 7200,
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
    databaseConnected: false,
    openProjectCount: 0,
    activeWorkerCount: 0,
    webServerEnabled: false,
    requirePairing: false,
    host: {
      hostname: "dev-box.local",
      localAddresses: [],
      primaryPrivateIPv4: null,
      proxyConfigured: false,
      proxySummary: null,
      backendOrigin: "http://127.0.0.1:43210",
      stateRoot: "/Users/dev/.local/state/code60",
      databaseLabel: null,
    },
  },
  checks: [],
};

describe("HealthCheckPage", () => {
  it("renders title, controls and redacted export checkbox without requiring a database", () => {
    const html = renderToStaticMarkup(
      <HealthCheckPage
        api={{
          healthCheck: async () => emptySnapshot,
          onHealthChanged: () => () => {},
        }}
        active={false}
        clientVersion="0.4.1"
      />,
    );
    expect(html).toContain('<span class="page-title-text">Health Check</span>');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("0 of 20");
    expect(html).toContain("0%");
    expect(html).toContain("System health");
    expect(html).toContain("Last completed:");
    expect(html).toContain("Recheck passive");
    expect(html).toContain("Run all checks");
    expect(html).toContain("Copy health report");
    expect(html).toContain("Include host &amp; network details");
  });
});
