import { useId, useState } from "react";
import type { DesktopApi, Snapshot } from "../bridge/index.js";
import { AgentLogo, AgentSetupWizard } from "./agent-setup.js";
import { SettingsCard, SettingsHeader } from "./settings-layout.js";

export function OrchestrationSettings({
  snapshot,
  api,
  active,
}: {
  snapshot: Snapshot;
  api: DesktopApi;
  active: boolean;
}) {
  const id = useId();
  const [mode, setMode] = useState<"primary" | "add" | null>(null);
  const setup = snapshot.agentSetup;
  return (
    <section className="settings-section" aria-labelledby={id}>
      <SettingsHeader id={id} title="Agents">
        <button type="button" onClick={() => setMode("primary")}>
          {setup?.complete ? "Change primary" : "Set up agents"}
        </button>
        <button type="button" disabled={!setup?.complete} onClick={() => setMode("add")}>
          Add agents
        </button>
      </SettingsHeader>
      <SettingsCard title="Connected agents">
        {setup?.enabled.length ? (
          <ul className="agent-review">
            {setup.enabled.map((provider) => {
              const p = setup.providers.find((p) => p.id === provider);
              return (
                <li className="agent-review-item" key={provider}>
                  <AgentLogo id={p?.logo ?? provider} />
                  <span>
                    {p?.name ?? provider}
                    <small>
                      {provider === setup.primary ? "Primary / Orchestrator" : "Additional agent"}
                    </small>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="settings-empty">No agents set up yet.</p>
        )}
      </SettingsCard>
      <SettingsCard title="Permissions">
        <label className="settings-row">
          Code60 auto-approval
          <input type="checkbox" role="switch" checked aria-checked="true" disabled />
        </label>
      </SettingsCard>
      {active && (mode || (setup?.complete && setup.session)) && (
        <AgentSetupWizard
          snapshot={snapshot}
          api={api}
          mode={mode ?? setup?.session?.mode ?? "primary"}
          onClose={() => setMode(null)}
        />
      )}
    </section>
  );
}
