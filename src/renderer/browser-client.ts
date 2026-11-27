import {
  type ApplicationClient,
  type BrowserSession,
  GATEWAY_LIMITS,
  GATEWAY_VERSION,
  type GatewayFrame,
  parseWebLink,
} from "../bridge/index.js";
import { randomId } from "./browser-platform.js";

declare global {
  interface Window {
    code60: ApplicationClient;
  }
}

const sessionKey = "code60.browserSession.v1";
export function savedBrowserSession(): BrowserSession | null {
  try {
    return JSON.parse(sessionStorage.getItem(sessionKey) ?? "null") as BrowserSession | null;
  } catch {
    return null;
  }
}
export function saveBrowserSession(session: BrowserSession | null) {
  if (session) sessionStorage.setItem(sessionKey, JSON.stringify(session));
  else sessionStorage.removeItem(sessionKey);
}
export async function browserRequest<T>(
  path: string,
  session: BrowserSession | null,
  value?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method: value === undefined ? "GET" : "POST",
    mode: "same-origin",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    headers: {
      ...(value === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session
        ? {
            "X-Code60-Session": session.token,
            "X-Code60-Generation": String(session.generation),
            ...(session.clientId ? { "X-Code60-Client": session.clientId } : {}),
          }
        : {}),
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(typeof result?.error === "string" ? result.error : "Code60 request failed.");
  return result as T;
}
export const pairBrowser = (code: string) =>
  browserRequest<BrowserSession>("/api/pair", null, {
    code: code.trim().replaceAll(" ", ""),
    version: GATEWAY_VERSION,
  });
export const connectBrowser = () =>
  browserRequest<BrowserSession>("/api/connect", null, { version: GATEWAY_VERSION });

class BrowserEvents {
  private readonly listeners = new Map<string, Set<(value: unknown) => void>>();
  on<T>(event: string, listener: (value: T) => void) {
    const entry = (value: unknown) => listener(value as T);
    const listeners = this.listeners.get(event) ?? new Set();
    this.listeners.set(event, listeners);
    listeners.add(entry);
    return () => {
      listeners.delete(entry);
    };
  }
  emit(event: string, value?: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }
}

export function createBrowserClient(
  session: BrowserSession,
  onFrame: (frame: GatewayFrame) => void,
  requestWebLink: (url: string) => Promise<boolean>,
) {
  session.clientId = randomId();
  let ready!: () => void;
  const connected = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const events = new BrowserEvents();
  const abort = new AbortController();
  const rpc = <T>(operation: string, value?: unknown): Promise<T> =>
    browserRequest<T>("/api/operation", session, { id: randomId(), operation, value });
  const api: ApplicationClient = {
    mcpRecovery: (request) => rpc("mcp-recovery", request),
    mcpRuntime: (request) => rpc("mcp-runtime", request),
    mcpAuthentication: (request) => rpc("mcp-authentication", request),
    mcpReadText: (request) => rpc("mcp-read-text", request),
    mcpSaveText: (request) => rpc("mcp-save-text", request),
    mcpBackups: (request) => rpc("mcp-backups", request),
    mcpPreviewBackup: (request) => rpc("mcp-preview-backup", request),
    mcpRestore: (request) => rpc("mcp-restore", request),
    mcpPreviewReset: (request) => rpc("mcp-preview-reset", request),
    mcpReset: (request) => rpc("mcp-reset", request),
    mcpTargets: () => rpc("mcp-targets"),
    mcpRead: (target) => rpc("mcp-read", target),
    mcpSave: (request) => rpc("mcp-save", request),
    mcpPreviewMove: (request) => rpc("mcp-preview-move", request),
    mcpMove: (request) => rpc("mcp-move", request),
    onMcpChanged: (listener) => events.on("mcp-changed", listener),

    webServerStatus: () => rpc("web-server-status"),
    setWebServerEnabled: (request) => rpc("web-server-enabled", request),
    createWebServerCode: () => rpc("web-server-code"),
    modelDefault: (request: unknown) => rpc("model-default", request),
    customAgent: (request: unknown) => rpc("custom-agent", request),
    workflow: (request) => rpc("workflow", request),
    automation: (request: unknown) => rpc("automation", request),
    onAutomationChanged: (listener: () => void) => {
      return events.on("automation-changed", listener);
    },
    openTerminal: (request) => rpc("terminal-open", request),
    writeTerminal: (request) => rpc("terminal-write", request),
    resizeTerminal: (request) => rpc("terminal-resize", request),
    closeTerminal: (request) => rpc("terminal-close", request),
    listTerminals: () => rpc("terminal-list"),
    onTerminalEvent: (listener) => events.on("terminal-event", listener),
    onTerminalsChanged: (listener) => events.on("terminals-changed", listener),
    healthCheck: (request) => rpc("health-check", request),
    onHealthChanged: (listener) => events.on("health-changed", listener),
    alerts: (request) => rpc("alerts", request),
    onAlertsChanged: (listener) => events.on("alerts-changed", listener),
    heartbeat: (request) => rpc("heartbeat", request),
    onHeartbeatChanged: (listener) => events.on("heartbeat-changed", listener),
    usageReport: (query) => rpc("usage-report", query ?? {}),
    usageTurns: (query) => rpc("usage-turns", query ?? {}),
    usageExport: (request) => rpc("usage-export", request),
    usageClear: () => rpc("usage-clear", { confirm: true }),
    onUsageChanged: (listener) => events.on("usage-changed", listener),
    memorySnapshot: () => rpc("memory-snapshot"),
    browseMemories: (request: unknown) => rpc("memory-browse", request),
    memoryDetail: (request: unknown) => rpc("memory-detail", request),
    memoryAction: (request: unknown) => rpc("memory-action", request),
    onMemoryChanged: (listener: () => void) => {
      return events.on("memory-changed", listener);
    },
    ragStatus: () => rpc("rag-status"),
    rebuildRag: (request: unknown) => rpc("rag-rebuild", request),
    retrieveRag: (request: unknown) => rpc("rag-retrieve", request),
    cancelRag: (requestId: unknown) => rpc("rag-cancel", requestId),
    clearRag: (request: unknown) => rpc("rag-clear", request),
    onRagStatus: (listener) => {
      return events.on("rag-status", listener);
    },
    openWebLink: async (request) => requestWebLink(parseWebLink(request).url),
    queryLogs: (request: unknown) => rpc("logs-query", request),
    logDetail: (request: unknown) => rpc("logs-detail", request),
    clearLogs: (request: unknown) => rpc("logs-clear", request),
    onLogsChanged: (listener: () => void) => {
      return events.on("logs-changed", listener);
    },
    checkGit: (request: unknown) => rpc("git-check", request),
    beginGitSetup: (request: unknown) => rpc("git-begin", request),
    previewGitSetupFile: (request: unknown) => rpc("git-file", request),
    initializeGit: (request: unknown) => rpc("git-initialize", request),
    commitGitSetup: (request: unknown) => rpc("git-commit", request),
    cancelGitSetup: (request: unknown) => rpc("git-cancel", request),
    readPlan: (request: unknown) => rpc("plan-read", request),
    readRelayMessage: (request: unknown) => rpc("relay-message", request),
    relayReview: (request: unknown) => rpc("relay-review", request),
    planAction: (request: unknown) => rpc("plan-action", request),
    readReview: (request: unknown) => rpc("review-read", request),
    taskAction: (request: unknown) => rpc("task-action", request),
    reviewAction: (request: unknown) => rpc("review-action", request),
    captureReview: (request: unknown) => rpc("review-capture", request),
    readReviewFile: (request: unknown) => rpc("review-file", request),
    readDiff: (request: unknown) => rpc("diff-read", request),
    cancelDiff: (request: unknown) => rpc("diff-cancel", request),
    providerAction: (request: unknown) => rpc("provider-action", request),
    beginAgentSetup: (request: unknown) => rpc("setup-begin", request),
    attemptAgentSetup: (request: unknown) => rpc("setup-attempt", request),
    installProviderForSetup: (request) => rpc("setup-provider-install", request),
    loginProviderForSetup: (request) => rpc("setup-provider-login", request),
    readProviderSetup: (request) => rpc("setup-provider-read", request),
    submitProviderSetup: (request) => rpc("setup-provider-submit", request),
    cancelProviderSetup: (request) => rpc("setup-provider-cancel", request),
    installCodexForSetup: (request) => rpc("setup-codex-install", request),
    loginCodexForSetup: (request) => rpc("setup-codex-login", request),
    readCodexSetup: (request) => rpc("setup-codex-read", request),
    cancelCodexSetup: (request) => rpc("setup-codex-cancel", request),
    cancelAgentSetup: (request: unknown) => rpc("setup-cancel", request),
    finishAgentSetup: (request: unknown) => rpc("setup-finish", request),
    abandonAgentSetup: (request: unknown) => rpc("setup-abandon", request),
    searchProjects: (request: unknown) => rpc("project-search", request),
    searchProjectsPage: (request: unknown) => rpc("project-search-page", request),
    cancelProjectSearch: (request: unknown) => rpc("project-search-cancel", request),
    openSearchSource: (request: unknown) => rpc("project-search-open", request),
    summarizeSearch: (request: unknown) => rpc("search-summary", request),
    cancelSearchSummary: (requestId: unknown) => rpc("search-summary-cancel", requestId),
    extractMemory: (request: unknown) => rpc("memory-extract", request),
    cancelMemoryExtraction: (requestId: unknown) => rpc("memory-cancel", requestId),
    orchestrationChatAction: (request: unknown) => rpc("orchestration-chat", request),
    snapshot: () => rpc("snapshot"),
    appSummary: () => rpc("snapshot-summary"),
    subscribeDetails: (request: unknown) => rpc("detail-subscribe", request),
    readDetails: (request: unknown) => rpc("detail-read", request),
    setRelayFileContext: (request: unknown) => rpc("relay-files", request),
    knowledgeRenderer: () => rpc("knowledge-renderer"),
    reportKnowledge: (request: unknown) => rpc("knowledge-report", request),
    unsubscribeDetails: (request: unknown) => rpc("detail-unsubscribe", request),
    onDetails: (listener) => {
      return events.on("detail", listener);
    },
    connectDatabase: (request: unknown, databaseEpoch?: number) =>
      rpc("database", { request, databaseEpoch }),
    chooseFolder: (databaseEpoch?: number) => rpc("folder", { request: undefined, databaseEpoch }),
    openProject: (request: unknown, databaseEpoch?: number) =>
      rpc("project", { request, databaseEpoch }),
    projectAction: (request: unknown) => rpc("project-action", request),
    removeProject: (request: unknown, databaseEpoch?: number) =>
      rpc("project-remove", { request, databaseEpoch }),
    clearProjects: (databaseEpoch?: number) =>
      rpc("project-clear", { request: undefined, databaseEpoch }),
    setFileContext: (context: unknown) => rpc("files", context),
    poll: (keys: unknown, identity?: { projectId?: string; databaseEpoch?: number }) =>
      rpc("poll", {
        keys,
        projectId: identity?.projectId,
        databaseEpoch: identity?.databaseEpoch,
      }),
    setPollSettings: (settings: unknown) => rpc("poll-settings", settings),
    setPollingPaused: (paused: unknown) => rpc("poll-paused", paused),
    setVisibility: (visibility: unknown) => rpc("visibility", visibility),
    setOrchestrationAutoApproval: (enabled: unknown) => rpc("orchestration-auto-approval", enabled),
    setOrchestrationProvider: (provider: unknown) => rpc("orchestration-provider", provider),
    testOrchestrationProvider: () => rpc("orchestration-test"),
    cancelOrchestrationTest: () => rpc("orchestration-test-cancel"),
    start: (request: unknown) => rpc("start", request),
    saveConfiguration: (request: unknown, databaseEpoch?: number) =>
      rpc("configuration-save", { request, databaseEpoch }),
    deleteConfiguration: (request: unknown, databaseEpoch?: number) =>
      rpc("configuration-delete", { request, databaseEpoch }),
    savePromptTemplate: (request: unknown, databaseEpoch?: number) =>
      rpc("prompt-save", { request, databaseEpoch }),
    saveCommand: (request: unknown, databaseEpoch?: number) =>
      rpc("command-save", { request, databaseEpoch }),
    deleteCommand: (request: unknown, databaseEpoch?: number) =>
      rpc("command-delete", { request, databaseEpoch }),
    resetPromptTemplate: (request: unknown, databaseEpoch?: number) =>
      rpc("prompt-reset", { request, databaseEpoch }),
    action: (action: unknown) => rpc("action", action),
    stopAll: () => rpc("stop-all"),
    subscribe: (listener) => {
      return events.on("update", listener);
    },
  };
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retry = 250;
  let sequence = 0;
  const stream = async () => {
    try {
      const response = await fetch("/api/events", {
        mode: "same-origin",
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        headers: {
          "X-Code60-Session": session.token,
          "X-Code60-Generation": String(session.generation),
          ...(session.clientId ? { "X-Code60-Client": session.clientId } : {}),
        },
        signal: abort.signal,
      });
      if (!response.ok || !response.body)
        throw new Error("Connection lost. Pair again if the backend restarted.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      retry = 250;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        if (buffer.length > GATEWAY_LIMITS.streamBytes)
          throw new Error("Event stream exceeded its limit.");
        for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (!line.startsWith("data: ")) continue;
          const frame = JSON.parse(line.slice(6)) as GatewayFrame;
          if (frame.event === "resync" || (sequence && frame.sequence !== sequence + 1)) {
            void api
              .appSummary?.()
              .then((snapshot) => events.emit("update", snapshot))
              .catch(() => {});
            void api
              .alerts?.({ action: "list" })
              .then((snapshot) => events.emit("alerts-changed", snapshot))
              .catch(() => {});
          }
          if (frame.event === "resync") ready();
          sequence = frame.sequence;
          events.emit(frame.event, frame.value);
          onFrame(frame);
        }
      }
    } catch {
      if (!abort.signal.aborted) onFrame({ sequence, event: "disconnected" });
    }
    if (!abort.signal.aborted) {
      retryTimer = setTimeout(() => void stream(), retry);
      retry = Math.min(5000, retry * 2);
    }
  };
  window.code60 = api;
  void stream();
  return {
    api,
    ready: connected,
    stop() {
      abort.abort();
      clearTimeout(retryTimer);
    },
  };
}
