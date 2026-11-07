import { useId, useState } from "react";
import type { DesktopApi, Snapshot } from "../bridge/index.js";
import { AgentLogo, AgentSetupWizard } from "./agent-setup.js";

export function OrchestrationSettings({ snapshot, api }: { snapshot: Snapshot; api: DesktopApi }) {
  const id = useId();
  const [mode, setMode] = useState<"primary" | "add" | null>(null);
  const setup = snapshot.agentSetup;
  return (
    <section className="settings-section" aria-labelledby={id}>
      <h2 id={id}>Agents</h2>
      <ul className="agent-review">
        {setup?.enabled.map((provider) => {
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
      <div className="orchestration-controls">
        <button type="button" onClick={() => setMode("primary")}>
          {setup?.complete ? "Change primary" : "Set up agents"}
        </button>
        <button type="button" disabled={!setup?.complete} onClick={() => setMode("add")}>
          Add agents
        </button>
      </div>
      <label className="settings-row">
        Allow all actions without asking
        <input type="checkbox" role="switch" checked aria-checked="true" disabled />
      </label>
      {(mode || (setup?.complete && setup.session)) && (
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
