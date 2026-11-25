import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopRun, Snapshot } from "../bridge/index.js";
import { historyNavigation } from "./history-navigation.js";
import type { NavigationIntent } from "./navigation-actions.js";
import { type Destination, NavigationRecorder } from "./navigation-history.js";
import { initialTabs } from "./tabs.js";

afterEach(() => vi.useRealTimers());
function setup(start: Destination, database: string | null = "/db") {
  vi.useFakeTimers();
  const recorder = new NavigationRecorder(start);
  const snapshot = {
    database,
    chat: { conversationId: "relay", kind: "relay" },
    chats: [
      { conversationId: "relay", kind: "relay" },
      { run: { id: "chat-a" }, kind: "project", projectId: "a" },
      { run: { id: "archived" }, archived: true, kind: "project", projectId: "a" },
      { conversationId: "custom", kind: "relay", customAgentId: "assistant" },
    ],
    openProjects: [
      { id: "a", workerIds: ["worker"] },
      { id: "b", workerIds: [] },
    ],
    agentSetup: { enabled: ["codex", "claude"] },
  } as unknown as Snapshot;
  const dependencies = {
    snapshot,
    tabs: { ...initialTabs, active: "home" as const },
    settingsSection: null,
    workerId: undefined,
    runs: [
      { record: { id: "worker" } },
      { record: { id: "relay-worker" }, relay: true },
    ] as unknown as DesktopRun[],
    navigation: { open: vi.fn(async () => true), busy: false },
    setError: vi.fn(),
  };
  const history = () => historyNavigation(recorder, dependencies);
  return { recorder, dependencies, history };
}

describe("history restoration through shared navigation", () => {
  it.each([
    [
      { page: "settings", section: "text" },
      { kind: "settings", id: "text" },
    ],
    [{ page: "settings" }, { kind: "page", id: "settings" }],
    [
      { page: "project", project: "b" },
      { kind: "project", id: "b" },
    ],
    [{ page: "providers" }, { kind: "page", id: "providers" }],
    [
      { page: "chat", chat: "worker" },
      { kind: "conversation", id: "worker" },
    ],
    [
      { page: "chat", chat: "relay" },
      { kind: "conversation", id: "relay" },
    ],
    [
      { page: "chat", chat: "chat-a" },
      { kind: "conversation", id: "chat-a" },
    ],
  ] as const)("restores %j with its captured identity", async (entry, target) => {
    const { recorder, dependencies, history } = setup(entry);
    recorder.observe({ page: "home" });
    history().back();
    await vi.runAllTimersAsync();
    expect(dependencies.navigation.open).toHaveBeenCalledExactlyOnceWith(target);
  });

  it.each([false, true])("reverts failed restores (throws=%s)", async (throws) => {
    const { recorder, dependencies, history } = setup({ page: "chat", chat: "chat-a" });
    recorder.observe({ page: "home" });
    if (throws) dependencies.navigation.open.mockRejectedValueOnce(new Error("Selection failed"));
    else dependencies.navigation.open.mockResolvedValueOnce(false);
    history().back();
    await vi.runAllTimersAsync();
    expect(dependencies.setError).toHaveBeenCalledWith(
      throws ? "Selection failed" : "Unable to restore navigation destination.",
    );
    expect(recorder.history.index).toBe(1);
  });

  it("blocks traversal while another owner-aware selection is pending", () => {
    const { recorder, dependencies, history } = setup({ page: "logs" });
    recorder.observe({ page: "home" });
    dependencies.navigation.busy = true;
    expect(history().canGoBack).toBe(false);
    history().back();
    expect(dependencies.navigation.open).not.toHaveBeenCalled();
  });

  it.each([
    { page: "project", project: "closed" },
    { page: "project" },
    { page: "chat", chat: "archived" },
    { page: "chat", chat: "gone" },
  ] satisfies Destination[])("skips unavailable %j", (entry) => {
    const { recorder, history } = setup(entry);
    recorder.observe({ page: "home" });
    expect(history().canGoBack).toBe(false);
  });

  it.each([
    ["search", undefined, false],
    ["logs", undefined, true],
    ["chat", "chat-a", false],
    ["chat", "worker", false],
    ["chat", "relay", true],
    ["chat", "relay-worker", true],
  ] as const)("checks disconnected %s %s availability", (page, chat, available) => {
    const { recorder, history } = setup(chat ? { page, chat } : { page }, null);
    recorder.observe({ page: "home" });
    expect(history().canGoBack).toBe(available);
  });
});

describe("asynchronous navigation observation", () => {
  it.each([
    [
      { kind: "conversation", id: "chat-a" },
      { page: "chat", chat: "chat-a" },
    ],
    [{ kind: "new-conversation" }, { page: "chat", chat: "new-chat" }],
    [
      { kind: "custom-agent", id: "assistant" },
      { page: "chat", chat: "custom" },
    ],
    [
      { kind: "project", id: "b" },
      { page: "project", project: "b" },
    ],
    [{ kind: "page", id: "providers" }, { page: "providers" }],
    [
      { kind: "settings", id: "text" },
      { page: "settings", section: "text" },
    ],
    [{ kind: "page", id: "apps" }, { page: "apps" }],
  ] satisfies [NavigationIntent, Destination][])(
    "records only the completed %j destination",
    (target, entry) => {
      const { recorder, history } = setup({ page: "home" });
      history().expectTarget(target);
      recorder.observe({ page: "chat", chat: "relay" });
      recorder.observe(entry);
      expect(recorder.history.entries).toEqual([{ page: "home" }, entry]);
    },
  );

  it("does not replace an ongoing traversal with a new visit expectation", () => {
    const { recorder, history } = setup({ page: "chat", chat: "chat-a" });
    recorder.observe({ page: "home" });
    history().back();
    expect(history().expectTarget({ kind: "conversation", id: "chat-a" })).toBeUndefined();
    recorder.observe({ page: "chat", chat: "chat-a" });
    expect(recorder.history.index).toBe(0);
    expect(history().canGoForward).toBe(true);
  });

  it("wraps review chat selection and new chats, ignoring non-navigation actions", () => {
    const { history } = setup({ page: "home" });
    expect(history().expectChat({ type: "select", id: "chat-a" })).toBeDefined();
    expect(history().expectChat({ type: "new" })).toBeDefined();
    expect(history().expectChat({ type: "archive", id: "chat-a" })).toBeUndefined();
  });
});
