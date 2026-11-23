import { useId } from "react";
import type { ApplicationClient, UpdateAction, UpdateState } from "../bridge/index.js";
import { SettingsCard, SettingsHeader } from "./settings-layout.js";

const manual: UpdateState = {
  revision: 0,
  status: "unavailable",
  version: null,
  percent: 0,
  autoCheck: false,
  message: "Updates are installed manually.",
};
export function useUpdates(_api: ApplicationClient) {
  return {
    state: manual,
    error: "",
    savingPreference: false,
    act: async (_action: UpdateAction): Promise<void> => {
      throw new Error("Install updates manually from the terminal.");
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
  void updates;
  return (
    <section id="app-updates" className="settings-section" aria-labelledby={id}>
      <SettingsHeader page="updates" id={id} />
      <SettingsCard>
        <p>
          Code60 updates are installed manually from the terminal. Your histories, databases and
          worktrees are kept.
        </p>
        <ol>
          <li>
            Stop active work with <code>code60 service stop</code>.
          </li>
          <li>Install the new Code60 npm package.</li>
          <li>
            Run <code>code60 service repair</code>, then <code>code60 service start</code>.
          </li>
          <li>
            Run <code>code60 open</code> to reconnect.
          </li>
        </ol>
      </SettingsCard>
    </section>
  );
}
