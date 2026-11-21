import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ActivitySnapshot,
  DesktopApi,
  DesktopRun,
  OrchestrationChat,
} from "../bridge/index.js";
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
  const activity = (state: ActivitySnapshot["state"]): ActivitySnapshot => ({
    state,
    label: state,
    source: "host",
    active: state === "working",
    urgent: false,
    declaration: null,
    workerCount: state === "waiting_for_workers" ? 1 : 0,
    otherOperations: 0,
  });
  const activityChat = (
    kind: "project" | "relay" | "custom",
    status: RunStatus,
    state: ActivitySnapshot["state"],
  ): OrchestrationChat => ({
    ...chat("owner"),
    kind: kind === "project" ? "project" : "relay",
    ...(kind === "custom" ? { customAgentId: "assistant-id" } : {}),
    run: view("owner", status),
    activity: activity(state),
  });
  const renderOwner = (owner: OrchestrationChat) => {
    vi.stubGlobal("sessionStorage", { getItem: () => null });
    return renderToStaticMarkup(
      <ChatSidebar
        chats={[owner]}
        runs={[]}
        selectedId={undefined}
        navigationSerial={undefined}
        database="/db"
        eventsByRun={{}}
        open
        pending={false}
        onSelect={() => {}}
      />,
    );
  };

  it.each(["project", "relay", "custom"] as const)(
    "keeps restored queued/running %s history static despite a retained run view",
    (kind) => {
      for (const status of ["queued", "running"] as const) {
        const owner = { ...activityChat(kind, status, "idle"), restored: true };
        expect(renderOwner(owner)).not.toContain('data-working="true"');
      }
    },
  );

  it.each(["project", "relay", "custom"] as const)(
    "stops %s spotlight and exposes stopping before its provider finishes",
    (kind) => {
      const owner = activityChat(kind, "running", "stopping");
      expect(owner.run?.stopping).toBe(false);
      const html = renderOwner(owner);
      expect(html).not.toContain('data-working="true"');
      expect(html).toContain('aria-description="Orchestrator. Stopping"');
    },
  );

  it.each(["project", "relay", "custom"] as const)(
    "exposes %s worker monitoring through its description and tooltip",
    (kind) => {
      const html = renderOwner(activityChat(kind, "idle", "waiting_for_workers"));
      expect(html).toContain('data-working="true"');
      expect(html).toContain('aria-description="Orchestrator. Monitoring subagents"');
      expect(html).toMatch(/title="[^"]*Monitoring subagents"/);
      expect(html).not.toContain("Awaiting input");
    },
  );

  it.each<RunStatus>([
    "queued",
    "running",
    "waiting",
    "idle",
    "finished",
    "failed",
    "cancelled",
    "timed_out",
    "interrupted",
  ])("spotlights only live active sidebar entries (%s)", (status) => {
    vi.stubGlobal("sessionStorage", { getItem: () => null });
    const ownerRun = view("owner", status);
    const owner: OrchestrationChat = {
      ...chat("owner", ["worker"]),
      title: "Custom assistant",
      kind: "relay",
      customAgentId: "assistant-id",
      run: ownerRun,
      activity: activity(
        status === "queued"
          ? "connecting"
          : status === "running"
            ? "working"
            : status === "waiting"
              ? "waiting_for_approval"
              : status,
      ),
    };
    const relay: OrchestrationChat = {
      ...chat("relay"),
      kind: "relay",
      run: view("relay", status),
      activity: owner.activity,
    };
    const worker = run("worker", status);
    const render = () =>
      renderToStaticMarkup(
        <ChatSidebar
          chats={[owner, relay]}
          runs={[worker]}
          selectedId="relay"
          navigationSerial={undefined}
          database="/db"
          eventsByRun={{}}
          open
          pending={false}
          onSelect={() => {}}
        />,
      );
    const working = () => (render().match(/data-working="true"/g) ?? []).length;
    expect(working()).toBe(status === "running" || status === "queued" ? 3 : 0);
    if (status !== "running") return;
    ownerRun.stopping = true;
    expect(working()).toBe(2);
    relay.error = "Connection failed";
    expect(working()).toBe(1);
    if (worker.view) worker.view.pending = [{ id: "approval" } as RunView["pending"][number]];
    expect(working()).toBe(0);
    ownerRun.stopping = false;
    ownerRun.status = "idle";
    owner.activity = { state: "waiting_for_workers" } as NonNullable<OrchestrationChat["activity"]>;
    expect(working()).toBe(1);
    delete worker.view;
    expect(working()).toBe(1); // A running saved record without a live view is static.
    owner.run = null;
    expect(working()).toBe(0);
  });

  it("keeps a cancelling worker static before its provider finishes", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => null });
    const worker = run("worker", "running");
    if (!worker.view) throw new Error("Missing worker view");
    worker.view.cancelling = true;
    const html = renderToStaticMarkup(
      <ChatSidebar
        chats={[]}
        runs={[worker]}
        selectedId={undefined}
        navigationSerial={undefined}
        database="/db"
        eventsByRun={{}}
        open
        pending={false}
        onSelect={() => {}}
      />,
    );
    expect(html).not.toContain('data-working="true"');
    expect(html).toContain('aria-description="Worker. Stopping"');
  });

  it("keeps worker interruption history without showing the retired PID as a chat warning", () => {
    const worker = run("old-worker", "interrupted");
    worker.record.reason = "the owning process (PID 12345) is gone";
    const html = renderToStaticMarkup(
      <WorkerChat
        api={{} as DesktopApi}
        run={worker}
        orchestrated
        events={[]}
        active
        request={undefined}
        loading={false}
        historyError={undefined}
        onRetry={() => {}}
      />,
    );
    expect(html).not.toContain("PID 12345");
    expect(html).toContain("Interrupted");
    expect(worker.record.reason).toBe("the owning process (PID 12345) is gone");
  });

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
    expect(html).toContain('data-icon="app-steering-wheel"');
    expect(html).not.toContain('data-icon="app-communication"');
    expect(html).not.toContain('data-icon="app-down-right"');
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
        homeProjectId={undefined}
        onProjectOpen={() => {}}
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
      expect(section.indexOf("project-chat-name")).toBeLessThan(
        section.indexOf("project-session-add"),
      );
      expect(section.indexOf("project-session-add")).toBeLessThan(
        section.indexOf("project-folder-stop"),
      );
      expect(section.indexOf("project-folder-stop")).toBeLessThan(
        section.indexOf("project-chat-toggle"),
      );
      expect(section.indexOf("project-chat-toggle")).toBeLessThan(
        section.indexOf("project-chat-pages"),
      );
      expect(section.indexOf("New Session in")).toBeLessThan(section.indexOf("project-chat-pages"));
      expect(section.indexOf("New Session in")).toBeLessThan(section.indexOf("chat-sidebar"));
      expect(section).toContain(`aria-label="Close Project: ${project?.path}"`);
      expect(section).toContain('title="Close Project"');
      expect(section).toContain('data-tooltip="Close Project"');
      expect(section).toContain('class="sidebar-card-stop"');
      const stopButton = section.match(
        /<button[^>]*class="icon-button project-folder-stop"[^>]*>/,
      )?.[0];
      expect(stopButton).not.toContain('aria-haspopup="menu"');
      expect(section).not.toContain("Toggle chats");
      expect(section).toContain('aria-expanded="true"');
      expect(section).toContain('aria-hidden="false"');
      const folder = section.match(/<span class="project-chat-label">([\s\S]*?)<\/span>/)?.[0];
      expect(folder).toContain('data-icon="app-folder"');
      expect(folder).toContain("folder.png");
      expect(folder).toContain('data-animated="true"');
      expect(folder).toContain('alt="" aria-hidden="true" draggable="false"');
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
  it("marks conversation roles with icons, accessible status and separate actions without worker unread counts", () => {
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
    expect(html).not.toContain('class="chat-unread"');
    expect(html).toContain("Worker. Failed");
    expect(html).not.toContain('class="chat-sidebar-status"');
    expect(html).toContain('<span class="sr-only">Worker. Failed</span>');
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
          ? 'data-icon="app-communication"'
          : 'data-icon="app-down-right"',
      );
      expect(entry).toContain('alt="" aria-hidden="true" draggable="false"');
    }
    expect(html.match(/<img/g)).toHaveLength(3);
    expect(html).not.toContain('role="dialog"');
  });
  it("keeps errors accessible and approval counts visible without a status label", () => {
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
    expect(html).not.toContain('class="chat-sidebar-status"');
    expect(html).toContain(
      'aria-description="Orchestrator. Connection failed. 1 approvals waiting"',
    );
    expect(html).toContain('<span class="chat-approval-count">(1)</span>');
    expect(html).toContain("Connection failed. 1 approvals waiting");
    expect(html.match(/<button[^>]*aria-label="Actions for Chat 1"[^>]*>/)?.[0]).toContain(
      "disabled",
    );
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html.match(/<img/g)).toHaveLength(1);
    expect(html).toContain('data-icon="app-communication"');
  });
  it("keeps orchestrator unread counts while hiding selected and background worker counts", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => null });
    const events = Object.fromEntries(
      ["a", "one", "two"].map((id) => [
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
    expect(html).toContain(
      '<span class="sr-only">Orchestrator. Awaiting input. 1 unread reply</span>',
    );
    expect(html).not.toContain("Worker. Awaiting input. 1 unread reply");
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
        notice={<p role="status">Worker project readiness</p>}
      />,
    );
  };
  it("keeps project notices below worker headings", () => {
    const html = render(run("one"));
    expect(html.indexOf("Worker project readiness")).toBeGreaterThan(html.indexOf("</header>"));
    expect(html.indexOf("Worker project readiness")).toBeLessThan(
      html.indexOf('class="orchestration-chat-body"'),
    );
  });
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
      expect(html).toMatch(/<pre[^>]*>\*\*literal user\*\*<\/pre>/);
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
    expect(html).toContain('class="page-title worker-chat-title"');
    expect(html).toContain('data-icon="app-down-right"');
    expect(html).toContain("Orchestrator worker");
    expect(html).toContain('aria-label="Code60 auto-approval" aria-pressed="true"');
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
  it("uses the generic Subagent breadcrumb independently of its saved role label", () => {
    expect(render(run("one"), [], true, "Test writer")).toMatch(/Subagent<\/span><\/h2>/);
    expect(render(run("one"))).toMatch(/Subagent<\/span><\/h2>/);
  });
  it("keeps deleted-worktree sessions visible but inactive", () => {
    const worker = run("one", "finished");
    worker.record.discardedAt = "2026-01-01";
    const html = render(worker);
    expect(html).toContain("Its worktree was deleted.");
    expect(html).not.toContain("<textarea");
  });
});
