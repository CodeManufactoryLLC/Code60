import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { BubbleContent } from "./transcript-content.js";

it("preserves literal preformatted prompts", () => {
  const html = renderToStaticMarkup(<BubbleContent>{"line one\n  <script>"}</BubbleContent>);
  expect(html).toMatch(/<pre data-slot="bubble-content"[^>]*>line one\n {2}&lt;script&gt;<\/pre>/);
});
