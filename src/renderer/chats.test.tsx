import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, DesktopRun, OrchestrationChat } from "../bridge/index.js";
import type { RunEvent, RunStatus, RunView } from "../core/index.js";
import { ChatSidebar } from "./chat-sidebar.js";
import { conversations, conversationTitle, reconcileDisclosure, workerLabel } from "./chats.js";
import { ProjectChatSidebar } from "./project-chat-sidebar.js";
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
  it("keeps a failed Relay connection navigable by its stable identity", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => null });
    const failed = {
      ...chat("old"),
      kind: "relay" as const,
      conversationId: "relay-id",
      run: null,
    };
    expect(conversations([failed], [])).toEqual([
      { id: "relay-id", label: "Relay", role: "orchestrator" },
    ]);
    const html = renderToStaticMarkup(
      <ChatSidebar
        chats={[failed]}
        runs={[]}
        selectedId="relay-id"
        relayNavigation
        database={null}
        eventsByRun={{}}
        navigationSerial={undefined}
        open
        pending={false}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain('id="conversation-relay-id"');
    expect(html).toContain("relay-navigation-icon");
    expect(html).not.toContain('data-icon="chat-circle"');
    expect(html).not.toContain('data-icon="arrow-elbow-down-right"');
    expect(html).not.toContain("disabled");
  });
  it("renders only project-bound conversations inside project groups", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => null });
    const projects = ["a", "b", "c"].map((id) => ({
      id,
      path: `/project-${id}`,
      active: id === "a",
      chatIds: [id],
      workerIds: id === "a" ? ["one"] : [],
    }));
    const html = renderToStaticMarkup(
      <ProjectChatSidebar
        projects={projects}
        selectedProjectId="b"
        onProjectAction={async () => true}
        chats={[
          { ...chat("relay"), kind: "relay" },
          { ...chat("unbound"), title: "Legacy history" },
          ...projects.map((project) => ({
            ...chat(project.id, project.workerIds),
            kind: "project" as const,
            projectId: project.id,
          })),
        ]}
        runs={[run("one")]}
        navigationSerial={undefined}
        selectedId="b"
        database="/db"
        eventsByRun={{}}
        open
        pending={false}
        onSelect={() => {}}
      />,
    );
    const sections = html.match(/<section[\s\S]*?<\/section>/g) ?? [];
    expect(sections).toHaveLength(3);
    expect(html).not.toContain('id="conversation-relay"');
    expect(html).not.toContain("Legacy history");
    sections.forEach((section, index) => {
      const project = projects[index];
      expect(section).toContain(`id="conversation-${project?.id}"`);
      expect(section).not.toContain('id="conversation-relay"');
      expect(section.indexOf("project-chat-name")).toBeLessThan(section.indexOf("New chat in"));
      expect(section.indexOf("New chat in")).toBeLessThan(section.indexOf("More for"));
      expect(section).not.toContain("Toggle chats");
      expect(section).toContain('aria-expanded="true"');
      expect(section).toContain('aria-hidden="false"');
    });
    expect(sections[0]).toContain('id="conversation-one"');
    expect(sections[1]).not.toContain('id="conversation-one"');
  });
  it("numbers project chats within their owner, consistently with a filtered sidebar", () => {
    const relay = { ...chat("relay"), kind: "relay" as const };
    const a = { ...chat("a"), kind: "project" as const, projectId: "a" };
    const b = { ...chat("b"), kind: "project" as const, projectId: "b" };
    const next = { ...chat("next"), kind: "project" as const, projectId: "a" };
    const all = [relay, a, b, next];
    expect(all.map((item) => conversationTitle(all, item))).toEqual([
      "Relay",
      "Chat 1",
      "Chat 1",
      "Chat 2",
    ]);
    expect(conversations(all, []).find((item) => item.id === next.run?.id)?.label).toBe(
      conversations([a, next], [])[1]?.label,
    );
  });
  it.each([true, false])("marks only the opened conversation current (Chat open: %s)", (open) => {
    vi.stubGlobal("sessionStorage", { getItem: () => null });
    for (const selectedId of ["a", "one", "manual"]) {
      const html = renderToStaticMarkup(
        <ChatSidebar
          chats={[chat("a", ["one"])]}
          runs={[run("one"), run("manual")]}
          navigationSerial={undefined}
          selectedId={selectedId}
          database="/db"
          eventsByRun={{}}
          open={open}
          pending={false}
          onSelect={() => {}}
        />,
      );
      expect(html.match(/aria-current="true"/g) ?? []).toHaveLength(open ? 1 : 0);
      expect(html.match(/data-nav-active="true"/g) ?? []).toHaveLength(open ? 1 : 0);
      const selected = html.match(
        new RegExp(`<button[^>]*id="conversation-${selectedId}"[^>]*>`),
      )?.[0];
      expect(selected?.includes('aria-current="true"')).toBe(open);
    }
  });
  it("uses titles and hides archived chats without hiding their recorded workers", () => {
    const archived = { ...chat("a", ["one"]), title: "Old work", archived: true };
    expect(conversations([archived, { ...chat("b"), title: "Fix parser" }], [run("one")])).toEqual([
      { id: "b", label: "Fix parser", role: "orchestrator" },
      { id: "one", label: "fake / one", role: "worker" },
    ]);
    expect(archived.run?.id).toBe("a");
  });
  it("nests only known owned workers and includes unfinished manual and historical runs once", () => {
    expect(
      conversations(
        [chat("a", ["one", "missing"]), chat("b", ["two", "one"])],
        [run("one"), run("manual"), run("two"), run("history", "failed")],
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
  it("hides finished workers unless a current orchestrator owns them", () => {
    const archived = { ...chat("old", ["archived"]), archived: true };
    const finished = (id: string) => run(id, "finished");
    expect(
      conversations(
        [chat("a", ["owned"]), archived],
        [finished("owned"), finished("archived"), finished("manual"), run("failed", "failed")],
      ).map(({ id }) => id),
    ).toEqual(["a", "owned", "failed"]);
    const live = finished("live");
    if (live.view) live.view.status = "running";
    expect(conversations([], [live]).map(({ id }) => id)).toEqual(["live"]);
    expect(conversations([], [finished("manual")], "manual").map(({ id }) => id)).toEqual([
      "manual",
    ]);
  });
  it("names workers by the role the orchestrator assigned", () => {
    const owner = { ...chat("a", ["one", "two"]), workerLabels: { one: "Parser fix" } };
    expect(conversations([owner], [run("one"), run("two")])).toEqual([
      { id: "a", label: "Chat 1", role: "orchestrator" },
      { id: "one", label: "Parser fix", role: "worker", parentId: "a" },
      { id: "two", label: "fake / two", role: "worker", parentId: "a" },
    ]);
    const archived = { ...owner, archived: true };
    expect(conversations([archived], [run("one")])).toEqual([
      { id: "one", label: "Parser fix", role: "worker" },
    ]);
    expect(workerLabel([owner], run("one"))).toBe("Parser fix");
    expect(workerLabel([owner], run("two"))).toBe("fake / two");
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
  it("marks conversation roles with icons while retaining text status and separate actions", () => {
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
    expect(html).toContain('aria-label="Actions for Chat 1"');
    expect(html).not.toContain('aria-label="Actions for fake');
    expect(html).toContain('data-role="worker"');
    expect(html).toContain('aria-label="Workers for Chat 1"');
    expect(html).toContain('aria-label="Chat 1 workers"');
    expect(html).toContain('aria-label="1 unread reply"');
    expect(html).toContain("Worker. Failed");
    expect(html).toContain('<span class="chat-sidebar-status">Failed</span>');
    for (const action of ["Actions", "Workers"]) {
      const button = html.match(
        new RegExp(`<button[^>]*aria-label="${action} for Chat 1"[\\s\\S]*?</button>`),
      )?.[0];
      expect(button).toContain('class="icon-button');
      expect(button?.match(/<svg/g)).toHaveLength(1);
    }
    const entries = html.match(/<button[^>]*class="chat-sidebar-entry"[\s\S]*?<\/button>/g) ?? [];
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(entry).toContain(
        entry.includes('data-role="orchestrator"')
          ? 'data-icon="chat-circle"'
          : 'data-icon="arrow-elbow-down-right"',
      );
      expect(entry).toContain('aria-hidden="true" focusable="false"');
    }
    expect(html).not.toContain("<img");
    expect(html).not.toContain('role="dialog"');
  });
  it("keeps errors and approval counts visible as text", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => null });
    const owner = chat("a");
    owner.error = "Connection failed";
    if (owner.run)
      owner.run.pending = [
        { id: "permission", runId: "a", toolCallId: "tool", kind: "execute", title: "Run command" },
      ];
    const html = renderToStaticMarkup(
      <ChatSidebar
        chats={[owner]}
        runs={[]}
        navigationSerial={undefined}
        selectedId="a"
        database="/db"
        eventsByRun={{}}
        open
        pending
        onSelect={() => {}}
      />,
    );
    expect(html).toContain('<span class="chat-sidebar-status">Error</span>');
    expect(html).toContain('<span class="chat-approval-count">(1)</span>');
    expect(html).toContain("Connection failed. 1 approvals waiting");
    expect(html.match(/<button[^>]*aria-label="Actions for Chat 1"[^>]*>/)?.[0]).toContain(
      "disabled",
    );
    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html).not.toContain("<img");
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
  const render = (
    worker: DesktopRun,
    events: RunEvent[] = [],
    orchestrated = true,
    label?: string,
  ) => {
    vi.stubGlobal("sessionStorage", { getItem: () => null });
    return renderToStaticMarkup(
      <WorkerChat
        api={{} as DesktopApi}
        run={worker}
        {...(label === undefined ? {} : { label })}
        orchestrated={orchestrated}
        events={events}
        active
        request={undefined}
        loading={false}
        historyError={undefined}
        onRetry={() => {}}
      />,
    );
  };
  it.each([true, false])(
    "renders Markdown replies for live and historical workers (%s)",
    (historical) => {
      const worker = run("one", historical ? "finished" : "idle");
      if (historical) delete worker.view;
      const events: RunEvent[] = [
        { runId: "one", at: "2026-01-01", type: "prompt", turn: 1, text: "**literal user**" },
        { runId: "one", at: "2026-01-01", type: "message", text: "# Result\n\n**Bo" },
        { runId: "one", at: "2026-01-01T00:00:30Z", type: "message", text: "ld** and `code`" },
      ];
      const html = render(worker, events);
      expect(html).toContain("<h1>Result</h1>");
      expect(html).toContain("<strong>Bold</strong>");
      expect(html).toContain("<code>code</code>");
      expect(html).toContain("<pre>**literal user**</pre>");
      expect(html.match(/aria-label="Copy message"/g)).toHaveLength(2);
      expect(html.toLowerCase().match(/datetime="2026-01-01t00:00:00.000z"/g)).toHaveLength(2);
      expect(html.toLowerCase()).not.toContain('datetime="2026-01-01t00:00:30.000z"');
    },
  );
  it.each([true, false])(
    "shows MCP attribution for owned/manual and historical workers (%s)",
    (orchestrated) => {
      const html = render(
        run("one", "finished"),
        [
          {
            runId: "one",
            at: "2026-01-01",
            type: "toolCall",
            toolCallId: "t1",
            title: "Snapshot",
            kind: "other",
            status: "completed",
            mcp: { server: "playwright" },
          },
        ],
        orchestrated,
      );
      expect(html).toContain('class="mcp-badge"');
      expect(html).toContain('aria-label="MCP server: playwright"');
    },
  );
  it("keeps conversation controls and allow-all identity without popup window controls", () => {
    const html = render(run("one"));
    expect(html).toContain('class="orchestration-chat-page worker-chat-page"');
    expect(html).toContain(
      '<span class="chat-role-icon" aria-hidden="true"><svg class="carbon-icon"',
    );
    expect(html).toContain('d="M16,31c-1.6543');
    expect(html).toContain("Orchestrator worker");
    expect(html).toContain("Code60 auto-approval: On");
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
    expect(html).not.toContain('class="turn-separator"');
    expect(html.match(/aria-label="Copy message"/g)).toHaveLength(2);
  });
  it("titles the worker by its role name, falling back to provider and run ID", () => {
    expect(render(run("one"), [], true, "Test writer")).toMatch(/Test writer<\/h2>/);
    expect(render(run("one"))).toMatch(/fake \/ one<\/h2>/);
  });
  it("keeps deleted-worktree sessions visible but inactive", () => {
    const worker = run("one", "finished");
    worker.record.discardedAt = "2026-01-01";
    const html = render(worker);
    expect(html).toContain("Its worktree was deleted.");
    expect(html).not.toContain("<textarea");
  });
});
