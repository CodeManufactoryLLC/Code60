import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { DesktopApi, PlanSummary, ReviewSummary } from "../bridge/index.js";
import { FilePanel, RevisionList } from "./file-panel.js";
import { emptyFileTabs, updateFileTabs } from "./file-tabs.js";
import type { FileBrowser } from "./files.js";

const review = (id: string, title: string, chatId: string | null): ReviewSummary => ({
  id,
  version: 1,
  project: "/project",
  title,
  originChatId: chatId,
  chatId,
  turn: 1,
  workers: [],
  revisions: [
    { id: `${id}-one`, at: "2026-11-07T00:00:00Z" },
    { id: `${id}-two`, at: "2026-11-08T00:00:00Z" },
  ],
  submissions: [],
});

it("offers View Plan only for the displayed session, including saved plans and other selected tabs", () => {
  const plan: PlanSummary = {
    id: "saved-plan",
    chatId: "current-chat",
    project: "/project",
    title: "Saved plan",
    revision: 3,
    proposalRevision: 1,
    state: "completed",
    completed: 1,
    total: 1,
  };
  const render = (
    plans: PlanSummary[],
    currentChat: string | undefined,
    kind: "changes" | "blank" = "blank",
    disabled = false,
  ) =>
    renderToStaticMarkup(
      <FilePanel
        tabs={updateFileTabs(emptyFileTabs(), { type: kind })}
        onAction={() => {}}
        browser={{} as FileBrowser}
        open
        active
        disabled={disabled}
        plans={plans}
        currentChat={currentChat}
        onOpenProject={() => {}}
        onToggle={() => {}}
      />,
    );
  for (const state of ["draft", "running", "completed", "paused", "dismissed"] as const) {
    for (const kind of ["blank", "changes"] as const)
      expect(render([{ ...plan, state }], "current-chat", kind)).toContain(">View Plan</button>");
  }
  expect(render([], "current-chat")).not.toContain("View Plan");
  expect(render([plan], "other-chat")).not.toContain("View Plan");
  expect(render([plan], undefined)).not.toContain("View Plan");
  expect(render([plan], "current-chat", "blank", true)).not.toContain("View Plan");
});

it("offers recall beside Files without opening it automatically and never mounts hidden recall content", () => {
  const memoryDetail = vi.fn();
  const api = { memoryDetail } as unknown as DesktopApi;
  const render = (kind: "recall" | "blank", active: boolean, open: boolean) =>
    renderToStaticMarkup(
      <FilePanel
        tabs={updateFileTabs(emptyFileTabs(), { type: kind })}
        onAction={() => {}}
        browser={{} as FileBrowser}
        open={open}
        active={active}
        onOpenProject={() => {}}
        onToggle={() => {}}
        api={api}
        recallSource={{ owner: "owner", runId: "run", events: [] }}
      />,
    );
  const blank = render("blank", true, true);
  expect(blank).toContain("Open Files");
  expect(blank).toContain("Open Memory Recall");
  expect(blank).not.toContain('class="memory-recall"');
  for (const [active, open] of [
    [false, true],
    [true, false],
    [false, false],
  ] as const)
    expect(render("recall", active, open)).not.toContain('class="memory-recall"');
  expect(render("recall", true, true)).toContain('class="memory-recall"');
  expect(memoryDetail).not.toHaveBeenCalled();
});

it.each(["empty", "blank"])("groups %s tab choices in one centered action list", (state) => {
  const empty = emptyFileTabs();
  const html = renderToStaticMarkup(
    <FilePanel
      tabs={state === "blank" ? updateFileTabs(empty, { type: "blank" }) : empty}
      onAction={() => {}}
      browser={{} as FileBrowser}
      open
      active
      onOpenProject={() => {}}
      onToggle={() => {}}
      emptyContent={<button type="button">Open Changes</button>}
    />,
  );
  const actions = html.match(/class="file-panel-empty-actions">(.*?)<\/div>/)?.[1] ?? "";
  expect(actions).toContain(">Open Changes</button>");
  expect(actions).toContain(">Open Files</button>");
  expect(actions).toContain(">Open Memory Recall</button>");
  expect(actions.match(/<button/g)).toHaveLength(3);
  expect(html.match(/class="file-panel-empty"/g)).toHaveLength(1);
});

it("nests all revisions under their task without a review dropdown or diff", () => {
  const html = renderToStaticMarkup(
    <RevisionList
      reviews={[
        review("current", "Current task", "chat"),
        review("saved", "Saved task", "old-chat"),
      ]}
      onOpen={() => {}}
    />,
  );
  expect(html).toContain('aria-label="Task revisions"');
  expect(html).toMatch(
    /<section aria-label="Current task"><h3 class="revision-task"[^>]*>.*Current task.*<\/h3><ul>/,
  );
  expect(html).toMatch(
    /<section aria-label="Saved task"><h3 class="revision-task"[^>]*>.*Saved task.*<\/h3><ul>/,
  );
  expect(html.match(/revision-latest/g)).toHaveLength(2);
  expect(html.match(/data-open/g)).toBeNull();
  expect(html.match(/<button/g)).toHaveLength(4);
  expect(html.match(/Revision 1/g)).toHaveLength(2);
  expect(html.match(/Revision 2/g)).toHaveLength(2);
  expect(html).toContain('d="M28.5,32a3.4762');
  expect(html).toContain('d="M29,30h-8v-2h8v2');
  expect(html).not.toMatch(/<select|review-panel|monaco/);
});
