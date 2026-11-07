import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, DesktopRun, OrchestrationChat } from "../bridge/index.js";
import type { RunEvent, RunStatus, RunView } from "../core/index.js";
import { ChatSidebar } from "./chat-sidebar.js";
import { conversations, reconcileDisclosure } from "./chats.js";
import { WorkerChat } from "./worker-chat.js";

const view = (id: string, status: RunStatus = "idle"): RunView => ({
  id,
  agent: "fake",
  branch: null,
  worktree: "/project",
  status,
  turns: 1,
  pending: [],
  stopping: false,
});
const chat = (id: string, workers: string[] = []): OrchestrationChat => ({
  run: view(id),
  directory: `/workspace/${id}`,
  error: null,
  events: [],
  workers,
  updates: { paused: false, pending: 0 },
});
const run = (id: string, status: RunStatus = "idle"): DesktopRun =>
  ({
    record: { id, agent: "fake", status, turns: 1, worktree: "/project", branch: null },
    view: view(id, status),
  }) as DesktopRun;
afterEach(() => vi.unstubAllGlobals());

describe("conversation hierarchy", () => {
  it("nests only known owned workers and includes manual and historical runs once", () => {
    expect(
      conversations(
        [chat("a", ["one", "missing"]), chat("b", ["two", "one"])],
        [run("one"), run("manual"), run("two"), run("history", "finished")],
      ),
    ).toEqual([
      { id: "a", label: "Chat 1", role: "orchestrator" },
      { id: "one", label: "fake / one", role: "worker", parentId: "a" },
      { id: "b", label: "Chat 2", role: "orchestrator" },
      { id: "two", label: "fake / two", role: "worker", parentId: "b" },
      { id: "manual", label: "fake / manual", role: "worker" },
      { id: "history", label: "fake / istory", role: "worker" },
    ]);
  });
  it("shows workers at the root after owner replacement or loss, without inferring ownership", () => {
    const unavailable = { ...chat("old", ["one"]), run: null };
    expect(conversations([unavailable, chat("new")], [run("one")]).at(-1)).toEqual({
      id: "one",
      label: "fake / one",
      role: "worker",
    });
  });
  it("removes previous-project children while retaining app-wide orchestrators", () => {
    const chats = [chat("a", ["one"])];
    expect(conversations(chats, []).map(({ id }) => id)).toEqual(["a"]);
    expect(conversations(chats, [run("other-project")]).map(({ id }) => id)).toEqual([
      "a",
      "other-project",
    ]);
  });
  it("preserves manual collapse until a new worker appears and drops obsolete parents", () => {
    const initial = conversations([chat("a", ["one"])], [run("one")]);
    expect([...reconcileDisclosure({}, initial, new Set(["a", "gone"]))]).toEqual([]);
    expect([...reconcileDisclosure({ a: ["one"] }, initial, new Set(["a"]))]).toEqual(["a"]);
    const next = conversations([chat("a", ["one", "two"])], [run("one"), run("two")]);
    expect([...reconcileDisclosure({ a: ["one"] }, next, new Set(["a"]))]).toEqual([]);
  });
  it("renders distinct left-side role icons, nested groups, and independent unread/status indicators", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => null });
    const events = {
      one: [{ runId: "one", at: "2026-01-01", type: "message", text: "reply" }] as RunEvent[],
    };
    const html = renderToStaticMarkup(
      <ChatSidebar
        chats={[chat("a", ["one"])]}
        runs={[run("one", "failed"), run("manual")]}
        navigationSerial={undefined}
        selectedId="a"
        database="/db"
        eventsByRun={events}
        open
        pending={false}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain('data-role="orchestrator"');
    expect(html).toContain('data-role="worker"');
    expect(html).toContain('aria-label="Workers for Chat 1"');
    expect(html).toContain('aria-label="Chat 1 workers"');
    expect(html).toContain('aria-label="1 unread reply"');
    expect(html).toContain("Worker. Failed");
    expect(html).toMatch(
      /data-role="orchestrator".*?<svg.*?<span class="chat-sidebar-label">Chat 1/,
    );
    expect(html).toMatch(
      /data-role="worker".*?<svg.*?<span class="chat-sidebar-label">fake \/ one/,
    );
    expect(html).not.toContain('role="dialog"');
  });
  it("clears unread for the selected worker without clearing its siblings", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => null });
    const events = Object.fromEntries(
      ["one", "two"].map((id) => [
        id,
        [{ runId: id, at: "2026-01-01", type: "message", text: "reply" }],
      ]),
    ) as Record<string, RunEvent[]>;
    const html = renderToStaticMarkup(
      <ChatSidebar
        chats={[chat("a", ["one", "two"])]}
        runs={[run("one"), run("two")]}
        navigationSerial={undefined}
        selectedId="one"
        database="/db"
        eventsByRun={events}
        open
        pending={false}
        onSelect={() => {}}
      />,
    );
    expect(html.match(/aria-label="1 unread reply"/g)).toHaveLength(1);
  });
});

describe("embedded worker chat", () => {
  const render = (worker: DesktopRun, events: RunEvent[] = []) => {
    vi.stubGlobal("sessionStorage", { getItem: () => null });
    return renderToStaticMarkup(
      <WorkerChat
        api={{} as DesktopApi}
        run={worker}
        orchestrated
        events={events}
        active
        request={undefined}
        loading={false}
        historyError={undefined}
        onRetry={() => {}}
      />,
    );
  };
  it("keeps conversation controls and allow-all identity without popup window controls", () => {
    const html = render(run("one"));
    expect(html).toContain('class="orchestration-chat-page worker-chat-page"');
    expect(html).toContain("Orchestrator worker, allows all");
    expect(html).toContain('aria-label="Worker composer"');
    expect(html).not.toContain('role="dialog"');
    for (const label of ["Minimize chat", "Close chat", "full screen"])
      expect(html).not.toContain(label);
  });
  it("keeps permissions, Stop, copy, timing, and collapsed activity", () => {
    const worker = run("one", "waiting");
    if (worker.view)
      worker.view.pending = [
        { id: "permission", runId: "one", toolCallId: "tool", kind: "execute", title: "Run tests" },
      ];
    const events = [
      { type: "prompt", turn: 1, text: "task" },
      { type: "thought", text: "thinking" },
      { type: "message", text: "reply" },
    ].map((event) => ({ runId: "one", at: "2026-01-01T00:00:00Z", ...event })) as RunEvent[];
    const html = render(worker, events);
    expect(html).toContain(">Stop</button>");
    expect(html).toContain(">Allow once</button>");
    expect(html).toContain('class="chat-activity"');
    expect(html).toContain('class="turn-timer"');
    expect(html.match(/aria-label="Copy message"/g)).toHaveLength(2);
  });
  it("keeps deleted-worktree sessions visible but inactive", () => {
    const worker = run("one", "finished");
    worker.record.discardedAt = "2026-01-01";
    const html = render(worker);
    expect(html).toContain("Its worktree was deleted.");
    expect(html).not.toContain("<textarea");
  });
});
