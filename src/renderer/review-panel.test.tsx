import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { DesktopApi, Review } from "../bridge/index.js";
import { ReviewPanel } from "./review-panel.js";

afterEach(() => vi.unstubAllGlobals());
const revision = { id: "revision", at: "2026-11-07T00:00:00Z", files: [], errors: [] };
function render(overrides: Partial<Review>, unisolated: string[] = []) {
  vi.stubGlobal("sessionStorage", { getItem: () => null });
  const review: Review = {
    format: 1,
    version: 0,
    id: "review",
    project: "/project",
    title: "Task",
    originChatId: "chat",
    chatId: "chat",
    turn: 1,
    workers: [],
    revisions: [],
    comments: [],
    submissions: [],
    reviewed: {},
    ...overrides,
  };
  return renderToStaticMarkup(
    <ReviewPanel
      api={{} as DesktopApi}
      review={review}
      project="/project"
      currentChat="chat"
      chatIds={["chat"]}
      onOpenFile={() => {}}
      unisolated={unisolated}
      onBrowseProject={() => {}}
      onSetupGit={() => {}}
    />,
  );
}
it("shows No changes only for a successful empty capture", () => {
  expect(render({})).not.toContain("No changes.");
  expect(render({ revisions: [revision] })).toContain("No changes.");
  const initialFailure = render({ error: "Git failed" });
  expect(initialFailure).toContain("Git failed");
  expect(initialFailure).not.toContain("No changes.");
  const refreshFailure = render({ revisions: [revision], error: "Git failed" });
  expect(refreshFailure).toContain("Retry capture");
  expect(refreshFailure).not.toContain("No changes.");
  const partial = render({
    revisions: [{ ...revision, errors: [{ runId: "worker", message: "Worktree missing" }] }],
  });
  expect(partial).toContain("Review unavailable");
  expect(partial).not.toContain("No changes.");
});
it("renders feedback as text and keeps saved disconnected reviews read-only until reconnected", () => {
  const html = render({
    chatId: "previous-chat",
    comments: [
      { id: "comment", text: "<script>unsafe</script>", revisionId: "revision", state: "draft" },
    ],
    revisions: [revision],
  });
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("conversation disconnected");
  expect(html).toContain("Reconnect to this chat");
  expect(html).toMatch(/disabled=""[^>]*>Send feedback/);
});

it("explains permanent missing baselines without offering capture retry or claiming no changes", () => {
  const html = render(
    {
      workers: [{ runId: "legacy", label: "Legacy worker" }],
      error: "Legacy capture failed",
      revisions: [revision],
    },
    ["legacy"],
  );
  expect(html).toContain("No baseline was captured for this run");
  expect(html).toContain("Browse project files");
  expect(html).toContain("Set up Git");
  expect(html).not.toContain("Retry capture");
  expect(html).not.toContain("No changes.");
});
