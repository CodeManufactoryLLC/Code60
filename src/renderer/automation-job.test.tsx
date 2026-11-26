import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { ApplicationClient, AutomationSummary } from "../bridge/index.js";
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
      api={{} as ApplicationClient}
      active={false}
      open={false}
      busy={false}
      onToggle={vi.fn()}
      onAction={vi.fn()}
      onHistory={vi.fn()}
      onEdit={vi.fn()}
    />,
  );
it("exposes job settings and live state in separate cells before expansion", () => {
  const html = render({ enabled: true, nextRunAt: "2027-05-16T09:00:00.000Z" });
  for (const value of [
    "Expand Daily checks",
    "Run Daily checks",
    "Actions for Daily checks",
    "Enabled",
    "May",
    "Idle",
    "droid",
  ])
    expect(html).toContain(value);
  expect(html).not.toContain("Saved prompt");
});
it("shows active manual runs independently of paused schedules", () => {
  const html = render({ running: true });
  for (const value of ["Stop Daily checks", "Paused", "Running"]) expect(html).toContain(value);
});
it("never infers a running job from schedule enablement", () => {
  const html = render({ enabled: true });
  expect(html).toContain('aria-label="Run Daily checks"');
  expect(html).not.toContain(">Running<");
  expect(html).not.toContain(">Paused<");
});
it("disables run controls when an older service cannot report live ownership", () => {
  expect(render({}, true)).toContain("Unknown");
  expect(render({}, true)).toMatch(/aria-label="Run Daily checks"[^>]+disabled=""/);
});
it("displays a Workflow tag for workflow scheduled jobs", () => {
  expect(render({ actionType: "workflow", taskCount: 3 })).toContain(">Workflow<");
  expect(render({ actionType: "prompt" })).toContain(">Prompt<");
});
