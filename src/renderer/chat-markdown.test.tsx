import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ChatMarkdown } from "./chat-markdown.js";

const render = (text: string) =>
  renderToStaticMarkup(<ChatMarkdown text={text} openLink={async () => true} />);

it("renders Markdown and GFM as semantic React elements", () => {
  const html = render(
    [
      "# Heading",
      "",
      "**Bold** and *italic* and ~~removed~~ with `Code`.",
      "",
      "> Quote",
      "",
      "1. First",
      "2. Second",
      "",
      "- [x] Done",
      "- [ ] Next",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| One | Two |",
      "",
      "```ts",
      "const value = '<tag>'; // Keep CASE",
      "```",
    ].join("\n"),
  );
  for (const fragment of [
    "<h1>Heading</h1>",
    "<strong>Bold</strong>",
    "<em>italic</em>",
    "<del>removed</del>",
    "<code>Code</code>",
    "<blockquote>",
    "<ol>",
    "<table>",
    "<th>Name</th>",
    'type="checkbox" disabled="" checked=""',
    'class="language-ts"',
    "const value = &#x27;&lt;tag&gt;&#x27;; // Keep CASE",
  ])
    expect(html).toContain(fragment);
});

it("keeps HTML literal, suppresses image loads and makes unsupported destinations inert", () => {
  const html = render(
    [
      '<script>alert("no")</script>',
      "",
      '<img src="https://example.com/beacon" onerror="alert(1)">',
      "",
      "![Image description](https://example.com/image.png)",
      "",
      "[Unsafe](javascript:alert%281%29) [Local](file:///tmp/test) [Relative](src/file.ts)",
      "[Mail](mailto:user@example.com) [Credentials](https://user:pass@example.com)",
      "[Web](https://example.com/path)",
    ].join("\n"),
  );
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("Image description");
  expect(html).not.toMatch(/<(?:script|img|iframe)\b/);
  expect(html).not.toContain('href="file:');
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('href="mailto:');
  expect(html.match(/<a /g)).toHaveLength(1);
  expect(html).toContain('href="https://example.com/path"');
  expect(html).toContain("opens browser after confirmation");
});

it("accepts incomplete streamed Markdown without opening links or modifying source", () => {
  const openLink = vi.fn(async () => true);
  const text =
    "# Result\n\n**Still streaming**\n\n```ts\nconst x = '<tag>';\n```\n\n[Web](https://example.com)";
  for (let end = 1; end <= text.length; end++) {
    expect(() =>
      renderToStaticMarkup(<ChatMarkdown text={text.slice(0, end)} openLink={openLink} />),
    ).not.toThrow();
  }
  expect(openLink).not.toHaveBeenCalled();
  expect(text).toContain("**Still streaming**");
});
