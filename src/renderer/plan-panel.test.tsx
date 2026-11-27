import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { ApplicationClient, Plan } from "../bridge/index.js";
import { PlanPanel } from "./plan-panel.js";

function render(
  states: Plan["tasks"][number]["state"][],
  state: Plan["state"] = "running",
  mode?: "direct" | "worktree",
  executionTiming?: Plan["executionTiming"],
) {
  const plan: Plan = {
    format: 1,
    id: "plan",
    chatId: "chat",
    project: null,
    revision: 1,
    proposalRevision: 1,
    creationOrder: 1,
    requestId: "create",
    creationKey: "",
    title: "<script>plan</script>",
    description: "Details",
    state,
    ...(executionTiming ? { executionTiming } : {}),
    tasks: states.map((state, index) => ({
      id: String(index),
      text: `Task ${index}`,
      state,
      note: "Evidence",
      workerIds: [],
      ...(mode ? { target: { id: "target", cwd: "/explicit/<source>", workspaceMode: mode } } : {}),
    })),
  };
  return renderToStaticMarkup(
    <PlanPanel plan={plan} api={{} as ApplicationClient} currentChat="chat" project={null} />,
  );
}
it("shows escaped target assignments and warns before accepting direct edits", () => {
  const direct = render(["pending"], "draft", "direct");
  expect(direct).toContain("/explicit/&lt;source&gt;");
  expect(direct).toContain("Undo also rewinds manual edits since the checkpoint");
  expect(direct).toContain(">Accept</button>");
  expect(render(["pending"], "draft", "worktree")).toContain("isolated worktree");
});
it("shows equal task weighting and a count outside the document", () => {
  const html = render(["completed", "in_progress", "blocked", "pending"]);
  expect(html).toMatch(
    /role="progressbar"(?=[^>]*aria-valuenow="1")(?=[^>]*aria-valuemax="4")[^>]*>/,
  );
  expect(html).toContain("1 out of 4");
  expect(html.split("<article")[1]).not.toContain("out of");
  expect(html.match(/<input[^>]*type="checkbox"[^>]*checked=""/g)).toHaveLength(1);
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
});
it("shows empty progress before acceptance and full progress on completion", () => {
  expect(render(["pending"], "draft")).toMatch(
    /role="progressbar"(?=[^>]*aria-valuenow="0")(?=[^>]*aria-valuemax="1")[^>]*>/,
  );
  expect(render(["pending"], "draft")).toContain(">Accept</button>");
  const complete = render(["completed", "completed"], "completed");
  expect(complete).toMatch(
    /role="progressbar"(?=[^>]*aria-valuenow="2")(?=[^>]*aria-valuemax="2")[^>]*>/,
  );
  expect(complete).toContain("2 out of 2");
  expect(complete).not.toContain(">Accept</button>");
});
it("labels every task state in text and keeps completion read-only", () => {
  const html = render(["completed", "in_progress", "blocked", "pending"], "paused");
  for (const label of ["Completed", "In progress", "Blocked", "Pending"])
    expect(html).toContain(`<span class="plan-task-badge">${label}</span>`);
  expect(html.match(/<input(?=[^>]*type="checkbox")(?=[^>]*disabled="")[^>]*>/g)).toHaveLength(4);
  expect(html).toMatch(/<label class="plan-task-text" for="[^"]+-task-0">Task 0<\/label>/);
  expect(html).toContain('<p class="plan-task-note">Evidence</p>');
  expect(html).toContain('class="primary plan-action');
  expect(html).toContain(">Resume plan</button>");
});

afterEach(() => vi.restoreAllMocks());
it.each([
  [0, 3, 0],
  [1, 3, 33],
  [2, 3, 67],
  [1, 8, 13],
  [3, 3, 100],
])(
  "rounds %s of %s tasks to %s percent in the label and accessible bar",
  (completed, total, percentage) => {
    const html = render(
      Array.from({ length: total }, (_, index) => (index < completed ? "completed" : "pending")),
    );
    expect(html).toContain(`${percentage}% (${completed} out of ${total})`);
    expect(html).toContain(`${percentage}% (${completed} out of ${total} tasks completed)`);
  },
);
it("shows running time above the bar without announcing clock ticks", () => {
  vi.spyOn(Date, "now").mockReturnValue(100_000);
  const html = render(["pending"], "running", undefined, {
    elapsedMs: 65_000,
    runningSince: 98_000,
  });
  expect(html).toContain("Execution time: 1m 7s");
  expect(html).toContain('role="timer" aria-live="off" aria-label="Plan execution time"');
  expect(html.indexOf('role="timer"')).toBeLessThan(html.indexOf('role="progressbar"'));
  expect(html.split("<article")[1]).not.toContain("Execution time");
});
it("freezes saved totals outside running, labels partial history and handles older plans", () => {
  expect(render(["pending"], "draft")).toContain("Execution time: 0s");
  expect(render(["pending"], "paused")).toContain("Execution time: Not recorded");
  for (const state of ["queued", "paused", "failed", "completed", "dismissed"] as const)
    expect(
      render(["pending"], state, undefined, { elapsedMs: 3_661_000, runningSince: 0 }),
    ).toContain("Execution time: 1h 1m 1s");
  expect(
    render(["pending"], "paused", undefined, { elapsedMs: 5_000, historyIncomplete: true }),
  ).toContain("Execution time: 5s (recorded)");
});
it("clamps a future running timestamp to the saved total", () => {
  vi.spyOn(Date, "now").mockReturnValue(1_000);
  expect(
    render(["pending"], "running", undefined, { elapsedMs: 5_000, runningSince: 2_000 }),
  ).toContain("Execution time: 5s");
});
it("renders structured plan sections and task metadata safely and omits empty sections", () => {
  const minimal = render(["pending"], "draft");
  expect(minimal).not.toContain("Out of scope");
  expect(minimal).not.toContain("Assumptions &amp; open questions");
  expect(minimal).not.toContain("Verification &amp; completion criteria");
  expect(minimal).not.toContain("plan-task-detail");
  expect(minimal).not.toContain("plan-task-meta");

  const plan: Plan = {
    format: 1,
    id: "plan-structured",
    chatId: "chat",
    project: null,
    revision: 1,
    proposalRevision: 1,
    creationOrder: 1,
    requestId: "structured",
    creationKey: "",
    title: "Structured plan",
    description: "Goal summary",
    outOfScope: ["<b>Not this</b>"],
    assumptions: ["API token is configured"],
    verification: ["Run npm run check"],
    state: "draft",
    tasks: [
      {
        id: "task-1",
        text: "Build structured schema",
        details: "Edit bridge and application <plan> files",
        verify: "Unit tests pass",
        state: "pending",
        note: "",
        workerIds: [],
      },
    ],
  };
  const html = renderToStaticMarkup(
    <PlanPanel plan={plan} api={{} as ApplicationClient} currentChat="chat" project={null} />,
  );
  expect(html).toContain("Out of scope");
  expect(html).toContain("&lt;b&gt;Not this&lt;/b&gt;");
  expect(html).not.toContain("<b>Not this</b>");
  expect(html).toContain("Assumptions &amp; open questions");
  expect(html).toContain("API token is configured");
  expect(html).toContain("Edit bridge and application &lt;plan&gt; files");
  expect(html).toContain('<span class="plan-task-meta-label">Verify:</span> Unit tests pass');
  expect(html).toContain("Verification &amp; completion criteria");
  expect(html).toContain("Run npm run check");
});
