const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

// Keep this sandboxed preload self-contained; do not expose ipcRenderer or raw channels.
contextBridge.exposeInMainWorld("desktop", {
  update: (action: unknown) => ipcRenderer.invoke("desktop:app-update", action),
  onUpdate: (listener: (value: unknown) => void) => {
    const handler = (_event: unknown, value: unknown) => listener(value);
    ipcRenderer.on("desktop:app-update-state", handler);
    return () => ipcRenderer.removeListener("desktop:app-update-state", handler);
  },
  extractMemory: (request: unknown) => ipcRenderer.invoke("desktop:memory-extract", request),
  cancelMemoryExtraction: (requestId: unknown) =>
    ipcRenderer.invoke("desktop:memory-cancel", requestId),
  orchestrationChatAction: (request: unknown) =>
    ipcRenderer.invoke("desktop:orchestration-chat", request),
  windowAppearance: () => ipcRenderer.invoke("desktop:window-appearance"),
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
