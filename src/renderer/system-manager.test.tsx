import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SystemManagerPage } from "./system-manager.js";

it("labels Scheduling Service and waits for verified status before offering lifecycle actions", () => {
  const markup = renderToStaticMarkup(
    <SystemManagerPage
      api={{ automation: async () => null, onAutomationChanged: () => () => {} }}
      active={false}
    />,
  );
  expect(markup).toContain('<span class="page-title-text">System Manager</span>');
  expect(markup).toContain("Scheduling Service");
  expect(markup).toContain('aria-label="Refresh Scheduling Service"');
  expect(markup).toContain('data-state="checking"');
  expect(markup).toContain("Checking…");
  for (const label of ["Install", "Repair", "Start", "Stop", "Uninstall"])
    expect(markup).not.toContain(`>${label}</button>`);
  expect(markup).not.toContain("Background service");
  expect(markup).not.toContain("data-table");
  expect(markup).not.toContain("New scheduled job");
});
