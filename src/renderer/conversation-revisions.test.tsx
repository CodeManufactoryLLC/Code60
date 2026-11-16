import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { DesktopApi, DesktopRun, OrchestrationChat, ReviewSummary } from "../bridge/index.js";
import { revisionCards, revisionSlot, useConversationRevisions } from "./conversation-revisions.js";

const summary: ReviewSummary = {
  id: "review",
  version: 1,
  project: "/target",
  projectId: "runtime",
  databaseEpoch: 2,
  chatId: "chat",
  originChatId: "chat",
  turn: 1,
  title: "Change login",
  workers: [{ runId: "worker", label: "Login worker" }],
  revisions: [
    { id: "one", at: "2026-11-15T01:00:00Z", fileCount: 1 },
    { id: "two", at: "2026-11-15T01:05:00Z", fileCount: 2, incomplete: true },
  ],
  submissions: [],
};

it("orders immutable captures chronologically while keeping review-local numbering", () => {
  const other = {
    ...summary,
    id: "other",
    revisions: [{ id: "three", at: "2026-11-15T01:02:00Z" }],
  };
  expect(
    revisionCards([{ summary: other }, { summary }]).map(({ key, number }) => [key, number]),
  ).toEqual([
    ["review:one", 1],
    ["other:three", 1],
    ["review:two", 2],
  ]);
});
it("places cards between messages by capture time only for their actual originating chat", () => {
  const times = ["2026-11-15T01:00:00Z", undefined, "2026-11-15T01:06:00Z"];
  expect(revisionSlot(summary.revisions[1]?.at ?? "", "chat", "chat", times)).toBe(2);
  expect(revisionSlot(summary.revisions[1]?.at ?? "", "old-chat", "chat", times)).toBe(3);
  expect(revisionSlot("invalid", "chat", "chat", times)).toBe(3);
  expect(revisionSlot("2026-11-15T02:00:00Z", "chat", "chat", times)).toBe(3);
});
it("deduplicates repeated summaries and revision IDs without merging distinct captures", () => {
  const repeated = { ...summary, revisions: [...summary.revisions, ...summary.revisions] };
  expect(
    revisionCards([{ summary }, { summary: repeated }]).map(({ key, number }) => [key, number]),
  ).toEqual([
    ["review:one", 1],
    ["review:two", 2],
  ]);
  expect(render([summary, summary]).match(/class="conversation-changes"/g)).toHaveLength(1);
});
function Harness({
  api,
  reviews,
  restored,
  chat,
  runs,
}: {
  api: DesktopApi;
  reviews: ReviewSummary[];
  restored: boolean;
  chat?: OrchestrationChat;
  runs?: DesktopRun[];
}) {
  const result = useConversationRevisions({
    api,
    chat: chat ?? ({ kind: "project", run: { id: "chat" }, restored } as OrchestrationChat),
    reviews,
    runs: runs ?? [],
    active: true,
    onPreview: vi.fn(),
  });
  return (
    <>
      {result.cards.map(({ content }) => content)}
      {result.footer}
    </>
  );
}
function render(reviews: ReviewSummary[], restored = false) {
  const api = { readReview: vi.fn(), taskAction: vi.fn(), relayReview: vi.fn() };
  const html = renderToStaticMarkup(
    <Harness api={api as unknown as DesktopApi} reviews={reviews} restored={restored} />,
  );
  expect(api.readReview).not.toHaveBeenCalled();
  expect(api.taskAction).not.toHaveBeenCalled();
  expect(api.relayReview).not.toHaveBeenCalled();
  return html;
}
it("renders one quiet latest change link with partial evidence and no feedback or Apply workflow", () => {
  const html = render([summary]);
  expect(html).toContain("2 files changed");
  expect(html.match(/conversation-changes-link/g)).toHaveLength(1);
  expect(html).not.toContain("Revision 1");
  expect(html).not.toContain("Preview application");
  expect(html).not.toContain("Give feedback");
  expect(html).not.toContain("<textarea");
  expect(html).toContain("Partial capture");
  expect(html).not.toContain("monaco");
  expect(html).not.toContain("Apply changes…");
});
it("does not attach another chat's changes and keeps saved snapshots read-only", () => {
  expect(render([{ ...summary, chatId: "other" }])).not.toContain("files changed");
  const html = render([summary], true);
  expect(html).toContain("2 files changed");
  expect(html).not.toContain("Give feedback");
  expect(html).not.toContain("Apply");
});
it("does not create a card for every capture and bounds the visible request links", () => {
  const revisions = Array.from({ length: 100 }, (_, i) => ({
    id: `revision-${i}`,
    at: new Date(1_000_000 + i * 1_000).toISOString(),
    fileCount: 2,
  }));
  const html = render([{ ...summary, revisions }]);
  expect(html.match(/class="conversation-changes"/g)).toHaveLength(1);
  const many = render(
    revisions.map((revision, i) => ({
      ...summary,
      id: `request-${i}`,
      turn: i + 1,
      revisions: [revision],
    })),
  );
  expect(many.match(/class="conversation-changes"/g)).toHaveLength(30);
});
it("surfaces failed and waiting captures without claiming worker success", () => {
  const html = render([{ ...summary, revisions: [], error: "Capture failed" }]);
  expect(html).toContain("Capture failed");
  expect(html).toContain("Retry changes");
  expect(html).not.toContain("finished");
  expect(render([{ ...summary, revisions: [] }])).toBe("");
  const failed = render([
    {
      ...summary,
      revisions: [
        {
          id: "empty",
          at: "2026-11-15T01:05:00Z",
          fileCount: 0,
          outcomes: [{ runId: "worker", status: "failed" }],
        },
      ],
    },
  ]);
  expect(failed).toContain("Login worker: Failed");
  expect(failed).not.toContain("conversation-changes");
});
it("labels direct Relay work without offering isolated revision/application actions", () => {
  const api = { relayReview: vi.fn() };
  const html = renderToStaticMarkup(
    <Harness
      api={api as unknown as DesktopApi}
      reviews={[]}
      restored={false}
      chat={
        { kind: "relay", conversationId: "relay", generation: 1, run: null } as OrchestrationChat
      }
      runs={[
        {
          record: { id: "direct", status: "failed" },
          relay: {
            conversationId: "relay",
            generation: 1,
            workspaceMode: "direct",
            cwd: "/direct",
          },
        } as DesktopRun,
      ]}
    />,
  );
  expect(html).toContain("Direct edits");
  expect(html).toContain("/direct");
  expect(html).toContain("Failed");
  expect(html).not.toContain("Not isolated or reversible");
  expect(html).not.toContain("Preview application");
  expect(html).not.toContain("Undo application");
  expect(api.relayReview).not.toHaveBeenCalled();
});
it("shows later capture failures and freezes failed/cancelled outcomes on their captured revisions", () => {
  const [first, second] = summary.revisions;
  if (!first || !second) throw new Error("Missing fixture revisions");
  const html = render([
    {
      ...summary,
      error: "Later capture failed",
      revisions: [
        { ...first, outcomes: [{ runId: "worker", status: "failed" }] },
        { ...second, outcomes: [{ runId: "worker", status: "cancelled" }] },
      ],
    },
  ]);
  expect(html).toContain("2 files changed");
  expect(html).not.toContain("Login worker: Failed");
  expect(html).toContain("Login worker: Cancelled");
  expect(html).toContain("Later capture failed");
  expect(render([summary])).not.toContain("success");
});
it("groups multiple worker targets into one changes link for the same human request", () => {
  const html = render([summary, { ...summary, id: "second-target" }]);
  expect(html.match(/class="conversation-changes"/g)).toHaveLength(1);
  expect(html).toContain("4 files changed");
});
it("groups older workers with current-request captures using the host's checkpoint association", () => {
  const request = { chatId: "chat", turn: 2 };
  const revisions = summary.revisions.map((revision) => ({ ...revision, request }));
  const html = render([
    { ...summary, turn: 1, revisions },
    { ...summary, id: "current-target", turn: 2, revisions },
  ]);
  expect(html.match(/class="conversation-changes"/g)).toHaveLength(1);
  expect(html).toContain("4 files changed");
});
it("retains each request's link when an older worker captures again after a new request", () => {
  const [first, second] = summary.revisions;
  if (!first || !second) throw new Error("Missing revisions");
  const html = render([
    {
      ...summary,
      revisions: [
        { ...first, request: { chatId: "chat", turn: 1 } },
        { ...second, request: { chatId: "chat", turn: 2 } },
        {
          ...second,
          id: "third",
          at: "2026-11-15T01:06:00Z",
          fileCount: 3,
          request: { chatId: "chat", turn: 2 },
        },
      ],
    },
  ]);
  expect(html.match(/class="conversation-changes"/g)).toHaveLength(2);
  expect(html).toContain("1 file changed");
  expect(html).toContain("3 files changed");
  expect(html).not.toContain("2 files changed");
});
