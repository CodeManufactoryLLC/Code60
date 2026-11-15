import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SystemManagerPage } from "./system-manager.js";

it("puts background service maintenance in System Manager without automation tables or notes", () => {
  const markup = renderToStaticMarkup(
    <SystemManagerPage
      api={{ automation: async () => null, onAutomationChanged: () => () => {} }}
      active={false}
    />,
  );
  expect(markup).toContain('<h1 class="page-title table-title">');
  expect(markup).toContain('data-icon="wrench"');
  expect(markup).toContain('<span class="page-title-text">System Manager</span></h1>');
  expect(markup).toContain("Background service");
  expect(markup).toContain('aria-label="Refresh background service"');
  expect(markup).toContain("Service unavailable");
  expect(markup).toContain("Install service");
  expect(markup).toContain('<details class="automation-service-options">');
  expect(markup).not.toContain('<details class="automation-service-options" open');
  for (const label of ["Install", "Repair", "Start", "Stop", "Uninstall"])
    expect(markup).toContain(`>${label}</button>`);
  expect(markup).not.toContain("data-table");
  expect(markup).not.toContain("New automation");
  expect(markup).not.toContain("Runs continue after you quit Code60.");
  expect(markup).not.toContain("A finished run means the agent turn ended");
});
