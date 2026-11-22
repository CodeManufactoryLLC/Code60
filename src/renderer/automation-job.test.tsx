import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { AutomationSummary, DesktopApi } from "../bridge/index.js";
import { AutomationJob } from "./automation-job.js";

const job: AutomationSummary = {
  id: "job",
  revision: 1,
  name: "Daily checks",
  agent: "droid",
  enabled: false,
  nextRunAt: null,
  running: false,
};
const render = (changes: Partial<AutomationSummary> = {}, legacy = false) =>
  renderToStaticMarkup(
    <AutomationJob
      job={
        legacy
          ? (({ running: _running, ...rest }) => rest)({ ...job, ...changes })
          : { ...job, ...changes }
      }
      api={{} as DesktopApi}
      agents={[]}
      active={false}
      open={false}
      busy={false}
      onToggle={vi.fn()}
      onAction={vi.fn()}
      onSaved={vi.fn()}
    />,
  );
it("keeps independent run and delete buttons outside a collapsed disclosure", () => {
  const html = render();
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('aria-label="Run Daily checks"');
  expect(html).toContain('aria-label="Delete Daily checks"');
  expect(html).toContain('hidden=""');
  const heading = html.slice(html.indexOf("<h3"), html.indexOf("</h3>"));
  expect(heading).not.toContain("<button");
  expect(html).toContain('aria-label="Expand Daily checks"');
  const run = html.indexOf('aria-label="Run Daily checks"');
  const remove = html.indexOf('aria-label="Delete Daily checks"');
  const expand = html.indexOf('aria-label="Expand Daily checks"');
  expect(run).toBeLessThan(remove);
  expect(remove).toBeLessThan(expand);
  expect(html).toContain('class="neo-accordion-indicator"');
  expect(html).toContain("Daily checks (Paused)");
  expect(html).not.toContain("automation-job-meta");
  expect(html).not.toContain("droid");
});
it("uses live run ownership even for a paused schedule and disables deletion", () => {
  const html = render({ running: true });
  expect(html).toContain('aria-label="Stop Daily checks"');
  expect(html).toContain("is-running");
  expect(html).toContain("Daily checks (Paused)");
  expect(html).toMatch(/aria-label="Delete Daily checks"[^>]+disabled=""/);
});
it("never infers a running job from schedule enablement", () => {
  const html = render({ enabled: true });
  expect(html).toContain('aria-label="Run Daily checks"');
  expect(html).not.toContain("is-running");
  expect(html).not.toContain("(Paused)");
});
it("disables run controls when an older service cannot report live ownership", () => {
  expect(render({}, true)).toMatch(/aria-label="Run Daily checks"[^>]+disabled=""/);
});
