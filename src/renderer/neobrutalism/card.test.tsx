import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "./card.js";

it("keeps a noninteractive shell and valid span parts inside native buttons", () => {
  const html = renderToStaticMarkup(
    <Card size="sm" className="navigation-card">
      <button type="button">
        <CardHeader as="span">Artwork</CardHeader>
        <CardContent as="span">
          <CardTitle as="span">Destination</CardTitle>
        </CardContent>
      </button>
      <CardAction>
        <button type="button">Menu</button>
      </CardAction>
    </Card>,
  );
  expect(html).toContain('data-slot="card" data-size="sm"');
  expect(html).toContain("nb:border nb:border-solid");
  expect(html).toContain("nb:shadow-shadow");
  const button = html.slice(html.indexOf("<button"), html.indexOf("</button>"));
  expect(button).not.toContain("<div");
  expect(button).not.toContain("Menu");
  expect(button).toContain('<span data-slot="card-header"');
  expect(html.match(/<button/g)).toHaveLength(2);
});

it("retains the upstream div defaults for non-button composition", () => {
  const html = renderToStaticMarkup(
    <Card>
      <CardHeader>
        <CardTitle>Title</CardTitle>
      </CardHeader>
      <CardContent>Content</CardContent>
    </Card>,
  );
  expect(html).toContain('data-size="default"');
  expect(html).toContain('<div data-slot="card-title"');
  expect(html).not.toContain('role="button"');
});

it("retains landmark semantics and closed-panel attributes without an extra wrapper", () => {
  const html = renderToStaticMarkup(
    <Card as="aside" aria-label="Files panel" inert aria-hidden="true" id="inspector">
      Retained content
    </Card>,
  );
  expect(html).toMatch(/^<aside data-slot="card"/);
  expect(html).toContain('aria-label="Files panel"');
  expect(html).toContain('inert="" aria-hidden="true" id="inspector"');
  expect(html).toMatch(/Retained content<\/aside>$/);
  expect(html).not.toContain("<div");
});
