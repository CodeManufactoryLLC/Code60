import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesktopApi, Review, ReviewContent } from "../bridge/index.js";
import { ReviewPanel } from "./review-panel.js";

const read = vi.hoisted(() => vi.fn());
vi.mock("./review-content.js", () => ({ useReviewFile: read }));
beforeEach(() => read.mockReturnValue({ retry: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

const file = {
  key: "worker:same.ts",
  runId: "worker",
  path: "same.ts",
  oldPath: "same.ts",
  status: "modified" as const,
  fingerprint: "fingerprint",
};
const revision = {
  id: "revision",
  at: "2026-11-07T00:00:00Z",
  files: [file],
  errors: [],
};
function render(overrides: Partial<Review> = {}, stored: Record<string, string> = {}) {
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => stored[key] ?? null });
  const review: Review = {
    format: 1,
    version: 0,
    id: "review",
    project: "/project",
    title: "Private task title",
    originChatId: "chat",
    chatId: "chat",
    turn: 1,
    workers: [{ runId: "worker", label: "Worker" }],
    revisions: [revision],
    comments: [],
    submissions: [],
    reviewed: {},
    ...overrides,
  };
  const api = {
    reviewAction: vi.fn(),
    taskAction: vi.fn(),
    captureReview: vi.fn(),
  };
  const html = renderToStaticMarkup(
    <ReviewPanel
      api={api as unknown as DesktopApi}
      review={review}
      project="/project"
      revisionId={revision.id}
    />,
  );
  expect(api.reviewAction).not.toHaveBeenCalled();
  expect(api.taskAction).not.toHaveBeenCalled();
  expect(api.captureReview).not.toHaveBeenCalled();
  return html;
}

it("renders only the pinned diff browser without selectors, review actions or task metadata", () => {
  const html = render({
    reviewed: { [file.key]: file.fingerprint },
    comments: [{ id: "comment", text: "Saved feedback", revisionId: revision.id, state: "draft" }],
  });
  expect(html).toContain('aria-label="Revision diff"');
  expect(html).toContain('aria-label="Changed files"');
  expect(html).toContain("<span>same.ts</span>");
  expect(html).not.toContain("<select");
  expect(html).not.toMatch(/<textarea|<form|<input|<h[123]|<output/);
  for (const removed of [
    "Private task title",
    "Hide Reviewed",
    "Refresh changes",
    "Expand review",
    "Applied",
    "Use these changes",
    "Undo application",
    "All workers",
    "Compare",
    "No changes.",
    "Feedback",
    "Saved feedback",
    "Mark file reviewed",
    "Reconnect",
    "Open file",
  ])
    expect(html).not.toContain(removed);
});

it("keeps reviewed and same-path worker files available without filtering", () => {
  const other = { ...file, key: "other:same.ts", runId: "other" };
  const html = render({
    workers: [
      { runId: "worker", label: "First" },
      { runId: "other", label: "Second" },
    ],
    revisions: [{ ...revision, files: [file, other] }],
    reviewed: { [file.key]: file.fingerprint, [other.key]: other.fingerprint },
  });
  expect(html.match(/<span>same.ts<\/span>/g)).toHaveLength(2);
  expect(html).toContain("First · modified");
  expect(html).toContain("Second · modified");
});

it("reads the pinned revision and file even when legacy compare and hide state exists", () => {
  const other = { ...file, key: "worker:other.ts", path: "other.ts" };
  const html = render(
    {
      revisions: [
        { ...revision, files: [file, other] },
        { ...revision, id: "latest", files: [] },
      ],
    },
    {
      "code60.review:/project:review:revision": "latest",
      "code60.review:/project:review:revision:file": other.key,
      "code60.review:/project:review:compare": "feedback",
    },
  );
  expect(html).not.toContain("<select");
  expect(read).toHaveBeenLastCalledWith(expect.anything(), "/project", {
    reviewId: "review",
    revisionId: revision.id,
    fileKey: other.key,
    label: "Worker",
  });
});

it("leaves empty revisions blank and never substitutes a different revision", () => {
  const html = render({ revisions: [{ ...revision, files: [] }] });
  expect(html).not.toContain("<select");
  expect(html).not.toContain("No changes");
  expect(html).not.toContain('aria-label="Changed files"');
  const missing = render({ revisions: [{ ...revision, id: "latest" }] });
  expect(missing).toContain("Revision unavailable.");
  expect(missing).not.toContain('aria-label="Changed files"');
  expect(read).toHaveBeenLastCalledWith(expect.anything(), "/project", undefined);
});

it("qualifies file reads and remembered selection by the project instance", () => {
  const projectId = crypto.randomUUID();
  const other = { ...file, key: "worker:other.ts", path: "other.ts" };
  render(
    { projectId, databaseEpoch: 7, revisions: [{ ...revision, files: [file, other] }] },
    { "code60.review:/project:review:revision:file": other.key },
  );
  expect(read).toHaveBeenLastCalledWith(expect.anything(), "/project", {
    reviewId: "review",
    revisionId: revision.id,
    fileKey: file.key,
    label: "Worker",
    projectId,
    databaseEpoch: 7,
  });
});

it("reports saved capture failures without mutation or capture retry controls", () => {
  const html = render({
    error: "Capture failed",
    revisions: [
      {
        ...revision,
        files: [],
        errors: [{ runId: "worker", message: "Worktree missing" }],
      },
    ],
  });
  expect(html).toContain("Capture failed");
  expect(html).toContain("Diff unavailable: Worktree missing");
  expect(html).not.toContain("<button");
  expect(html).not.toContain("No changes");
});

it("shows file read errors and binary limitations without offering mutation actions", () => {
  read.mockReturnValue({ error: "Read failed", retry: vi.fn() });
  expect(render()).toContain("Retry file");
  read.mockReturnValue({
    content: {
      file: { ...file, limitation: "Binary content" },
      original: "",
      modified: "",
    } satisfies ReviewContent,
    retry: vi.fn(),
  });
  expect(render()).toContain("Binary content");
});
