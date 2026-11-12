import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { AgentSetupSession, DesktopApi, Snapshot } from "../bridge/index.js";
import { AgentSetupWizard } from "./agent-setup.js";
import { OrchestrationSettings } from "./orchestration-settings.js";

function snapshot(phase: AgentSetupSession["phase"], detected = false): Snapshot {
  return {
    revision: 1,
    agentSetup: {
      complete: false,
      primary: null,
      enabled: [],
      providers: [
        { id: "claude", name: "Claude", logo: "claude", guidance: "Log in with the CLI." },
      ],
      session: {
        id: "01900000-0000-4000-8000-000000000001",
        mode: "primary",
        role: "primary",
        candidate: phase === "select" ? null : "claude",
        phase,
        detected,
        error: phase === "failed" ? "Authentication failed" : null,
        primary: null,
        verified: [],
      },
    },
  } as unknown as Snapshot;
}

function render(phase: AgentSetupSession["phase"], detected = false) {
  return renderToStaticMarkup(
    <AgentSetupWizard
      snapshot={snapshot(phase, detected)}
      api={{} as DesktopApi}
      mode="primary"
      onClose={() => {}}
    />,
  );
}

it("starts with connector buttons and no confirmation or review controls", () => {
  const html = render("select");
  expect(html).toContain("Select your Primary / Orchestrator");
  expect(html).toContain('class="agent-choice"');
  expect(html).not.toMatch(/Continue|Finish setup|Review agents|Yes,|No,/);
});

it.each([
  ["detecting", "Detecting Claude…"],
  ["connecting", "Connecting to Claude…"],
] as const)("shows %s progress and cancellation without another confirmation", (phase, status) => {
  const html = render(phase, phase === "connecting");
  expect(html).toContain(status);
  expect(html).toContain("Cancel attempt");
  expect(html).not.toMatch(/Finish setup|Review agents|Yes,|No,/);
});

it("offers Close and Retry directly on a failed connection", () => {
  const html = render("failed", true);
  expect(html).toContain('role="alert">Authentication failed');
  expect(html).toContain("Log in with the CLI.");
  expect(html).toContain(">Close</button>");
  expect(html).toContain(">Retry</button>");
  expect(html).not.toContain("Connected");
});

it("does not present an unsaved verification as a completed connection", () => {
  const html = render("success", true);
  expect(html).toContain("Saving connection…");
  expect(html).not.toContain("Connected");
  expect(html).not.toMatch(/Finish setup|Review agents|Yes,|No,/);
});

it.each([false, true])("recovers a Settings setup session only when active is %s", (active) => {
  const state = snapshot("select");
  if (!state.agentSetup) throw new Error("Missing fixture setup");
  state.agentSetup.complete = true;
  state.agentSetup.primary = "claude";
  state.agentSetup.enabled = ["claude"];
  const html = renderToStaticMarkup(
    <OrchestrationSettings snapshot={state} api={{} as DesktopApi} active={active} />,
  );
  expect(html.includes("agent-setup-dialog")).toBe(active);
});
