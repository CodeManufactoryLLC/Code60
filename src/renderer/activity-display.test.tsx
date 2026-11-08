import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ActivitySnapshot, ActivityState } from "../bridge/index.js";
import { ActivityDisplay, activityAnimation, activityIcon } from "./activity-display.js";

const activity: ActivitySnapshot = {
  state: "executing",
  label: "Running command",
  source: "observed",
  declaration: {
    activityType: "testing",
    label: "Checking <script>injection</script>",
    expiresAt: 120_000,
  },
  otherOperations: 2,
  workerCount: 1,
  active: true,
  urgent: false,
};
function render(value: ActivitySnapshot | undefined, hidden = false, override?: "Stopping") {
  return renderToStaticMarkup(
    <ActivityDisplay
      activity={value}
      fallback="Idle"
      delegated="1 worker working"
      hidden={hidden}
      override={override}
    />,
  );
}
describe("activity presentation", () => {
  it("preserves attribution, counts, and plain text without implying test success", () => {
    const html = render(activity);
    expect(html).toContain(">Executing...</span>");
    expect(html).toContain('data-tooltip="Observed activity: Executing');
    expect(html).toContain("executing.gif");
    expect(html).not.toContain("testing.gif");
    expect(html).toContain("Agent-reported purpose:");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("2 other operations");
    expect(html).toContain("1 worker working");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("passed");
    const declared = render({
      ...activity,
      source: "declared",
      state: "testing",
      label: "Testing cancellation",
    });
    expect(declared).toContain("Agent-reported");
    expect(declared).toContain(">Testing...</span>");
    expect(declared).toContain("testing.gif");
  });
  it("pauses hidden visuals and uses a static fallback for unmapped artwork", () => {
    expect(render(activity, true)).toContain('data-animate="false"');
    expect(render(activity, true)).not.toContain("<img");
    expect(render(undefined)).toBe("");
    expect(activityIcon("future-type" as ActivityState)).toBe("information");
  });
  it("uses local semantic artwork without treating retrieval as a download", () => {
    expect(activityAnimation("responding")).toBe(activityAnimation("writing"));
    expect(activityAnimation("dispatching")).toBe(activityAnimation("delegating"));
    expect(activityAnimation("retrieving")).toBeUndefined();
    expect(activityAnimation("future-type" as ActivityState)).toBeUndefined();
    expect(render({ ...activity, state: "idle", active: false })).toBe("");
  });
  it("presents waiting for workers as monitoring subagents", () => {
    const html = render({
      ...activity,
      state: "waiting_for_workers",
      source: "host",
      declaration: null,
      active: false,
      urgent: true,
    });
    expect(html).toContain("Monitoring subagents...");
    expect(html).toContain('data-immediate="false"');
    expect(html).toContain("waiting_for_workers.gif");
    expect(html).not.toContain("Waiting for workers");
  });
  it("shows urgent local stopping immediately", () => {
    const html = render(activity, false, "Stopping");
    expect(html).toContain('data-activity="stopping"');
    expect(html).toContain(">Stopping...</span>");
    expect(html).not.toContain("<img");
    expect(html).toContain('data-animate="false"');
  });
});
