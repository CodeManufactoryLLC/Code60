import { useEffect, useId, useRef, useState } from "react";
import type { DesktopApi, Snapshot } from "../bridge/index.js";
import { AgentSetupWizard } from "./agent-setup.js";
import type { Theme } from "./appearance.js";
import { DatabaseNotice } from "./database-notice.js";
import { hasOrchestrationProvider } from "./snapshot-state.js";

export function Splash({
  ready,
  snapshot,
  api,
  busy,
  error,
  theme,
  onThemeChange,
  onEnter,
  onConnectDatabase,
}: {
  ready: boolean;
  snapshot: Snapshot | undefined;
  api: DesktopApi;
  busy: boolean;
  error: string;
  theme: Theme;
  onThemeChange(theme: Theme): void;
  onEnter(): void;
  onConnectDatabase(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const setupButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const configured = hasOrchestrationProvider(snapshot);
  const providerLoaded = snapshot !== undefined;
  const [setup, setSetup] = useState(false);
  // Keep the workspace behind the splash inert; nested native modals remain usable.
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    if (!ready || setup) return;
    if (configured && !snapshot?.database)
      dialog.current?.querySelector<HTMLButtonElement>(".database-notice button")?.focus();
    else if (configured) dialog.current?.querySelector<HTMLButtonElement>(".splash-enter")?.focus();
    else setupButton.current?.focus();
  }, [ready, configured, snapshot?.database, setup]);
  useEffect(() => {
    if (ready && !configured && providerLoaded) setSetup(true);
  }, [ready, configured, providerLoaded]);
  const enter = () => {
    if (!ready || busy) return;
    if (!configured) setSetup(true);
    else onEnter();
  };
  return (
    <>
      <dialog
        ref={dialog}
        className="splash"
        data-theme={theme}
        data-ready={ready}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-subtitle`}
        onCancel={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          if (configured) enter();
        }}
      >
        <div className="splash-brand">
          {ready && snapshot && !snapshot.database && (
            <DatabaseNotice
              busy={busy}
              error={snapshot.databaseError}
              onConnect={onConnectDatabase}
            />
          )}
          <div className="splash-logo">
            <div className="splash-lockup">
              <span id={`${id}-title`} className="wordmark splash-title">
                Code<b>60</b>
              </span>
              <p id={`${id}-subtitle`} className="splash-subtitle">
                v0.2 'Paddock' (Beta)
              </p>
              {ready && (
                <>
                  {error && (
                    <p className="error-banner" role="alert">
                      {error}
                    </p>
                  )}
                  {configured ? (
                    <button type="button" className="splash-enter" disabled={busy} onClick={enter}>
                      Start
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="splash-enter"
                      ref={setupButton}
                      disabled={busy}
                      onClick={enter}
                    >
                      Set up agents
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        <div className="window-drag-strip" aria-hidden="true" />
        {ready && <SplashThemeToggle theme={theme} onChange={onThemeChange} />}
      </dialog>
      {setup && snapshot && (
        <AgentSetupWizard
          snapshot={snapshot}
          api={api}
          mode="primary"
          onClose={() => setSetup(false)}
        />
      )}
    </>
  );
}

function SplashThemeToggle({ theme, onChange }: { theme: Theme; onChange(theme: Theme): void }) {
  const [systemDark, setSystemDark] = useState(
    () =>
      typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);
  const dark = theme === "dark" || (theme === "system" && systemDark);
  return (
    // biome-ignore lint/a11y/useSemanticElements: These buttons select appearance, not form inputs.
    <div className="button-group splash-theme-toggle" role="group" aria-label="Color theme">
      <button
        type="button"
        aria-label="Light mode"
        aria-pressed={!dark}
        onClick={() => onChange("light")}
      >
        Light
      </button>
      <button
        type="button"
        aria-label="Dark mode"
        aria-pressed={dark}
        onClick={() => onChange("dark")}
      >
        Dark
      </button>
    </div>
  );
}
