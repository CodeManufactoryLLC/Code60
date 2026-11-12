import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectSelector, type ProjectSelectorProps } from "./project-selector.js";

const props: ProjectSelectorProps = {
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
};

describe("shared project selector", () => {
  it("shows every recent project, full paths, and all project actions", () => {
    const html = renderToStaticMarkup(
      <ProjectSelector {...props} footerAction={<button type="button">Cancel</button>} />,
    );
    expect(html).toContain('aria-label="Recent projects"');
    for (const name of ["first", "second"]) {
      expect(html).toContain(`<strong>${name}</strong>`);
      expect(html).toContain(`aria-label="Remove ${name} from history"`);
    }
    for (const { path } of props.projects) expect(html).toContain(path);
    expect(html).not.toContain("Clear history");
    expect(html).toContain("<span>Open Folder</span>");
    expect(html).toContain('class="project-open-folder"');
    expect(html.indexOf("</ul>")).toBeLessThan(html.indexOf('class="project-open-folder"'));
    expect(html.indexOf('class="project-open-folder"')).toBeLessThan(
      html.indexOf('class="modal-footer"'),
    );
    expect(html).not.toContain('class="primary project-open-folder"');
    expect(html).not.toContain(">Yes<");
    expect(html).not.toContain(">No<");
  });

  it("keeps failures visible and accepts each surface's own footer action", () => {
    const html = renderToStaticMarkup(
      <ProjectSelector
        {...props}
        error="Cannot open <project>"
        footerAction={<button type="button">Start</button>}
      />,
    );
    expect(html).toContain('role="alert">Cannot open &lt;project&gt;</div>');
    expect(html).toContain(">Start</button>");
    expect(html).toContain("<span>Open Folder</span>");
    expect(html).not.toContain(">Cancel<");
  });

  it("disables project actions while an operation is pending", () => {
    const html = renderToStaticMarkup(<ProjectSelector {...props} busy />);
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(5);
    for (const button of buttons) expect(button).toContain("disabled");
  });

  it("offers database actions instead of stale project history without a database", () => {
    const html = renderToStaticMarkup(<ProjectSelector {...props} database={null} />);
    expect(html).toContain("Open existing database…");
    expect(html).toContain("Create database…");
    expect(html).not.toContain("Recent projects");
    expect(html).not.toContain("Clear history");
    expect(html.match(/<button[^>]*class="project-open-folder"[^>]*>/)?.[0]).toContain("disabled");
  });

  it("keeps Open Folder available when the history is empty", () => {
    const html = renderToStaticMarkup(<ProjectSelector {...props} projects={[]} />);
    expect(html).toContain("No recent projects.");
    expect(html.match(/<button[^>]*class="project-open-folder"[^>]*>/)?.[0]).not.toContain(
      "disabled",
    );
    expect(html).not.toContain("Clear history");
  });
});
