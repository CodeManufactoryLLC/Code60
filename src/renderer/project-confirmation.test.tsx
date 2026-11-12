import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectConfirmation } from "./project-confirmation.js";

function render(busy = false, blocked = false, error = "") {
  return renderToStaticMarkup(
    <ProjectConfirmation
      path={"/projects/<example>"}
      busy={busy}
      blocked={blocked}
      error={error}
      onCancel={() => {}}
      onConfirm={() => {}}
    />,
  );
}

describe("project confirmation", () => {
  it("identifies the chosen folder as safe text and offers explicit Open and Cancel", () => {
    const html = render();
    expect(html).toContain("Open project?");
    expect(html).toContain("Open &lt;example&gt;?");
    expect(html).toContain('class="project-confirmation-path">/projects/&lt;example&gt;</p>');
    expect(html).toContain(">Cancel</button>");
    expect(html).toContain(">Open project</button>");
  });

  it("keeps errors visible for retry and prevents duplicate actions during opening", () => {
    const html = render(true, false, "Cannot open <folder>");
    expect(html).toContain('role="alert">Cannot open &lt;folder&gt;</div>');
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(3);
    for (const button of buttons) expect(button).toContain("disabled");
  });

  it("blocks opening, but still allows cancellation, if project runs become active", () => {
    const html = render(false, true);
    expect(html).toContain("Finish or stop all runs before switching projects.");
    expect(html).toContain('<button type="button">Cancel</button>');
    expect(html.match(/<button[^>]*class="primary"[^>]*>/)?.[0]).toContain("disabled");
  });
});
