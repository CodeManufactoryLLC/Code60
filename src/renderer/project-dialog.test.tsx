import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectDialog } from "./project-dialog.js";

const props: ComponentProps<typeof ProjectDialog> = {
  projects: [
    { path: "/projects/first", openedAt: "2026-11-11T10:00:00Z" },
    { path: "C:\\projects\\second", openedAt: "2026-11-11T09:00:00Z" },
  ],
  database: "/projects.sqlite",
  busy: false,
  error: "",
  onConnect: () => {},
  onOpen: () => {},
  onCreate: () => {},
  onRemove: () => {},
  onClose: () => {},
};

describe("Open Project dialog", () => {
  it("shows the saved name and full path with an independent remove action", () => {
    const html = renderToStaticMarkup(<ProjectDialog {...props} />);
    expect(html).toContain('aria-label="Recent projects"');
    for (const { path } of props.projects) expect(html).toContain(path);
    for (const name of ["first", "second"]) {
      expect(html).toContain(`<strong>${name}</strong>`);
      expect(html).toContain(`aria-label="Remove ${name} from history"`);
    }
  });

  it("offers database actions and disables folder browsing until connected", () => {
    const html = renderToStaticMarkup(<ProjectDialog {...props} database={null} />);
    expect(html).toContain("Open existing database…");
    expect(html).toContain("Create database…");
    expect(html).not.toContain("Recent projects");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Open Folder<\/button>/);
  });

  it("shows errors and disables project and footer actions during an operation", () => {
    const html = renderToStaticMarkup(
      <ProjectDialog {...props} busy error="Cannot open project" />,
    );
    expect(html).toContain('role="alert">Cannot open project</div>');
    for (const label of ["Cancel", "Open Folder"])
      expect(html).toMatch(new RegExp(`<button[^>]*disabled[^>]*>${label}</button>`));
    for (const button of html.match(
      /<button[^>]*class="(?:icon-button project-remove|project-item)[^>]*>/g,
    ) ?? [])
      expect(button).toContain("disabled");
  });
});
