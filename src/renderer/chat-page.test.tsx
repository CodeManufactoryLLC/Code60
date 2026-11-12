import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DesktopApi, DesktopRun, OrchestrationChat, ReviewSummary } from "../bridge/index.js";
import type { RunEvent, RunStatus, RunView } from "../core/index.js";
import { ChatPage } from "./chat-page.js";
import { MessageCopy } from "./message-controls.js";

const run = (id: string, status: RunStatus): RunView => ({
  id,
  agent: "fake",
  branch: null,
  worktree: "/project",
  status,
  turns: 1,
  pending: [],
  stopping: false,
});
const worker = (id: string, status: RunStatus): DesktopRun =>
  ({ record: { id }, view: run(id, status) }) as DesktopRun;
function render(
  status: RunStatus,
  workers: string[],
  runs: DesktopRun[],
  events: RunEvent[] = [],
  reviews: ReviewSummary[] = [],
  database: string | null = "/db",
  turns = 1,
  runChanges: Partial<RunView> = {},
) {
  return renderToStaticMarkup(
    <ChatPage
      api={{} as DesktopApi}
      chat={
        {
          run: { ...run("orchestrator", status), turns, ...runChanges },
          activity: {
            state:
              status === "waiting"
                ? "waiting_for_approval"
                : status === "running"
                  ? "working"
                  : runs.some(
                        (worker) =>
                          workers.includes(worker.record.id) &&
                          ["queued", "running", "waiting"].includes(worker.view?.status ?? "idle"),
                      )
                    ? "waiting_for_workers"
                    : "idle",
            label: "",
            source: "host",
            declaration: null,
            otherOperations: 0,
            workerCount: workers.length,
            active: status === "running",
            urgent: status === "waiting",
          },
          workers,
          updates: { paused: true, pending: 1 },
        } as OrchestrationChat
      }
      events={events}
      database={database}
      active
      onDatabase={() => {}}
      runs={runs}
      reviews={reviews}
    />,
  );
}

