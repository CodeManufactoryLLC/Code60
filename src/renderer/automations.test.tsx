import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { ApplicationClient } from "../bridge/index.js";
import { AutomationsPage } from "./automations.js";

it("offers direct Carbon job controls and bounded history without service management or grid settings", () => {
  const markup = renderToStaticMarkup(
    <AutomationsPage api={{} as ApplicationClient} active={false} agents={[]} />,
  );
  expect(markup).toMatch(/<h1[^>]*>Scheduled Jobs<\/h1>/);
  expect(markup).toContain('aria-label="Scheduled job controls"');
  expect(markup).toContain("New scheduled job");
  expect(markup).toContain("Refresh");
  expect(markup).toContain('aria-label="Schedules"');
  expect(markup).toContain("Execution history");
  expect(markup).toContain("Scheduled Jobs views");
  expect(markup).toContain("cds--data-table");
  expect(markup).not.toContain("Scheduled Jobs actions");
  expect(markup).not.toContain("Install service");
  expect(markup).not.toContain("Table settings");
  expect(markup).not.toContain("Saved filters");
});
