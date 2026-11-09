import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { DesktopApi, Plan } from "../bridge/index.js";
import { PlanPanel } from "./plan-panel.js";

function render(states: Plan["tasks"][number]["state"][], state: Plan["state"] = "running") {
  const plan: Plan = {
    format: 1,
    id: "plan",
    chatId: "chat",
    project: null,
    revision: 1,
    proposalRevision: 1,
    requestId: "create",
    creationKey: "",
    title: "<script>plan</script>",
    description: "Details",
    state,
    tasks: states.map((state, index) => ({
      id: String(index),
      text: `Task ${index}`,
      state,
      note: "Evidence",
      workerIds: [],
    })),
  };
  return renderToStaticMarkup(
    <PlanPanel plan={plan} api={{} as DesktopApi} currentChat="chat" project={null} />,
  );
}
it("shows equal task weighting and a count outside the document", () => {
  const html = render(["completed", "in_progress", "blocked", "pending"]);
  expect(html).toContain('value="1" max="4"');
  expect(html).toContain("1 out of 4");
  expect(html.split("<article")[1]).not.toContain("out of");
  expect(html.match(/checked=""/g)).toHaveLength(1);
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
});
it("shows empty progress before acceptance and full progress on completion", () => {
  expect(render(["pending"], "draft")).toContain('value="0" max="1"');
  expect(render(["pending"], "draft")).toContain(">Accept</button>");
  const complete = render(["completed", "completed"], "completed");
  expect(complete).toContain('value="2" max="2"');
  expect(complete).toContain("2 out of 2");
  expect(complete).not.toContain(">Accept</button>");
});
