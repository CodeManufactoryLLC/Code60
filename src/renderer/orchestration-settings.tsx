import { useId, useState } from "react";
import type { DesktopApi, Snapshot } from "../bridge/index.js";

export function OrchestrationSettings({
  snapshot,
  api,
  heading = true,
  onSavingChange,
}: {
  snapshot: Snapshot;
  api: DesktopApi;
  heading?: boolean;
  onSavingChange?(saving: boolean): void;
}) {
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const { provider, connection, error: connectionError } = snapshot.orchestration;
  const available = provider !== null && snapshot.agents.includes(provider);
  const testing = connection === "testing";
  async function save(value: string) {
    setSaving(true);
    onSavingChange?.(true);
    setError(undefined);
    try {
      await api.setOrchestrationProvider(value || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
      onSavingChange?.(false);
    }
  }
  async function test() {
    setError(undefined);
    try {
      if (testing) await api.cancelOrchestrationTest();
      else await api.testOrchestrationProvider();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return (
    <section
      className="settings-section"
      aria-labelledby={heading ? id : undefined}
      aria-label={heading ? undefined : "Orchestration"}
    >
      {heading && <h2 id={id}>Orchestration</h2>}
      <div className="settings-row orchestration-provider-row">
        <label htmlFor={`${id}-provider`}>Orchestration provider</label>
        <div className="orchestration-controls">
          <select
            id={`${id}-provider`}
            value={provider ?? ""}
            disabled={saving || testing}
            onChange={(event) => void save(event.target.value)}
          >
            <option value="">None</option>
            {provider && !available && (
              <option value={provider} disabled>
                {provider} (unavailable)
              </option>
            )}
            {snapshot.agents.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={saving || (!testing && (!available || !snapshot.database))}
            data-tooltip={
              !available
                ? "Select an orchestration provider"
                : !snapshot.database
                  ? "Connect to a database first"
                  : undefined
            }
            onClick={() => void test()}
          >
            {testing ? "Cancel test" : "Test connection"}
          </button>
        </div>
      </div>
      <label className="settings-row">
        Allow all actions without asking
        <input type="checkbox" role="switch" checked aria-checked="true" disabled />
      </label>
      {(error || connectionError || (provider && !available)) && (
        <p role="alert">{error || connectionError || `Unavailable provider: ${provider}`}</p>
      )}
      <p role="status" aria-live="polite">
        {testing
          ? "Connecting via ACP…"
          : connection === "connected"
            ? "ACP connection successful"
            : ""}
      </p>
    </section>
  );
}
