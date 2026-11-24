import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidebarFooterActions } from "./sidebar-footer-actions.js";

function render(returnDisabled = false, databaseDisabled = false) {
  return renderToStaticMarkup(
    <SidebarFooterActions
      returnDisabled={returnDisabled}
      databaseDisabled={databaseDisabled}
      onReturn={() => {}}
      onDatabase={() => {}}
    />,
  );
}

describe("sidebar footer navigation", () => {
  it("places workspace setup and database selection together", () => {
    const html = render();
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Workspace setup" title="Workspace setup"');
    expect(html.indexOf("footer-splash")).toBeLessThan(html.indexOf("footer-database"));
    expect(html).not.toContain("disabled");
  });

  it("keeps return navigation available when switching databases is blocked by active runs", () => {
    const html = render(false, true);
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons[0]).not.toContain("disabled");
    expect(buttons[1]).toContain("disabled");
  });

  it("disables both controls while a conflicting action is pending", () => {
    for (const button of render(true, true).match(/<button[^>]*>/g) ?? [])
      expect(button).toContain("disabled");
  });
});
