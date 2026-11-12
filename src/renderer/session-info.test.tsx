import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SessionState } from "../core/index.js";
import { contextUsage, SessionInfo } from "./session-info.js";
import { transcript } from "./transcript.js";
import { replyTurns } from "./unread.js";

const at = "2026-11-07T12:00:00.000Z";
const state: SessionState = {
  model: { id: "m1", name: "Model One", reportedAt: at },
  usage: { used: 53000, size: 200000, reportedAt: at },
  modes: {
    source: "config",
    confirmed: true,
    reportedAt: at,
    controls: [
      {
        id: "mode",
        name: "Mode",
        currentValue: "ask",
        options: [
          { value: "ask", name: "Ask", group: "Standard" },
          { value: "full", name: "Full Access", group: "Standard" },
        ],
      },
    ],
  },
};
const render = (overrides: Partial<Parameters<typeof SessionInfo>[0]> = {}) =>
  renderToStaticMarkup(
    <SessionInfo
      harness="droid"
      sessionId="session-one"
      state={state}
      ended={false}
      editable
      changing={false}
      autoApproval
      onMode={() => {}}
      {...overrides}
    />,
  );

describe("session information", () => {
  it("shows separate model, context, harness mode and Code60 approval state", () => {
    const html = render();
    expect(html).toContain(">Model One</span>");
    expect(html).toContain("26.5%");
    expect(html).toContain("Harness mode");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('width="20"');
    expect(html).toContain('stroke-dasharray="26.5 100"');
    expect(html).toContain("Code60 auto-approval: On");
    expect(html).toContain('aria-disabled="false"');
    expect(html).not.toContain("<select");
  });
  it("disables changes while busy and renders historical values as read-only", () => {
    expect(render({ changing: true })).toContain('aria-disabled="true"');
    expect(render({ editable: false })).toContain('aria-disabled="true"');
    const html = render({ ended: true });
    expect(html).toContain("Last reported");
    expect(html).toContain("Ask");
    expect(html).not.toContain("<select");
  });
  it("handles absent values and zero capacity without estimating", () => {
    expect(render({ state: undefined })).toContain("N/A");
    expect(contextUsage(null)).toBe("N/A");
    expect(contextUsage({ used: 0, size: 0, reportedAt: at })).toBe("0 / 0 tokens");
  });
  it("clamps the visual fraction and falls back for unknown harnesses", () => {
    const over = { ...state, usage: { used: 300, size: 200, reportedAt: at } };
    expect(render({ state: over })).toContain('stroke-dasharray="100 100"');
    const unknown = render({ harness: "custom-agent" });
    expect(unknown).toContain("Current provider: custom-agent");
    expect(unknown).not.toContain("<img");
    expect(render({ state: undefined })).toContain('data-reported="false"');
    if (!state.modes) throw new Error("Missing fixture modes");
    const emptyModes = { ...state, modes: { ...state.modes, controls: [] } };
    expect(render({ state: emptyModes })).toContain("Harness mode: N/A");
  });
  it("shows advertised controls together and preserves unconfirmed state", () => {
    const multiple = structuredClone(state);
    if (!multiple.modes) throw new Error("Missing fixture modes");
    multiple.modes.controls.push({
      id: "execution",
      name: "Execution",
      currentValue: "build",
      options: [{ value: "build", name: "Build" }],
    });
    expect(render({ state: multiple })).toContain("Ask · Build");
    multiple.modes.confirmed = false;
    expect(render({ state: multiple })).toContain("Unconfirmed");
    expect(render({ state: multiple })).toContain('aria-haspopup="menu"');
  });
  it("keeps metadata out of streamed messages and unread counts", () => {
    const events = [
      { runId: "r1", at, type: "prompt" as const, turn: 1, text: "hi" },
      { runId: "r1", at, type: "message" as const, text: "one" },
      { runId: "r1", at, type: "sessionState" as const, state },
      { runId: "r1", at, type: "message" as const, text: "two" },
    ];
    expect(transcript(events).map((block) => block.text)).toEqual(["hi", "onetwo"]);
    expect(replyTurns(events)).toEqual([1]);
  });
});
