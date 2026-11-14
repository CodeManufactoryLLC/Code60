import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { MemoryDetail } from "../bridge/index.js";
import { MemoryInspector } from "./memory.js";

const ids = {
  memory: "11111111-1111-4111-8111-111111111111",
  conversation: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  source: "44444444-4444-4444-8444-444444444444",
};
const at = "2026-11-13T15:00:00.000Z";
const detail: MemoryDetail = {
  record: {
    id: ids.memory,
    version: 1,
    revision: 2,
    conversationId: ids.conversation,
    projectId: ids.project,
    scope: "project",
    evidence: "user-stated",
    state: "active",
    pinned: false,
    createdAt: at,
    updatedAt: "2026-11-13T16:00:00.000Z",
    eventAt: at,
    provider: "claude",
    promptVersion: 1,
    supersedes: null,
    lastUsedAt: null,
    type: "semantic",
    text: "Use the staging cache.",
    subject: "cache",
    condition: "",
    correction: false,
    citations: [{ sourceId: ids.source, start: 4, end: 21, quote: "the staging cache" }],
  },
  sources: [
    {
      id: ids.source,
      conversationId: ids.conversation,
      role: "human",
      at,
      ordinal: 0,
      start: 0,
      text: "Use the staging cache <b>today</b>.",
    },
  ],
  revisions: [
    { revision: 1, text: "Use the cache.", at },
    { revision: 2, text: "Use the staging cache.", at: "2026-11-13T16:00:00.000Z" },
  ],
  incomplete: false,
};

it("presents readable memory facts, highlighted evidence and history without raw identifiers", () => {
  const html = renderToStaticMarkup(
    <MemoryInspector
      detail={detail}
      busy={false}
      names={{
        projects: [{ id: ids.project, label: "/work/billing-service" }],
        conversations: [{ id: ids.conversation, label: "Cache rollout", remember: true }],
      }}
      onAction={() => {}}
    />,
  );
  for (const label of ["Active", "Semantic", "Project", "User stated"])
    expect(html).toContain(
      `class="memory-tag"${label === "Active" ? ' data-state="active"' : ""}>${label}<`,
    );
  expect(html).toContain(">billing-service<");
  expect(html).toContain('title="/work/billing-service"');
  expect(html).toContain(">Cache rollout<");
  expect(html).toContain(">Never<");
  expect(html).toContain("<mark>the staging cache</mark>");
  expect(html).toContain("&lt;b&gt;today&lt;/b&gt;");
  expect(html).toContain("Revision 2 (current)");
  expect(html).toContain("Source messages (1)");
  expect(html).not.toContain(ids.memory);
  expect(html).not.toContain(ids.source);
  expect(html).not.toContain(at);
  expect(html).not.toContain("prompt v");
  expect(html).toMatch(/<button[^>]*class="primary"[^>]*disabled=""[^>]*>Save changes/);
});

it("labels unknown names instead of showing identifiers", () => {
  const html = renderToStaticMarkup(
    <MemoryInspector detail={detail} busy={false} onAction={() => {}} />,
  );
  expect(html).toContain("Unknown project");
  expect(html).toContain("Unknown conversation");
  expect(html).not.toContain(ids.project);
});

it("marks the cited occurrence rather than the first matching phrase", () => {
  const html = renderToStaticMarkup(
    <MemoryInspector
      detail={{
        ...detail,
        record: {
          ...detail.record,
          citations: [{ sourceId: ids.source, start: 7, end: 12, quote: "cache" }],
        },
        sources: detail.sources.map((source) => ({ ...source, text: "cache, cache" })),
      }}
      busy={false}
      onAction={() => {}}
    />,
  );
  expect(html).toContain('class="memory-source-text">cache, <mark>cache</mark>');
});

it("shows missing evidence and conflict actions without losing useful context", () => {
  const html = renderToStaticMarkup(
    <MemoryInspector
      detail={{
        ...detail,
        incomplete: true,
        sources: [],
        record: {
          ...detail.record,
          state: "disputed",
          pinned: true,
          correction: true,
          condition: "During staging deployments",
        },
      }}
      busy={true}
      onAction={() => {}}
    />,
  );
  expect(html).toContain("Some source messages are unavailable or were forgotten.");
  expect(html).toContain("Source unavailable");
  expect(html).toContain("During staging deployments");
  expect(html).toContain(">Correction<");
  expect(html).toContain(">Pinned<");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Keep and pin this claim/);
  expect(html).not.toContain("Source messages (");
});
