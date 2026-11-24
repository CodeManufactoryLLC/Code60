import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Button } from "./button.js";
import { Surface } from "./surfaces.js";
import { Switch } from "./switch.js";
import { Textarea } from "./textarea.js";

it("retains native submit, disabled, ref and source escaping while Carbon owns presentation", () => {
  const html = renderToStaticMarkup(
    <section>
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
  expect(html).toMatch(
    /<textarea(?=[^>]*id="draft")(?=[^>]*disabled="")[^>]*>Unsent &lt;code&gt;<\/textarea>/,
  );
  expect(html).toMatch(
    /<button(?=[^>]*aria-label="Send message")(?=[^>]*disabled="")(?=[^>]*type="button")[^>]*>/,
  );
  expect(html).toContain("cds--btn--primary");
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save<\/button>/);
  expect(html.match(/>Message<\/label>/g)).toHaveLength(1);
  expect(html).not.toContain("nb:");
});

it("preserves a retained region's landmark, refs, inertness and hidden state without nested frames", () => {
  const html = renderToStaticMarkup(
    <Surface as="aside" id="files" aria-label="Files panel" inert hidden>
      Retained content
    </Surface>,
  );
  expect(html).toMatch(
    /^<aside[^>]*id="files"[^>]*aria-label="Files panel"[^>]*inert=""[^>]*hidden=""/,
  );
  expect(html).toMatch(/Retained content<\/aside>$/);
  expect(html).not.toContain("<div");
  expect(html).not.toContain('data-slot="card"');
});

it("keeps compound switch labels and descriptions linked to a disabled Carbon switch", () => {
  const html = renderToStaticMarkup(
    <Switch
      id="memory"
      labelText={<span>Memory</span>}
      aria-describedby="memory-help"
      checked
      disabled
      onChange={() => {}}
    />,
  );
  expect(html).toContain('<label id="memory-label" for="memory"><span>Memory</span></label>');
  expect(html).toMatch(
    /<button(?=[^>]*role="switch")(?=[^>]*aria-checked="true")(?=[^>]*disabled="")(?=[^>]*aria-describedby="memory-help")(?=[^>]*aria-labelledby="memory-label")[^>]*>/,
  );
});
