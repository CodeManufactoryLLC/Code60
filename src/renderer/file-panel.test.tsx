import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { ReviewSummary } from "../bridge/index.js";
import { RevisionList } from "./file-panel.js";

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
