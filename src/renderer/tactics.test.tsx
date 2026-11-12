import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TACTIC_SHARED_INSTRUCTIONS, TACTICS } from "../bridge/index.js";
import { TacticsControl, TacticsDialog } from "./tactics.js";

it("does not auto-open the production dialog and makes unavailable selection actionable", () => {
  const render = (selection?: string | null) =>
    renderToStaticMarkup(
      <TacticsControl
        selection={selection}
        disabled={false}
        active
        context="chat"
        onChange={async () => true}
      />,
    );
  expect(render()).toContain(">Tactics</span>");
  expect(render()).not.toContain("<dialog");
  expect(render("removed")).toContain("Replace or clear");
  expect(render("removed")).toContain('aria-label="Remove tactic"');
  expect(render("independent-review")).toContain("Independent review");
});
it("previews the applied workflow, exposes the complete shared prompt and separates Apply", () => {
  const html = renderToStaticMarkup(
    <TacticsDialog selected="independent-review" onApply={async () => true} onClose={() => {}} />,
  );
  for (const tactic of TACTICS) expect(html).toContain(tactic.title);
  expect(html).toContain('aria-label="Tactic details"');
  expect(html).toContain("Orchestrator prompt");
  expect(html).toContain("Shared instructions");
  expect(html).toContain("How this tactic works");
  expect(html).toContain(TACTIC_SHARED_INSTRUCTIONS.slice(0, 80));
  expect(html).toContain("Applied</button>");
  expect(html).toContain('role="img"');
  expect(html).not.toContain("dangerouslySetInnerHTML");
});
