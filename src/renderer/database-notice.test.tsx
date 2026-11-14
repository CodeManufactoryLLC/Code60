import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DatabaseNotice } from "./database-notice.js";

it("names the unavailable workspace and offers connection without rendering error markup", () => {
  const html = renderToStaticMarkup(
    <DatabaseNotice busy={false} error="<invalid database>" onConnect={() => {}} />,
  );
  expect(html).toContain('aria-label="Database connection required"');
  expect(html).toContain("No database connected");
  expect(html).toContain("Connect to database");
  expect(html).toContain("&lt;invalid database&gt;");
  expect(html).not.toContain("Connect a database to enable");
  expect(html).not.toContain("disabled");
});

it("disables duplicate connection attempts while an action is pending", () => {
  expect(renderToStaticMarkup(<DatabaseNotice busy onConnect={() => {}} />)).toContain("disabled");
});
