import { describe, expect, it, vi } from "vitest";
import type { ApplicationClient, DesktopRun, OrchestrationChat } from "../bridge/index.js";
import { createNavigationActions } from "./navigation-actions.js";
import { initialTabs } from "./tabs.js";

function fixture() {
  const context: ReturnType<Parameters<typeof createNavigationActions>[0]> = {
    api: {
      projectAction: vi.fn(async () => {}),
      orchestrationChatAction: vi.fn(async () => {}),
    } as unknown as ApplicationClient,
    tabs: { ...initialTabs, active: "home" },
    database: "/db",
    databaseEpoch: 1,
    projects: [{ id: "a", path: "/a", active: true, chatIds: ["chat"], workerIds: ["worker"] }],
    chats: [
      { conversationId: "relay", kind: "relay", workers: [] },
      { run: { id: "chat" }, kind: "project", projectId: "a", workers: ["worker"] },
    ] as unknown as OrchestrationChat[],
    runs: [{ record: { id: "worker" } }] as DesktopRun[],
    selectedId: "chat",
    onPage: vi.fn(),
    onSection: vi.fn(),
    selectWorker: vi.fn(),
    onArchived: vi.fn(),
  };
  const status = vi.fn();
  const reveal = vi.fn();
  return {
    context,
    status,
    reveal,
    actions: createNavigationActions(() => context, status, reveal),
  };
}
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("shared navigation actions", () => {
  it.each([true, false])(
    "settles history observation after chat selection (success=%s)",
    async (success) => {
      const { actions, context } = fixture();
      const settle = vi.fn();
      context.onNavigate = vi.fn((): [typeof settle, () => boolean] => [settle, () => true]);
      if (!success)
        vi.mocked(context.api.orchestrationChatAction).mockRejectedValueOnce(
          new Error("Selection failed"),
        );
      expect(await actions.open({ kind: "conversation", id: "chat" })).toBe(success);
      expect(context.onNavigate).toHaveBeenCalledExactlyOnceWith({
        kind: "conversation",
        id: "chat",
      });
      expect(settle).toHaveBeenCalledExactlyOnceWith(success);
    },
  );

  it("opens Custom Assistants management without a database or conversation action", async () => {
    const { actions, context } = fixture();
    context.database = null;
    expect(await actions.open({ kind: "page", id: "custom-agents" })).toBe(true);
    expect(context.onPage).toHaveBeenCalledExactlyOnceWith("custom-agents");
    expect(context.api.orchestrationChatAction).not.toHaveBeenCalled();
    expect(context.api.projectAction).not.toHaveBeenCalled();
    expect(context.selectWorker).not.toHaveBeenCalled();
  });

  it("reports failures, releases in-flight guards, and resets Settings to its home", async () => {
    const { actions, context, status } = fixture();
    vi.mocked(context.api.projectAction).mockRejectedValueOnce(new Error("Stop failed"));
    expect(await actions.projectAction({ type: "stop-folder", projectId: "a" })).toBe(false);
    expect(status).toHaveBeenCalledWith(true, "Stop failed", false, true);
    expect(await actions.projectAction({ type: "stop-folder", projectId: "a" })).toBe(true);
    await actions.open({ kind: "page", id: "settings" });
    expect(context.onSection).toHaveBeenLastCalledWith(null);
    await actions.open({ kind: "settings", id: "updates" });
    expect(context.onSection).toHaveBeenLastCalledWith("updates");
    expect(context.onPage).toHaveBeenLastCalledWith("settings");
    expect(context.api.projectAction).toHaveBeenCalledTimes(2);
  });

  it("shares conversation selection and permits only Relay without a database", async () => {
    const { actions, context } = fixture();
    expect(await actions.open({ kind: "conversation", id: "chat" })).toBe(true);
    expect(context.selectWorker).toHaveBeenLastCalledWith(undefined, "a");
    expect(context.onPage).toHaveBeenLastCalledWith("chat");
    context.database = null;
    expect(await actions.open({ kind: "conversation", id: "chat" })).toBe(false);
    expect(await actions.open({ kind: "conversation", id: "worker" })).toBe(false);
    expect(await actions.open({ kind: "conversation", id: "relay" })).toBe(true);
    expect(context.selectWorker).toHaveBeenLastCalledWith(undefined, null);
    expect(await actions.open({ kind: "conversation", id: "unknown" })).toBe(false);
  });

  it.each(["chat", "relay", "worker"] as const)(
    "keeps %s selection single-flight without dimming unrelated navigation",
    async (target) => {
      const { actions, context, status, reveal } = fixture();
      const gate = deferred();
      vi.mocked(context.api.orchestrationChatAction).mockImplementation(() =>
        gate.promise.then(() => undefined),
      );
      context.selectWorker = vi.fn(() => gate.promise.then(() => true));
      const destination = { kind: "conversation", id: target } as const;
      const selection = actions.open(destination);
      expect(status).toHaveBeenCalledWith(true, "", false, false);
      expect(await actions.open(destination)).toBe(false);
      expect(reveal).not.toHaveBeenCalled();
      gate.resolve();
      expect(await selection).toBe(true);
      expect(reveal).toHaveBeenCalledExactlyOnceWith(destination);
      expect(status).toHaveBeenLastCalledWith(false, "", false);
    },
  );

  it("keeps destructive chat actions blocking and reveals only their successful destination", async () => {
    const { actions, context, status, reveal } = fixture();
    expect(await actions.chatAction({ type: "new", projectId: "a" })).toBe(true);
    expect(status).toHaveBeenCalledWith(true, "", false, true);
    expect(context.onPage).toHaveBeenCalledWith("chat");
    reveal.mockClear();
    vi.mocked(context.api.orchestrationChatAction).mockRejectedValueOnce(new Error("Unavailable"));
    expect(await actions.chatAction({ type: "select", id: "relay" })).toBe(false);
    expect(status).toHaveBeenCalledWith(true, "Unavailable", false, false);
    expect(reveal).not.toHaveBeenCalled();
  });

  it("guards asynchronous worker navigation against later destinations", async () => {
    const { actions, context } = fixture(),
      gate = deferred();
    context.selectWorker = vi.fn(async (_id, _project, current) => {
      await gate.promise;
      return current?.() ?? true;
    });
    const pending = actions.open({ kind: "conversation", id: "worker" });
    await actions.open({ kind: "page", id: "experiments" });
    gate.resolve();
    expect(await pending).toBe(false);
    expect(context.onPage).toHaveBeenCalledExactlyOnceWith("experiments");
  });

  it("selects workers through the same guarded action without creating chats", async () => {
    const { actions, context } = fixture();
    expect(await actions.open({ kind: "conversation", id: "worker" })).toBe(true);
    expect(context.selectWorker).toHaveBeenCalledWith("worker", undefined, expect.any(Function));
    expect(context.onPage).toHaveBeenCalledWith("chat");
    expect(context.api.orchestrationChatAction).not.toHaveBeenCalled();
  });

  it("does not open a conversation whose owner closed while selection was pending", async () => {
    const { actions, context } = fixture(),
      gate = deferred();
    vi.mocked(context.api.orchestrationChatAction).mockImplementation(() =>
      gate.promise.then(() => undefined),
    );
    const pending = actions.open({ kind: "conversation", id: "chat" });
    context.chats = [];
    gate.resolve();
    expect(await pending).toBe(false);
    expect(context.onPage).not.toHaveBeenCalled();
  });

  it("archives the displayed conversation through Relay without creating a replacement chat", async () => {
    const { actions, context, reveal } = fixture();
    await actions.chatAction({ type: "archive", id: "chat" });
    expect(context.onPage).not.toHaveBeenCalled();
    context.tabs = initialTabs;
    expect(await actions.chatAction({ type: "archive", id: "chat" })).toBe(true);
    expect(context.api.orchestrationChatAction).toHaveBeenLastCalledWith({
      type: "select",
      id: "relay",
    });
    expect(context.onArchived).toHaveBeenCalledOnce();
    expect(context.onPage).toHaveBeenCalledWith("chat");
    expect(reveal).toHaveBeenCalledExactlyOnceWith({ kind: "conversation", id: "relay" });
  });

  it("archives a background last chat without navigating or creating a session", async () => {
    const { actions, context, reveal } = fixture();
    context.tabs = initialTabs;
    context.selectedId = "relay";
    expect(await actions.chatAction({ type: "archive", id: "chat" })).toBe(true);
    expect(context.api.orchestrationChatAction).toHaveBeenCalledExactlyOnceWith({
      type: "archive",
      id: "chat",
    });
    expect(context.api.projectAction).not.toHaveBeenCalled();
    expect(context.onPage).not.toHaveBeenCalled();
    expect(context.onArchived).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
  });

  it.each(["page", "epoch", "failure"] as const)(
    "does not navigate an archived chat after %s",
    async (change) => {
      const { actions, context, status } = fixture(),
        gate = deferred();
      context.tabs = initialTabs;
      vi.mocked(context.api.orchestrationChatAction).mockImplementation(() =>
        gate.promise.then(() => undefined),
      );
      if (change === "failure")
        vi.mocked(context.api.orchestrationChatAction).mockRejectedValueOnce(
          new Error("Archive failed"),
        );
      const pending = actions.chatAction({ type: "archive", id: "chat" });
      if (change === "page") await actions.open({ kind: "page", id: "apps" });
      if (change === "epoch") context.databaseEpoch = 2;
      gate.resolve();
      expect(await pending).toBe(false);
      expect(context.onArchived).not.toHaveBeenCalled();
      if (change === "failure")
        expect(status).toHaveBeenCalledWith(true, "Archive failed", false, true);
    },
  );
});

