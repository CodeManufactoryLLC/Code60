import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { DesktopApi, MemoryDetail } from "../bridge/index.js";
import { MemoryRecall, RecallGroup, RecallMemory } from "./memory-recall.js";

const at = "2026-11-15T12:00:00.000Z";
const record = {
  id: "id",
  type: "lesson",
  scope: "project",
  condition: "<b>when testing</b>",
  text: "<script>memory</script>\nexact text",
  updatedAt: "2026-11-15T12:01:00.000Z",
  citations: [{ sourceId: "source", quote: "<img src=x onerror=bad>", start: 0, end: 1 }],
} as MemoryDetail["record"];
it("omits introductory and source-history messages while retaining recorded turns", () => {
  for (const turn of [1, 3]) {
    const html = renderToStaticMarkup(
      <MemoryRecall
        api={{} as DesktopApi}
        source={{
          owner: "owner",
          runId: "run",
          events: [{ type: "prompt", runId: "run", at, turn, text: "task" }],
        }}
      />,
    );
    expect(html).not.toContain("Current saved records, not historical snapshots.");
    expect(html).not.toContain("Edit or forget in Data Viewer");
    expect(html).not.toContain("Source history may be missing or truncated.");
    expect(html).not.toContain("Only recorded recall turns are shown.");
    expect(html).toContain(`Turn ${turn}`);
    expect(html).toContain("Current turn");
    expect(html).toContain("No memories recalled for this turn.");
  }
});
it("renders current saved records, conditions and expandable evidence as safe read-only text", () => {
  const html = renderToStaticMarkup(
    <RecallMemory at={at} value={{ detail: { record, incomplete: true } }} />,
  );
  expect(html).toContain("Changed since recall");
  expect(html).toContain("&lt;script&gt;memory&lt;/script&gt;");
  expect(html).toContain("&lt;b&gt;when testing&lt;/b&gt;");
  expect(html).toContain("<dt>Type</dt><dd>lesson</dd>");
  expect(html).toContain("<dt>Scope</dt><dd>project</dd>");
  expect(html).toContain("<details><summary>Evidence quotes</summary>");
  expect(html).toContain("&lt;img src=x onerror=bad&gt;");
  expect(html).toContain("Some source evidence is unavailable.");
  expect(html).not.toMatch(/<script|<img|<textarea|<input|contenteditable/i);
});
it("retains unavailable records and distinguishes loading and unknown recall time", () => {
  expect(renderToStaticMarkup(<RecallMemory at={at} value={undefined} />)).toContain(
    "Loading memory",
  );
  expect(renderToStaticMarkup(<RecallMemory at={at} value={{ unavailable: true }} />)).toContain(
    "Memory unavailable",
  );
  expect(
    renderToStaticMarkup(
      <RecallMemory at="unknown" value={{ detail: { record, incomplete: false } }} />,
    ),
  ).toContain("changes since recall unknown");
  const html = renderToStaticMarkup(
    <RecallMemory
      at={at}
      value={{ detail: { record: { ...record, updatedAt: at, condition: "" }, incomplete: false } }}
    />,
  );
  expect(html).not.toContain("Changed since recall");
  expect(html).toContain("No conditions recorded");
});
it("labels a zero-hit current turn and removes the previous indicator", () => {
  const turn = { key: "1", turn: 2, ids: [], current: true, malformed: false };
  const html = renderToStaticMarkup(<RecallGroup turn={turn} records={new Map()} />);
  expect(html).toContain("Current turn");
  expect(html).toContain('data-current="true"');
  expect(html).toContain("No memories recalled for this turn.");
  expect(
    renderToStaticMarkup(<RecallGroup turn={{ ...turn, current: false }} records={new Map()} />),
  ).not.toContain("Current turn");
  const malformed = renderToStaticMarkup(
    <RecallGroup turn={{ ...turn, malformed: true }} records={new Map()} />,
  );
  expect(malformed).toContain("incomplete or malformed");
  expect(malformed).not.toContain("No memories recalled");
});
