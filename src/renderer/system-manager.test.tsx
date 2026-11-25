import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SystemManagerPage } from "./system-manager.js";

it("shows backend status and directs native lifecycle actions to the local CLI", () => {
  const markup = renderToStaticMarkup(
    <SystemManagerPage
      api={{ automation: async () => null, onAutomationChanged: () => () => {} }}
      active={false}
    />,
  );
  expect(markup).toContain('<span class="page-title-text">System Manager</span>');
  expect(markup).toContain("Services");
  expect(markup).toContain("Terminals");
  expect(markup).toContain("Active Terminals");
  expect(markup).toContain("No active terminal sessions.");
  expect(markup).toContain("Backend Service");
  expect(markup).toContain("code60 service repair");
  expect(markup).toContain('aria-label="System Manager actions"');
  expect(markup).toContain('data-state="checking"');
  expect(markup).toContain("Checking…");
  for (const label of ["Install", "Repair", "Start", "Stop", "Uninstall"])
    expect(markup).not.toContain(`>${label}</button>`);
  expect(markup).not.toContain("Background service");
  expect(markup).not.toContain("data-table");
  expect(markup).not.toContain("New scheduled job");
});
