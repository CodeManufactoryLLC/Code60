import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { BubbleContent } from "./bubble.js";
import { Button } from "./button.js";
import { Textarea } from "./textarea.js";

it("retains native button/textarea semantics, labels and disabled state", () => {
  const html = renderToStaticMarkup(
    <section aria-label="Composer">
      <label htmlFor="draft">Message</label>
      <Textarea
        id="draft"
        ref={createRef<HTMLTextAreaElement>()}
        defaultValue="Unsent <code>"
        disabled
      />
      <Button variant="primary" disabled aria-label="Send message">
        Send
      </Button>
      <Button variant="quiet" type="submit">
        Save
      </Button>
    </section>,
  );
  expect(html).toMatch(/<textarea[^>]*id="draft"[^>]*disabled="">Unsent &lt;code&gt;<\/textarea>/);
  expect(html).toMatch(
    /<button type="button"[^>]*data-slot="button"[^>]*disabled=""[^>]*aria-label="Send message"/,
  );
  expect(html).toMatch(/<button type="submit"[^>]*data-variant="quiet"/);
});

it("preserves literal preformatted prompts", () => {
  const html = renderToStaticMarkup(<BubbleContent>{"line one\n  <script>"}</BubbleContent>);
  expect(html).toMatch(/<pre data-slot="bubble-content"[^>]*>line one\n {2}&lt;script&gt;<\/pre>/);
});
