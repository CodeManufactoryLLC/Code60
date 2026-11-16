import { describe, expect, it, vi } from "vitest";
import type { DesktopApi, DesktopRun, OrchestrationChat } from "../bridge/index.js";
import { createNavigationActions } from "./navigation-actions.js";
import { initialTabs } from "./tabs.js";

function fixture() {
  const context: ReturnType<Parameters<typeof createNavigationActions>[0]> = {
    api: {
      projectAction: vi.fn(async () => {}),
      orchestrationChatAction: vi.fn(async () => {}),
    } as unknown as DesktopApi,
    tabs: { ...initialTabs, active: "projects" },
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
    onProject: vi.fn(),
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
  it("selects a project home without opening/creating a conversation or clearing its worker", async () => {
    const { actions, context, status } = fixture();
    expect(await actions.open({ kind: "project", id: "a" })).toBe(true);
    expect(context.api.projectAction).toHaveBeenCalledExactlyOnceWith({
      type: "select",
      projectId: "a",
    });
    expect(context.onProject).toHaveBeenCalledExactlyOnceWith("a");
    expect(context.api.orchestrationChatAction).not.toHaveBeenCalled();
    expect(context.selectWorker).not.toHaveBeenCalled();
    expect(status.mock.calls).toEqual([
      [true, "", true, false],
      [false, "", false],
    ]);
    expect(await actions.open({ kind: "project", id: "closed" })).toBe(false);
  });
  it.each(["database", "epoch", "page", "close", "invalidate", "raw-page"] as const)(
    "discards late project selection after %s changes",
    async (change) => {
      const { actions, context } = fixture(),
        gate = deferred();
      vi.mocked(context.api.projectAction).mockImplementation(() => gate.promise);
      const pending = actions.open({ kind: "project", id: "a" });
      expect(await actions.open({ kind: "project", id: "a" })).toBe(false);
      if (change === "database") context.database = "/other";
      if (change === "epoch") context.databaseEpoch = 2;
      if (change === "page") await actions.open({ kind: "page", id: "apps" });
      if (change === "raw-page") context.tabs = { ...initialTabs, active: "settings" };
      if (change === "close") context.projects = [];
      if (change === "invalidate") actions.invalidate();
      gate.resolve();
      expect(await pending).toBe(false);
      expect(context.onProject).not.toHaveBeenCalled();
    },
  );
  it("reports failures, releases in-flight guards, and resets Settings to its home", async () => {
    const { actions, context, status } = fixture();
    vi.mocked(context.api.projectAction).mockRejectedValueOnce(new Error("Selection failed"));
    expect(await actions.open({ kind: "project", id: "a" })).toBe(false);
    expect(status).toHaveBeenCalledWith(true, "Selection failed", true, false);
    expect(await actions.open({ kind: "project", id: "a" })).toBe(true);
    await actions.open({ kind: "page", id: "settings" });
    expect(context.onSection).toHaveBeenLastCalledWith(null);
    await actions.open({ kind: "settings", id: "updates" });
    expect(context.onSection).toHaveBeenLastCalledWith("updates");
    expect(context.onPage).toHaveBeenLastCalledWith("settings");
    await actions.projectAction({ type: "select", projectId: "a" });
    expect(context.api.projectAction).toHaveBeenCalledTimes(3);
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
  it.each(["project", "chat", "relay", "worker"] as const)(
    "keeps %s selection single-flight without dimming unrelated navigation",
    async (target) => {
      const { actions, context, status, reveal } = fixture();
      const gate = deferred();
      vi.mocked(context.api.projectAction).mockImplementation(() => gate.promise);
      vi.mocked(context.api.orchestrationChatAction).mockImplementation(() =>
        gate.promise.then(() => undefined),
      );
      context.selectWorker = vi.fn(() => gate.promise.then(() => true));
      const destination =
        target === "project"
          ? ({ kind: "project", id: "a" } as const)
          : ({ kind: "conversation", id: target } as const);
      const selection = actions.open(destination);
      expect(status).toHaveBeenCalledWith(true, "", target === "project", false);
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
    expect(reveal).toHaveBeenCalledExactlyOnceWith({ kind: "project", id: "a" });
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
  it("archives the displayed conversation through Relay without changing another page", async () => {
    const { actions, context } = fixture();
    await actions.chatAction({ type: "archive", id: "chat" });
    expect(context.onPage).not.toHaveBeenCalled();
    context.tabs = initialTabs;
    await actions.chatAction({ type: "archive", id: "chat" });
    expect(context.api.orchestrationChatAction).toHaveBeenLastCalledWith({
      type: "select",
      id: "relay",
    });
    expect(context.onArchived).toHaveBeenCalledOnce();
    expect(context.onPage).toHaveBeenCalledWith("chat");
  });
});
