import { expect, it, vi } from "vitest";
import { draftWorkflow } from "../src/core/index.js";
import { FakeAgents } from "./fakes.js";

const spec = { name: "fake", command: ["fake"] as [string], cwd: "/private-workflow" };
it("generates a validated clarification without tools or execution authority", async () => {
  let permission: Promise<string> | undefined;
  const agents = new FakeAgents((_, session) => {
    permission = session.requestPermission({ toolCallId: "edit", title: "Edit", kind: "edit" });
    session.update({ type: "thought", text: "not draft content" });
    session.update({
      type: "message",
      text: JSON.stringify({ message: "What should be verified?" }),
    });
    return "end_turn";
  });
  expect(await draftWorkflow(agents, spec, "{}", new AbortController().signal)).toEqual({
    message: "What should be verified?",
  });
  expect(await permission).toBe("deny");
  expect(agents.specs[0]?.mcpServers).toEqual([]);
  expect(agents.sessions[0]?.stops).toEqual([1000]);
});
it.each(["bad-json", "authority", "incomplete", "oversized", "empty"])(
  "rejects %s output and stops the helper",
  async (mode) => {
    const agents = new FakeAgents((_, session) => {
      session.update({
        type: "message",
        text:
          mode === "oversized"
            ? "x".repeat(160_001)
            : mode === "bad-json"
              ? "Oops"
              : mode === "empty"
                ? ""
                : JSON.stringify({
                    message: "Draft",
                    ...(mode === "authority" ? { autoApprove: true } : {}),
                  }),
      });
      return mode === "incomplete" ? "refusal" : "end_turn";
    });
    await expect(draftWorkflow(agents, spec, "{}", new AbortController().signal)).rejects.toThrow();
    expect(agents.sessions[0]?.stops).toEqual([1000]);
  },
);
it.each(["cancel", "exit"])("settles hanging generation on %s", async (mode) => {
  const agents = new FakeAgents(() => "hang");
  const abort = new AbortController();
  const pending = draftWorkflow(agents, spec, "{}", abort.signal);
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(agents.sessions).toHaveLength(1));
  if (mode === "cancel") abort.abort();
  else agents.sessions[0]?.crash();
  await rejected;
  expect(agents.sessions[0]?.stops).toEqual([1000]);
});
it("bounds context before starting the provider", async () => {
  const agents = new FakeAgents();
  await expect(
    draftWorkflow(agents, spec, "x".repeat(160_001), new AbortController().signal),
  ).rejects.toThrow("context");
  expect(agents.specs).toEqual([]);
});