it("opens custom assistants without a database and selects existing custom conversations", async () => {
  const { actions, context } = fixture();
  context.database = null;
  context.api.customAgent = vi.fn(async () => ({ agents: [], conversationId: "custom-run" }));
  expect(await actions.open({ kind: "custom-agent", id: "custom-definition" })).toBe(true);
  expect(context.api.customAgent).toHaveBeenCalledWith({ type: "open", id: "custom-definition" });
  expect(context.selectWorker).toHaveBeenCalledWith(undefined, null);
  expect(context.onPage).toHaveBeenCalledWith("chat");
  context.chats = [
    ...context.chats,
    {
      kind: "relay",
      customAgentId: "custom-definition",
      conversationId: "custom-conversation",
      run: { id: "custom-run" },
    } as OrchestrationChat,
  ];
  expect(await actions.open({ kind: "conversation", id: "custom-run" })).toBe(true);
  expect(context.api.orchestrationChatAction).toHaveBeenCalledWith({
    type: "select",
    id: "custom-run",
  });
});

it("opens Providers without a database or a chat selection", async () => {
  const { actions, context } = fixture();
  context.database = null;
  expect(await actions.open({ kind: "page", id: "providers" })).toBe(true);
  expect(context.onPage).toHaveBeenCalledExactlyOnceWith("providers");
  expect(context.api.orchestrationChatAction).not.toHaveBeenCalled();
});
