import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList } from "./breadcrumb.js";
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

it("preserves breadcrumb list/current-page semantics and literal preformatted prompts", () => {
  const html = renderToStaticMarkup(
    <>
      <Breadcrumb aria-label="Breadcrumb" inert>
        <BreadcrumbList>
          <BreadcrumbItem>
            <button type="button">Home</button>
          </BreadcrumbItem>
          <BreadcrumbItem aria-current="page">
            <h1>Relay</h1>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <BubbleContent>{"line one\n  <script>"}</BubbleContent>
    </>,
  );
  expect(html).toMatch(/<nav data-slot="breadcrumb" aria-label="Breadcrumb" inert=""><ol/);
  expect(html).toContain('aria-current="page"><h1>Relay</h1>');
  expect(html).toMatch(/<pre data-slot="bubble-content"[^>]*>line one\n {2}&lt;script&gt;<\/pre>/);
  expect(html.match(/<button/g)).toHaveLength(1);
});