describe("orchestration activity presentation", () => {
  it("does not duplicate plan tabs with chat-header plan buttons", () => {
    const html = renderToStaticMarkup(
      <ChatPage
        api={{} as DesktopApi}
        chat={{
          run: run("orchestrator", "idle"),
          directory: "/project",
          error: null,
          events: [],
          plans: [
            {
              id: "00000000-0000-4000-8000-000000000001",
              chatId: "orchestrator",
              project: "/project",
              revision: 1,
              proposalRevision: 1,
              title: "A new plan",
              state: "draft",
              completed: 0,
              total: 1,
            },
          ],
          workers: [],
          updates: { paused: false, pending: 0 },
        }}
        events={[]}
        database="/db"
        active
        onDatabase={() => {}}
        runs={[]}
      />,
    );
    expect(html).not.toContain('class="chat-plans"');
    expect(html).not.toContain('aria-label="Plans"');
    expect(html).not.toContain("Plan · A new plan");
    expect(html).toContain('class="orchestration-chat-heading"');
  });

  it("centers connection artwork and hides the empty prompt until the session is ready", () => {
    for (const status of ["queued", "running"] as const) {
      const html = render(status, [], [], [], [], "/db", 0);
      expect(html).toContain('class="chat-connection-frame"');
      expect(html).toContain('class="chat-connecting" role="status"');
      expect(html).toContain("communicating.gif");
      expect(html).toContain(">Connecting...</span>");
      expect(html).not.toContain("Give Code60 a task.");
      expect(html).not.toContain('class="chat-progress activity-display"');
      expect(html).not.toContain('class="activity-timer"');
    }
    const ready = render("idle", [], [], [], [], "/db", 0);
    expect(ready).toContain("Give Code60 a task.");
    expect(ready).not.toContain('class="chat-connecting"');
    expect(render("idle", [], [], [], [], "/db", 0, { modeChanging: true })).toContain(
      "Give Code60 a task.",
    );
  });

  it("does not flash the empty prompt before a connected chat snapshot arrives", () => {
    const html = renderToStaticMarkup(
      <ChatPage
        api={{} as DesktopApi}
        chat={undefined}
        events={[]}
        database="/db"
        active
        onDatabase={() => {}}
        runs={[]}
      />,
    );
    expect(html).not.toContain("Give Code60 a task.");
  });

  it("renders only agent replies as Markdown, including adjacent streamed chunks", () => {
    const events: RunEvent[] = [
      {
        runId: "orchestrator",
        at: "2026-01-01",
        type: "prompt",
        turn: 1,
        text: "**literal user**",
      },
      { runId: "orchestrator", at: "2026-01-01", type: "message", text: "## Result\n\n**Bo" },
      { runId: "orchestrator", at: "2026-01-01", type: "message", text: "ld** and `code`" },
    ];
    const html = render("idle", [], [], events);
    expect(html).toContain("<h2>Result</h2>");
    expect(html).toContain("<strong>Bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<pre>**literal user**</pre>");
    expect(html.match(/aria-label="Copy message"/g)).toHaveLength(2);
    expect(events[1]).toMatchObject({ text: "## Result\n\n**Bo" });
  });
  it("disables chat controls without a database even when a run is still reported", () => {
    for (const status of ["idle", "running"] as const) {
      const html = render(status, [], [], [], [], null);
      expect(html.match(/<textarea[^>]*>/)?.[0]).toContain("disabled");
      expect(html.match(/<button[^>]*class="chat-title"[^>]*>/)?.[0]).toContain("disabled");
      const action = html.match(/<button[^>]*class="[^"]*composer-send"[^>]*>/)?.[0];
      expect(action).toContain("disabled");
      expect(html).toContain("Connect to database");
    }
  });
  it("labels only identified MCP tools in historical activity", () => {
    const tool = {
      runId: "orchestrator",
      at: "2026-01-01",
      type: "toolCall" as const,
      toolCallId: "t1",
      title: "Docs",
      kind: "fetch" as const,
      status: "completed",
    };
    const html = render(
      "idle",
      [],
      [],
      [
        { ...tool, mcp: { server: "context7" } },
        { ...tool, toolCallId: "t2", mcp: {} },
        { ...tool, toolCallId: "t3", title: "MCP playwright" },
      ],
    );
    expect(html.match(/class="mcp-badge"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="MCP server: context7"');
    expect(html).toContain('aria-label="MCP server: Unknown"');
    expect(html).not.toContain('aria-label="MCP server: playwright"');
  });
  it("uses the activity indicator during a turn and retains completed turn timing", () => {
    const events: RunEvent[] = [
      {
        type: "prompt",
        runId: "orchestrator",
        turn: 1,
        at: "2026-11-08T12:00:00.000Z",
        text: "Check the changes",
      },
    ];
    const active = render("running", [], [], events);
    expect(active).toContain('data-activity="working"');
    expect(active).toContain('class="activity-timer"');
    expect(active).not.toContain('class="turn-timer"');
    expect(active).not.toContain("Working for");
    expect(active).not.toContain('class="turn-separator"');
    const completed = render(
      "idle",
      [],
      [],
      [
        ...events,
        {
          type: "turnEnd",
          runId: "orchestrator",
          turn: 1,
          at: "2026-11-08T12:00:12.000Z",
          stopReason: "end_turn",
        },
      ],
    );
    expect(completed).toContain("Worked for 12s (finished)");
    expect(completed).toContain('<hr class="turn-separator"/>');
    expect(completed).not.toContain('class="activity-timer"');
  });
  it("uses the status as the live disclosure and timing as the historical disclosure", () => {
    const events: RunEvent[] = [
      {
        type: "prompt",
        runId: "orchestrator",
        turn: 1,
        at: "2026-11-08T12:00:00Z",
        text: "Inspect",
      },
      {
        type: "thought",
        runId: "orchestrator",
        at: "2026-11-08T12:00:01Z",
        text: "Checking evidence",
      },
    ];
    const active = render("running", [], [], events);
    expect(active).not.toContain('class="chat-activity"');
    expect(active).toContain('class="chat-progress activity-display" aria-expanded="false"');
    expect(active).toContain("aria-controls=");
    expect(active).toContain('class="activity-details"');
    expect(active).toContain('data-expanded="false" aria-hidden="true" inert=""');
    expect(active).toContain("Checking evidence");
    const completed = render(
      "idle",
      [],
      [],
      [
        ...events,
        {
          type: "turnEnd",
          runId: "orchestrator",
          turn: 1,
          at: "2026-11-08T12:00:12Z",
          stopReason: "end_turn",
        },
      ],
    );
    expect(completed).toContain('class="turn-timer activity-history-toggle"');
    expect(completed).toMatch(/Worked for 12s \(finished\)<\/button><hr class="turn-separator"/);
    expect(completed).toContain("Checking evidence");
    expect(completed).not.toContain('class="chat-progress activity-display"');
  });
  it("does not attach a reconnected review to coincident turn numbers in another chat", () => {
    const review: ReviewSummary = {
      id: "review",
      version: 1,
      project: "/project",
      title: "Saved task",
      originChatId: "old-chat",
      chatId: "orchestrator",
      turn: 1,
      workers: [{ runId: "worker", label: "Worker" }],
      revisions: [],
      submissions: [
        {
          id: "batch",
          revisionId: "revision",
          commentIds: ["comment"],
          state: "delivered",
          deliveredChatId: "old-chat",
          deliveredTurn: 1,
        },
      ],
    };
    const events: RunEvent[] = [
      {
        runId: "orchestrator",
        at: "2026-11-07",
        type: "prompt",
        turn: 1,
        text: "Unrelated new request",
      },
    ];
    const html = render("idle", [], [], events, [review]);
    expect(html).toContain("<pre>Unrelated new request</pre>");
    expect(html).not.toContain('aria-label="Your review feedback"');
    const batch = review.submissions[0];
    if (!batch) throw new Error("Missing batch");
    batch.deliveredChatId = "orchestrator";
    const delivered = render("idle", [], [], events, [review]);
    expect(delivered).toContain('aria-label="Your review feedback"');
    expect(delivered).toContain("View submitted feedback");
    expect(delivered).not.toContain('class="chat-reviews"');
  });
  it("shows concurrent owned workers while updates are paused without changing own controls", () => {
    const html = render(
      "idle",
      ["one", "two"],
      [worker("one", "running"), worker("two", "waiting"), worker("unrelated", "running")],
    );
    expect(html).not.toContain('class="chat-loader"');
    expect(html).toContain("2 subagents: waiting for approval");
    expect(html).toContain("Automatic worker updates are paused");
    expect(html).not.toContain(">Stop<");
    expect(html).toMatch(/<textarea(?![^>]*disabled)[^>]*>/);
  });
  it("removes delegated activity after failure, cancellation or idle, and isolates selection", () => {
    const runs = [worker("one", "failed"), worker("two", "cancelled"), worker("three", "idle")];
    expect(render("idle", ["one", "two", "three"], runs)).not.toContain('class="chat-loader"');
    expect(render("idle", [], [worker("other-chat", "running")])).not.toContain(
      'class="chat-loader"',
    );
  });
  it("keeps the own approval wait active with its own Stop action", () => {
    const html = render("waiting", [], []);
    expect(html).not.toContain('class="chat-loader"');
    expect(html).toContain("Waiting for approval");
    expect(html).toContain("Stop</button>");
  });
  it("does not offer text Copy for empty or attachment-only source", () => {
    expect(renderToStaticMarkup(<MessageCopy text="" />)).toBe("");
  });
  it("uses an accessible icon-only Copy control for nonempty source", () => {
    const html = renderToStaticMarkup(<MessageCopy text="exact source" />);
    expect(html).toContain('aria-label="Copy message"');
    expect(html).toContain("<svg");
    expect(html).not.toContain(">Copy<");
    expect(html).not.toContain("exact source");
  });
  it("places a relative timestamp immediately before Copy without live clock announcements", () => {
    const at = new Date(Date.now() - 180000).toISOString();
    const html = renderToStaticMarkup(<MessageCopy text="exact source" at={at} />);
    expect(html).toMatch(/<time[^>]*datetime="[^"]+"[^>]*aria-live="off"[^>]*>3m ago<\/time>/i);
    expect(html.indexOf("<time")).toBeLessThan(html.indexOf("<button"));
    expect(html).toContain('class="message-copy-glyph"');
    expect(html).not.toContain("data-clicked");
  });
  it("keeps missing or invalid message times explicit instead of inventing a receipt time", () => {
    for (const at of [undefined, "invalid timestamp"]) {
      const html = renderToStaticMarkup(<MessageCopy text="source" at={at} visible={false} />);
      expect(html).toContain("Time unavailable");
      expect(html).not.toMatch(/datetime=/i);
      expect(html).not.toContain("NaN");
    }
  });
  it("retains original prompt and first-chunk timestamps across streaming and replay", () => {
    const events = [
      { at: "2026-01-01T00:00:00Z", type: "prompt", turn: 1, text: "user source" },
      { at: "2026-01-01T00:00:01Z", type: "message", text: "first" },
      { at: "2026-01-01T00:00:30Z", type: "message", text: " later" },
    ].map((event) => ({ runId: "orchestrator", ...event })) as RunEvent[];
    for (const source of [events, structuredClone(events)]) {
      const html = render("idle", [], [], source).toLowerCase();
      expect(html).toContain('datetime="2026-01-01t00:00:00.000z"');
      expect(html).toContain('datetime="2026-01-01t00:00:01.000z"');
      expect(html).not.toContain('datetime="2026-01-01t00:00:30.000z"');
    }
  });
  it("keeps Copy outside user text and automatic prompts distinct from user bubbles", () => {
    const event = (body: object) =>
      ({ runId: "orchestrator", at: "2026-01-01", ...body }) as RunEvent;
    const html = render(
      "idle",
      [],
      [],
      [
        event({ type: "prompt", turn: 1, text: "user source" }),
        event({ type: "message", text: "assistant source" }),
        event({ type: "prompt", turn: 2, text: "worker update", origin: "automatic" }),
      ],
    );
    expect(html).toMatch(/<pre>user source<\/pre><div class="message-copy">/);
    expect(html).toMatch(
      /<div class="chat-markdown"><p>assistant source<\/p><\/div><div class="message-copy">/,
    );
    expect(html).toContain('class="event prompt automatic"');
    expect(html.match(/aria-label="Copy message"/g)).toHaveLength(2);
  });
  it("places provider metadata inside the main composer", () => {
    const html = render("idle", [], []);
    expect(html).toContain('aria-label="Current provider: fake"');
    expect(html).toContain('class="composer-footer session-info"');
    expect(html).not.toContain('class="chat-provider"');
    expect(html.slice(0, html.indexOf("</header>"))).not.toContain("fake");
  });
});
