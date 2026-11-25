import type { EffectCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthSnapshot } from "../bridge/index.js";
import { HealthCheckPage } from "./health-check.js";

const hooks = vi.hoisted(() => ({
  effects: [] as EffectCallback[],
  states: [] as unknown[],
  setters: [] as ReturnType<typeof vi.fn>[],
  index: 0,
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: EffectCallback) => {
    hooks.effects.push(effect);
  },
  useState: (initial: unknown) => {
    const slot = hooks.index++;
    const value =
      slot in hooks.states
        ? hooks.states[slot]
        : typeof initial === "function"
          ? (initial as () => unknown)()
          : initial;
    const setter = vi.fn((next: unknown) => {
      hooks.states[slot] =
        typeof next === "function"
          ? (next as (prev: unknown) => unknown)(hooks.states[slot])
          : next;
    });
    hooks.setters[slot] = setter;
    return [value, setter];
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  useMemo: <T,>(fn: () => T) => fn(),
  useId: () => "health-id",
}));

const sampleSnapshot: HealthSnapshot = {
  revision: 2,
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
    databaseConnected: true,
    openProjectCount: 1,
    activeWorkerCount: 0,
    webServerEnabled: false,
    requirePairing: false,
    host: {
      hostname: "dev-box.local",
      localAddresses: [
        { interfaceName: "en0", family: "IPv4", address: "192.168.1.55", primary: true },
      ],
      primaryPrivateIPv4: "192.168.1.55",
      proxyConfigured: true,
      proxySummary: "proxy.corp:8080",
      backendOrigin: "http://127.0.0.1:43210",
      stateRoot: "/Users/dev/.local/state/code60",
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
      summary: "Connected to Code60 backend (PID 100).",
      hostDetail: "Origin http://127.0.0.1:43210",
      checkedAt: "2026-11-25T14:00:00.000Z",
      durationMs: 4,
      running: false,
      deepLink: { kind: "page", id: "system-manager", label: "System Manager" },
    },
    {
      id: "backend-version",
      group: "services",
      title: "Backend version compatibility",
      question: "Does the backend service have a compatible version?",
      mode: "passive",
      status: "healthy",
      summary: "Backend 0.4.1 (Gateway protocol v1).",
      checkedAt: "2026-11-25T14:00:00.000Z",
      running: false,
    },
    {
      id: "providers-authenticated",
      group: "providers",
      title: "Authenticated providers",
      question: "Which providers are authenticated?",
      mode: "active",
      status: "not_checked",
      summary: "Run an active probe to test live authentication.",
      checkedAt: null,
      running: false,
      targets: [
        {
          id: "claude",
          label: "Claude (Primary)",
          status: "warning",
          summary: "Needs login.",
          detail: "Run claude login.",
          checkedAt: "2026-11-25T14:00:00.000Z",
          durationMs: 120,
          running: false,
          canRun: true,
          runLabel: "Test auth",
        },
        {
          id: "codex",
          label: "Codex",
          status: "running",
          summary: "Probing ACP…",
          checkedAt: null,
          running: true,
          canRun: true,
          runLabel: "Test auth",
        },
      ],
    },
    {
      id: "disk-space",
      group: "storage",
      title: "Machine disk space",
      question: "How much disk space does this machine have?",
      mode: "passive",
      status: "error",
      summary: "1.50 GiB free of 100 GiB (2%).",
      detail: "Below 2 GiB floor.",
      checkedAt: "2026-11-25T14:00:00.000Z",
      running: false,
      targets: [
        {
          id: "state",
          label: "Code60 state & home",
          status: "error",
          summary: "1.50 GiB free of 100 GiB (2%)",
          checkedAt: "2026-11-25T14:00:00.000Z",
          running: false,
          canRun: true,
          metrics: { freePercent: 2 },
        },
      ],
    },
  ],
};

