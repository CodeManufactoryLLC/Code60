import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SessionState } from "../core/index.js";
import { contextUsage, SessionInfo } from "./session-info.js";
import { transcript } from "./state.js";
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
    expect(html).toContain("Model: Model One");
    expect(html).toContain("26.5%");
    expect(html).toContain("Harness mode");
    expect(html).toContain('optgroup label="Standard"');
    expect(html).toContain("Code60 auto-approval: On");
    expect(html).toMatch(/<select(?![^>]*disabled)[^>]*>/);
  });
  it("keeps separately advertised groups with the same label distinct", () => {
    const grouped: SessionState = structuredClone(state);
    const options = grouped.modes?.controls[0]?.options;
    if (!options?.[0] || !options[1]) throw new Error("Missing test options");
    options[0].groupId = "first";
    options[1].groupId = "second";
    expect(render({ state: grouped }).match(/<optgroup /g)).toHaveLength(2);
  });
  it("disables changes while busy and renders historical values as read-only", () => {
    expect(render({ changing: true })).toMatch(/<select[^>]*disabled/);
    expect(render({ editable: false })).toMatch(/<select[^>]*disabled/);
    const html = render({ ended: true });
    expect(html).toContain("Last reported");
    expect(html).toContain("Ask");
    expect(html).not.toContain("<select");
  });
  it("handles absent values and zero capacity without estimating", () => {
    expect(render({ state: undefined })).toContain("Not reported");
    expect(contextUsage(null)).toBe("Not reported");
    expect(contextUsage({ used: 0, size: 0, reportedAt: at })).toBe("0 / 0 tokens");
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
