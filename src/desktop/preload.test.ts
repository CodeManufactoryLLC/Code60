import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

describe("sandboxed diagnostic preload", () => {
  it("exposes only fixed log methods and cleans up its batched notice listener", async () => {
    const invoke = vi.fn(async () => "result");
    const on = vi.fn();
    const removeListener = vi.fn();
    let api: Record<string, (...args: unknown[]) => unknown> = {};
    const require = createRequire(import.meta.url);
    const electron = require.resolve("electron");
    const previous = require.cache[electron];
    require.cache[electron] = {
      exports: {
        contextBridge: {
          exposeInMainWorld: (key: string, value: typeof api) => {
            expect(key).toBe("desktop");
            api = value;
          },
        },
        ipcRenderer: { invoke, on, removeListener },
      },
    } as NodeModule;
    const preload = "./preload.cts";
    try {
      await import(preload);
    } finally {
      if (previous) require.cache[electron] = previous;
      else delete require.cache[electron];
    }
    for (const [method, channel, request] of [
      ["queryLogs", "desktop:logs-query", { limit: 10 }],
      ["logDetail", "desktop:logs-detail", { id: crypto.randomUUID() }],
      ["clearLogs", "desktop:logs-clear", { confirm: true }],
    ] as const) {
      expect(await api[method]?.(request)).toBe("result");
      expect(invoke).toHaveBeenLastCalledWith(channel, request);
    }
    const listener = vi.fn();
    const unsubscribe = api.onLogsChanged?.(listener) as () => void;
    const [channel, handler] = on.mock.calls[0] as [string, () => void];
    expect(channel).toBe("desktop:logs-changed");
    handler();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(channel, handler);
    expect(api).not.toHaveProperty("ipcRenderer");
    expect(api).not.toHaveProperty("readFile");
    // Verify the existing fixed forwarding surface, not just newly added methods.
    const requests = {
      checkGit: "git-check",
      beginGitSetup: "git-begin",
      previewGitSetupFile: "git-file",
      initializeGit: "git-initialize",
      commitGitSetup: "git-commit",
      cancelGitSetup: "git-cancel",
      readPlan: "plan-read",
      planAction: "plan-action",
      readReview: "review-read",
      reviewAction: "review-action",
      captureReview: "review-capture",
      readReviewFile: "review-file",
      readDiff: "diff-read",
      cancelDiff: "diff-cancel",
      beginAgentSetup: "setup-begin",
      attemptAgentSetup: "setup-attempt",
      cancelAgentSetup: "setup-cancel",
      finishAgentSetup: "setup-finish",
      abandonAgentSetup: "setup-abandon",
      update: "app-update",
      summarizeSearch: "search-summary",
      cancelSearchSummary: "search-summary-cancel",
      extractMemory: "memory-extract",
      cancelMemoryExtraction: "memory-cancel",
      orchestrationChatAction: "orchestration-chat",
      setWindowTheme: "window-theme",
      setTransparent: "transparent",
      setBackgroundHitTest: "background-hit-test",
      connectDatabase: "database",
      openProject: "project",
      removeProject: "project-remove",
      setFileContext: "files",
      poll: "poll",
      setPollSettings: "poll-settings",
      setPollingPaused: "poll-paused",
      setVisibility: "visibility",
      setOrchestrationProvider: "orchestration-provider",
      start: "start",
      saveConfiguration: "configuration-save",
      deleteConfiguration: "configuration-delete",
      savePromptTemplate: "prompt-save",
      resetPromptTemplate: "prompt-reset",
      action: "action",
    };
    const request = { opaque: "request" };
    for (const [method, channel] of Object.entries(requests)) {
      expect(await api[method]?.(request)).toBe("result");
      expect(invoke).toHaveBeenLastCalledWith(`desktop:${channel}`, request);
    }
    for (const [method, channel] of Object.entries({
      snapshot: "snapshot",
      windowAppearance: "window-appearance",
      chooseFolder: "folder",
      clearProjects: "project-clear",
      testOrchestrationProvider: "orchestration-test",
      cancelOrchestrationTest: "orchestration-test-cancel",
      stopAll: "stop-all",
    })) {
      await api[method]?.();
      expect(invoke).toHaveBeenLastCalledWith(`desktop:${channel}`);
    }
    for (const [method, channel] of [
      ["subscribe", "desktop:update"],
      ["onUpdate", "desktop:app-update-state"],
      ["onMenu", "desktop:menu"],
    ]) {
      const callback = vi.fn();
      const dispose = api[method as string]?.(callback) as () => void;
      const handler = on.mock.lastCall?.[1] as (event: unknown, value: unknown) => void;
      expect(on).toHaveBeenLastCalledWith(channel, handler);
      handler({}, "database");
      expect(callback).toHaveBeenLastCalledWith("database");
      handler({}, "open-project");
      handler({}, "untrusted-command");
      expect(callback).toHaveBeenCalledTimes(method === "onMenu" ? 2 : 3);
      dispose();
      expect(removeListener).toHaveBeenLastCalledWith(channel, handler);
    }
  });
});