beforeEach(() => {
  hooks.effects = [];
  hooks.states = [];
  hooks.setters = [];
  hooks.index = 0;
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {
    onLine: true,
    clipboard: { writeText: vi.fn(async () => {}) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HealthCheckPage lifecycle", () => {
  it("renders Carbon IconIndicator, expandable DataTable, progress bar, expanded targets, Environment StructuredList and deep links", () => {
    hooks.states = [
      sampleSnapshot,
      "",
      false,
      false,
      "",
      true,
      "2026-11-25T14:00:00.000Z",
      0,
      "",
      "all",
      "all",
      ["providers-authenticated", "disk-space"],
    ];
    const element = HealthCheckPage({
      api: {
        healthCheck: async () => sampleSnapshot,
        onHealthChanged: () => () => {},
      },
      active: true,
      clientVersion: "0.4.0",
      onNavigate: vi.fn(),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('data-segment="healthy"');
    expect(html).toContain('data-segment="warning"');
    expect(html).toContain('data-segment="error"');
    expect(html).toContain("3 of 4");
    expect(html).toContain("75%");
    expect(html).toContain("Last completed:");
    expect(html).toContain('aria-label="Health status breakdown"');
    expect(html).toContain('data-metric="healthy"');
    expect(html).toContain('data-metric="warning"');
    expect(html).toContain('data-metric="error"');
    expect(html).toContain('data-metric="not_checked"');
    expect(html).toContain("cds--icon-indicator");
    expect(html).toContain("cds--data-table");
    expect(html).toContain("cds--structured-list");
    expect(html).toContain("cds--tabs");
    expect(html).toContain("cds--progress-bar");
    expect(html).toContain("Backend 0.4.1 differs from loaded browser client 0.4.0.");
    expect(html).toContain("Claude (Primary)");
    expect(html).toContain("Test auth");
    expect(html).toContain("Code60 state &amp; home");
    expect(html).toContain("health-target-meter");
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toContain("available disk space");
    expect(html).toContain("System Manager");
    expect(html).toContain("macOS (Darwin 24.1.0)");
    expect(html).toContain("192.168.1.55");
    expect(html).toContain("en0");
    expect(html).toContain("dev-box.local");
  });

  it("triggers passive checks on activation, emits a completion toast, receives pushed updates, and cancels on cleanup", async () => {
    hooks.states = [undefined, "", false, false, "", true, null, 0, "", "all", "all", []];
    let pushed: ((snapshot: HealthSnapshot) => void) | undefined;
    const off = vi.fn();
    const healthCheck = vi.fn(async () => sampleSnapshot);
    const onNotify = vi.fn();
    HealthCheckPage({
      api: {
        healthCheck,
        onHealthChanged: (listener) => {
          pushed = listener;
          return off;
        },
      },
      active: true,
      clientVersion: "0.4.1",
      onNotify,
    });
    const cleanups = hooks.effects.map((effect) => effect());
    await vi.waitFor(() =>
      expect(healthCheck).toHaveBeenCalledWith({
        action: "run",
        scope: { kind: "all", includeActive: false },
      }),
    );
    expect(hooks.setters[0]).toHaveBeenCalledWith(sampleSnapshot);
    expect(onNotify).toHaveBeenCalledWith(
      expect.stringContaining("Health check complete:"),
      "error",
    );
    pushed?.({ ...sampleSnapshot, revision: 9 });
    expect(hooks.setters[0]).toHaveBeenCalledWith(expect.objectContaining({ revision: 9 }));

    for (const cleanup of cleanups.reverse()) if (typeof cleanup === "function") cleanup();
    expect(off).toHaveBeenCalled();
    expect(healthCheck).toHaveBeenCalledWith({ action: "cancel" });
  });

  it("renders disconnected fallback banner and retry control when backend is unreachable", () => {
    hooks.states = [
      sampleSnapshot,
      "Backend unreachable",
      true,
      false,
      "",
      true,
      null,
      0,
      "",
      "all",
      "all",
      [],
    ];
    const element = HealthCheckPage({
      api: {
        healthCheck: async () => {
          throw new Error("Connection refused");
        },
        onHealthChanged: () => () => {},
      },
      active: true,
      clientVersion: "0.4.1",
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Cannot reach Code60 backend server.");
    expect(html).toContain("Disconnected from the Code60 backend server.");
    expect(html).toContain("Retry connection");
  });
});
