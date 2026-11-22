import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { DesktopApi } from "../bridge/index.js";
import { AutomationsPage } from "./automations.js";
import { defaultTextStyles } from "./typography.js";

vi.mock("./data-table.js", () => ({
  DataTable: ({ tableId }: { tableId: string }) =>
    createElement("div", { "data-test-table": tableId }),
}));

it("keeps service controls and explanatory notes out of Scheduled Jobs", () => {
  const markup = renderToStaticMarkup(
    <AutomationsPage
      api={{} as DesktopApi}
      active={false}
      agents={[]}
      lines={{ horizontal: false, vertical: false, heading: false }}
      density="high"
      fit
      textStyles={defaultTextStyles}
    />,
  );

  expect(markup).toContain('<h1 class="page-title table-title">');
  expect(markup).toContain('data-icon="app-robotic-arm"');
  expect(markup).toContain('<span class="page-title-text">Scheduled Jobs</span></h1>');
  expect(markup).not.toContain("Runs continue after you quit Code60.");
  expect(markup).not.toContain("A finished run means the agent turn ended");
  expect(markup).not.toContain("Background service");
  expect(markup).not.toContain("Service options");
  expect(markup).not.toContain("Install service");
  expect(markup).not.toContain('data-test-table="automations"');
  expect(markup).toContain('data-slot="accordion"');
  expect(markup).toContain('aria-haspopup="menu"');
  expect(markup).not.toContain("Refresh scheduled jobs");
  expect(markup).not.toContain("New scheduled job");
  expect(markup).toContain('data-test-table="automation-history"');
  expect(markup.match(/automation-table-card/g)).toHaveLength(1);
  expect(markup).toContain('aria-labelledby="schedules-heading"');
  expect(markup).toContain('aria-label="Execution history"');
  expect(markup).not.toContain("Cancel active run");
  expect(markup).not.toContain("Delete automation");
  expect(markup).not.toContain("Read transcript");
  expect(markup).not.toContain("Read changes");
});
