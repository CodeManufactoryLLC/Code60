import { describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../bridge/index.js";
import { historyNavigation } from "./history-navigation.js";
import { type Destination, NavigationRecorder } from "./navigation-history.js";
import { initialTabs, type PageId, type PageTabs } from "./tabs.js";

const flush = () => new Promise((resolve) => setTimeout(resolve));

function snapshot({
  database = "/db.sqlite" as string | null,
  current = "orch-a",
  archived = [] as string[],
} = {}): Snapshot {
  return {
    database,
    chat: { run: { id: current } },
    chats: ["orch-a", "orch-b", "orch-old"].map((id) => ({
      run: { id },
      archived: archived.includes(id),
    })),
    runs: [{ record: { id: "worker-1" } }],
  } as unknown as Snapshot;
}

function setup(start: Destination, options: Parameters<typeof snapshot>[0] = {}) {
  let tabs: PageTabs = { ...initialTabs, active: start.page };
  const recorder = new NavigationRecorder(start);
  const api = { orchestrationChatAction: vi.fn(() => Promise.resolve()) };
  const calls = {
    setSettingsSection: vi.fn(),
    closeMenus: vi.fn(),
    selectWorker: vi.fn(),
    openChat: vi.fn(),
    setError: vi.fn(),
  };
  const navigation = (state = snapshot(options), workerId?: string) =>
    historyNavigation(recorder, {
      api,
      snapshot: state,
      tabs,
      settingsSection: "agents",
      workerId,
      setTabs: (update) => {
        tabs = update(tabs);
      },
      ...calls,
    });
  return { recorder, api, calls, navigation, page: () => tabs.active };
}

describe("history availability", () => {
  it("skips pages that need a database while disconnected", () => {
    const { recorder, navigation } = setup({ page: "logs" });
    recorder.observe({ page: "search" });
    recorder.observe({ page: "logs" });
    expect(navigation().canGoBack).toBe(true);
    expect(navigation(snapshot({ database: null })).canGoBack).toBe(false);
  });

  it("skips archived orchestrators and runs no longer in the snapshot", () => {
    const { recorder, navigation } = setup({ page: "chat", chat: "orch-old" });
    recorder.observe({ page: "chat", chat: "gone" });
    recorder.observe({ page: "sessions" });
    expect(navigation().canGoBack).toBe(true);
    const archived = navigation(snapshot({ archived: ["orch-old"] }));
    expect(archived.canGoBack).toBe(false);
    expect(archived.canGoForward).toBe(false);
  });
});

describe("history restoration", () => {
  it("restores pages and Settings pages through tab selection", () => {
    const { recorder, calls, navigation, page } = setup({ page: "settings", section: "text" });
    recorder.observe({ page: "sessions" });
    navigation().back();
    expect(calls.setSettingsSection).toHaveBeenCalledWith("text");
    expect(calls.closeMenus).toHaveBeenCalled();
    expect(page()).toBe("settings" satisfies PageId);
  });

  it("restores worker chats through the existing chat opener", () => {
    const { recorder, api, calls, navigation } = setup({ page: "chat", chat: "worker-1" });
    recorder.observe({ page: "sessions" });
    navigation().back();
    expect(calls.openChat).toHaveBeenCalledWith("worker-1");
    expect(api.orchestrationChatAction).not.toHaveBeenCalled();
  });

  it("selects another orchestrator in the main process before showing it", async () => {
    const { recorder, api, calls, navigation, page } = setup({ page: "chat", chat: "orch-b" });
    recorder.observe({ page: "sessions" });
    navigation().back();
    expect(api.orchestrationChatAction).toHaveBeenCalledWith({ type: "select", id: "orch-b" });
    expect(calls.selectWorker).not.toHaveBeenCalled();
    await flush();
    expect(calls.selectWorker).toHaveBeenCalledWith(undefined);
    expect(page()).toBe("chat");
  });

  it("shows the current orchestrator without another request", async () => {
    const { recorder, api, calls, navigation } = setup({ page: "chat", chat: "orch-a" });
    recorder.observe({ page: "chat", chat: "worker-1" });
    navigation(snapshot(), "worker-1").back();
    await flush();
    expect(api.orchestrationChatAction).not.toHaveBeenCalled();
    expect(calls.selectWorker).toHaveBeenCalledWith(undefined);
  });

  it("leaves a newer navigation alone when a slow restore finishes", async () => {
    const { recorder, api, calls, navigation, page } = setup({ page: "chat", chat: "orch-b" });
    recorder.observe({ page: "sessions" });
    let finish = () => {};
    api.orchestrationChatAction.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    navigation().back();
    recorder.observe({ page: "logs" });
    finish();
    await flush();
    expect(calls.selectWorker).not.toHaveBeenCalled();
    expect(page()).toBe("chat");
  });

  it("reports a failed selection and stays where it was", async () => {
    const { recorder, api, calls, navigation } = setup({ page: "chat", chat: "orch-b" });
    recorder.observe({ page: "sessions" });
    api.orchestrationChatAction.mockRejectedValueOnce(new Error("This chat is archived"));
    navigation().back();
    await flush();
    expect(calls.setError).toHaveBeenCalledWith("This chat is archived");
    expect(recorder.history.index).toBe(1);
  });
});

describe("Relay conversations", () => {
  it("returns to a Relay chat by its conversation ID", async () => {
    const state = {
      ...snapshot(),
      chats: [...snapshot().chats, { kind: "relay", conversationId: "relay-1" }],
    } as unknown as Snapshot;
    const { recorder, api, navigation } = setup({ page: "chat", chat: "relay-1" });
    recorder.observe({ page: "sessions" });
    const history = navigation(state);
    expect(history.canGoBack).toBe(true);
    history.back();
    await flush();
    expect(api.orchestrationChatAction).toHaveBeenCalledWith({ type: "select", id: "relay-1" });
  });
});

describe("orchestrator requests", () => {
  it("waits for a selected orchestrator, ignoring the chat it leaves", () => {
    const { recorder, navigation } = setup({ page: "sessions" });
    const request = navigation().expectChat({ type: "select", id: "orch-b" });
    expect(request).toBeDefined();
    recorder.observe({ page: "chat", chat: "orch-a" });
    recorder.observe({ page: "chat", chat: "orch-b" });
    expect(recorder.history.entries).toEqual([
      { page: "sessions" },
      { page: "chat", chat: "orch-b" },
    ]);
  });

  it("waits for a new chat whose ID is not known yet", () => {
    const { recorder, navigation } = setup({ page: "sessions" });
    // The selected worker stays visible until the request finishes.
    navigation(snapshot(), "worker-1").expectChat({ type: "new" });
    recorder.observe({ page: "chat", chat: "orch-a" });
    recorder.observe({ page: "chat", chat: "worker-1" });
    recorder.observe({ page: "chat", chat: "orch-new" });
    expect(recorder.history.entries).toEqual([
      { page: "sessions" },
      { page: "chat", chat: "orch-new" },
    ]);
  });

  it("ignores requests that do not navigate", () => {
    const { navigation } = setup({ page: "chat", chat: "orch-a" });
    expect(navigation().expectChat({ type: "archive", id: "orch-a" })).toBeUndefined();
  });
});
