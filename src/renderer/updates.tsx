import { useId } from "react";
import type { ApplicationClient, UpdateAction, UpdateState } from "../bridge/index.js";
import { SettingsCard, SettingsHeader } from "./settings-layout.js";

const terminal: UpdateState = {
  revision: 0,
  status: "unavailable",
  version: null,
  percent: 0,
  autoCheck: false,
  message: "Run code60 update in a terminal to check and install a stable release.",
};
export function useUpdates(_api: ApplicationClient, version?: string) {
  return {
    state: { ...terminal, version: version ?? null },
    error: "",
    savingPreference: false,
    act: async (_action: UpdateAction): Promise<void> => {
      throw new Error("Run code60 update in the terminal.");
    },
  };
}
export function useUpdateNotice(_state: UpdateState | undefined, _enabled: boolean) {
  return { notice: null, dismiss() {} };
}
export function UpdateIndicator(_props: { state: UpdateState | undefined; onOpen(): void }) {
  return null;
}

export function UpdatesSection({ updates }: { updates: ReturnType<typeof useUpdates> }) {
  const id = useId();
  return (
    <section id="app-updates" className="settings-section" aria-labelledby={id}>
      <SettingsHeader page="updates" id={id} />
      <SettingsCard title="Installed release">
        <p>Installed version: {updates.state.version ?? "Unavailable"}</p>
        <p>
          Run <code>code60 update</code> in a terminal to check and install the latest stable
          release. It verifies the download before asking to stop interactive and scheduled work.
          Your histories, databases, worktrees and pinned workflow engines are kept.
        </p>
      </SettingsCard>
      <SettingsCard title="Reconnect and recover">
        <p>
          After updating, run <code>code60 open</code> to reconnect. For an interrupted update, use
          <code> code60 update status</code> and <code>code60 update recover</code> in the terminal.
        </p>
      </SettingsCard>
    </section>
  );
}
