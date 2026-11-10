const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

// Keep this sandboxed preload self-contained; do not expose ipcRenderer or raw channels.
contextBridge.exposeInMainWorld("desktop", {
  openWebLink: (request: unknown) => ipcRenderer.invoke("desktop:web-link", request),
  queryLogs: (request: unknown) => ipcRenderer.invoke("desktop:logs-query", request),
  logDetail: (request: unknown) => ipcRenderer.invoke("desktop:logs-detail", request),
  clearLogs: (request: unknown) => ipcRenderer.invoke("desktop:logs-clear", request),
  onLogsChanged: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on("desktop:logs-changed", handler);
    return () => ipcRenderer.removeListener("desktop:logs-changed", handler);
  },
  checkGit: (request: unknown) => ipcRenderer.invoke("desktop:git-check", request),
  beginGitSetup: (request: unknown) => ipcRenderer.invoke("desktop:git-begin", request),
  previewGitSetupFile: (request: unknown) => ipcRenderer.invoke("desktop:git-file", request),
  initializeGit: (request: unknown) => ipcRenderer.invoke("desktop:git-initialize", request),
  commitGitSetup: (request: unknown) => ipcRenderer.invoke("desktop:git-commit", request),
  cancelGitSetup: (request: unknown) => ipcRenderer.invoke("desktop:git-cancel", request),
  readPlan: (request: unknown) => ipcRenderer.invoke("desktop:plan-read", request),
  planAction: (request: unknown) => ipcRenderer.invoke("desktop:plan-action", request),
  readReview: (request: unknown) => ipcRenderer.invoke("desktop:review-read", request),
  taskAction: (request: unknown) => ipcRenderer.invoke("desktop:task-action", request),
  reviewAction: (request: unknown) => ipcRenderer.invoke("desktop:review-action", request),
  captureReview: (request: unknown) => ipcRenderer.invoke("desktop:review-capture", request),
  readReviewFile: (request: unknown) => ipcRenderer.invoke("desktop:review-file", request),
  readDiff: (request: unknown) => ipcRenderer.invoke("desktop:diff-read", request),
  cancelDiff: (request: unknown) => ipcRenderer.invoke("desktop:diff-cancel", request),
  beginAgentSetup: (request: unknown) => ipcRenderer.invoke("desktop:setup-begin", request),
  attemptAgentSetup: (request: unknown) => ipcRenderer.invoke("desktop:setup-attempt", request),
  cancelAgentSetup: (request: unknown) => ipcRenderer.invoke("desktop:setup-cancel", request),
  finishAgentSetup: (request: unknown) => ipcRenderer.invoke("desktop:setup-finish", request),
  abandonAgentSetup: (request: unknown) => ipcRenderer.invoke("desktop:setup-abandon", request),
  update: (action: unknown) => ipcRenderer.invoke("desktop:app-update", action),
  onUpdate: (listener: (value: unknown) => void) => {
    const handler = (_event: unknown, value: unknown) => listener(value);
    ipcRenderer.on("desktop:app-update-state", handler);
    return () => ipcRenderer.removeListener("desktop:app-update-state", handler);
  },
  summarizeSearch: (request: unknown) => ipcRenderer.invoke("desktop:search-summary", request),
  cancelSearchSummary: (requestId: unknown) =>
    ipcRenderer.invoke("desktop:search-summary-cancel", requestId),
  extractMemory: (request: unknown) => ipcRenderer.invoke("desktop:memory-extract", request),
  cancelMemoryExtraction: (requestId: unknown) =>
    ipcRenderer.invoke("desktop:memory-cancel", requestId),
  orchestrationChatAction: (request: unknown) =>
    ipcRenderer.invoke("desktop:orchestration-chat", request),
  windowAppearance: () => ipcRenderer.invoke("desktop:window-appearance"),
  setWindowTheme: (dark: unknown) => ipcRenderer.invoke("desktop:window-theme", dark),
  setTransparent: (enabled: unknown) => ipcRenderer.invoke("desktop:transparent", enabled),
  setBackgroundHitTest: (ignore: unknown) =>
    ipcRenderer.invoke("desktop:background-hit-test", ignore),
  snapshot: () => ipcRenderer.invoke("desktop:snapshot"),
  connectDatabase: (mode: unknown) => ipcRenderer.invoke("desktop:database", mode),
  chooseFolder: () => ipcRenderer.invoke("desktop:folder"),
  openProject: (path: unknown) => ipcRenderer.invoke("desktop:project", path),
  removeProject: (path: unknown) => ipcRenderer.invoke("desktop:project-remove", path),
  clearProjects: () => ipcRenderer.invoke("desktop:project-clear"),
  setFileContext: (context: unknown) => ipcRenderer.invoke("desktop:files", context),
  poll: (keys: unknown) => ipcRenderer.invoke("desktop:poll", keys),
  setPollSettings: (settings: unknown) => ipcRenderer.invoke("desktop:poll-settings", settings),
  setPollingPaused: (paused: unknown) => ipcRenderer.invoke("desktop:poll-paused", paused),
  setVisibility: (visibility: unknown) => ipcRenderer.invoke("desktop:visibility", visibility),
  setOrchestrationProvider: (provider: unknown) =>
    ipcRenderer.invoke("desktop:orchestration-provider", provider),
  testOrchestrationProvider: () => ipcRenderer.invoke("desktop:orchestration-test"),
  cancelOrchestrationTest: () => ipcRenderer.invoke("desktop:orchestration-test-cancel"),
  start: (request: unknown) => ipcRenderer.invoke("desktop:start", request),
  saveConfiguration: (request: unknown) =>
    ipcRenderer.invoke("desktop:configuration-save", request),
  deleteConfiguration: (id: unknown) => ipcRenderer.invoke("desktop:configuration-delete", id),
  savePromptTemplate: (request: unknown) => ipcRenderer.invoke("desktop:prompt-save", request),
  saveCommand: (request: unknown) => ipcRenderer.invoke("desktop:command-save", request),
  deleteCommand: (request: unknown) => ipcRenderer.invoke("desktop:command-delete", request),
  resetPromptTemplate: (id: unknown) => ipcRenderer.invoke("desktop:prompt-reset", id),
  action: (action: unknown) => ipcRenderer.invoke("desktop:action", action),
  stopAll: () => ipcRenderer.invoke("desktop:stop-all"),
  subscribe: (listener: (value: unknown) => void) => {
    const handler = (_event: unknown, value: unknown) => listener(value);
    ipcRenderer.on("desktop:update", handler);
    return () => ipcRenderer.removeListener("desktop:update", handler);
  },
  onMenu: (listener: (command: "open-project" | "database") => void) => {
    const handler = (_event: unknown, value: unknown) => {
      if (value === "open-project" || value === "database") listener(value);
    };
    ipcRenderer.on("desktop:menu", handler);
    return () => ipcRenderer.removeListener("desktop:menu", handler);
  },
});
