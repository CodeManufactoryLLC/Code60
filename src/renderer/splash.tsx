import { ComposedModal, FeatureFlags, ModalBody } from "@carbon/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { ApplicationClient, Snapshot } from "../bridge/index.js";
import { AgentSetupWizard } from "./agent-setup.js";
import type { Theme } from "./appearance.js";
import { Button as AppButton } from "./carbon/button.js";
import { DatabaseNotice } from "./database-notice.js";
import { hasOrchestrationProvider } from "./snapshot-state.js";

export function Splash({
  onSetupChange,
  windowControls,
  ready,
  snapshot,
  api,
  busy,
  error,
  theme,
  onThemeChange,
  onEnter,
  onConnectDatabase,
  onOpenWebServer,
}: {
  onSetupChange?(open: boolean): void;
  windowControls?: ReactNode;
  ready: boolean;
  snapshot: Snapshot | undefined;
  api: ApplicationClient;
  busy: boolean;
  error: string;
  theme: Theme;
  onThemeChange(theme: Theme): void;
  onEnter(): void;
  onConnectDatabase(): void;
  onOpenWebServer?(): void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const setupButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const configured = hasOrchestrationProvider(snapshot);
  const providerLoaded = snapshot !== undefined;
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    onSetupChange?.(setup);
  }, [setup, onSetupChange]);
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
      <FeatureFlags flags={{ "enable-dialog-element": true }}>
        <ComposedModal
          open
          preventCloseOnClickOutside
          isFullWidth
          className="splash-overlay"
          containerClassName="splash"
          data-theme={theme}
          data-ready={ready}
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-subtitle`}
          onClose={() => {
            if (configured) enter();
            return false;
          }}
        >
          <ModalBody ref={dialog} className="splash-body">
            {!setup && windowControls}
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
                    Code60
                  </span>
                  <p id={`${id}-subtitle`} className="splash-subtitle">
                    {configured ? "Workspace setup" : "Connect a provider to start working"}
                  </p>
                  {ready && (
                    <>
                      {error && (
                        <p className="error-banner" role="alert">
                          {error}
                        </p>
                      )}
                      {!configured && onOpenWebServer && (
                        <AppButton type="button" disabled={busy} onClick={onOpenWebServer}>
                          Web Server Beta
                        </AppButton>
                      )}
                      {configured ? (
                        <AppButton
                          type="button"
                          className="splash-enter"
                          disabled={busy}
                          onClick={enter}
                        >
                          Start
                        </AppButton>
                      ) : (
                        <AppButton
                          type="button"
                          className="splash-enter"
                          ref={setupButton}
                          disabled={busy}
                          onClick={enter}
                        >
                          Set up agents
                        </AppButton>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="window-drag-strip" aria-hidden="true" />
            {ready && <SplashThemeToggle theme={theme} onChange={onThemeChange} />}
          </ModalBody>
        </ComposedModal>
      </FeatureFlags>
      {setup && snapshot && (
        <AgentSetupWizard
          snapshot={snapshot}
          windowControls={windowControls}
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
      <AppButton
        type="button"
        aria-label="Light mode"
        aria-pressed={!dark}
        onClick={() => onChange("light")}
      >
        Light
      </AppButton>
      <AppButton
        type="button"
        aria-label="Dark mode"
        aria-pressed={dark}
        onClick={() => onChange("dark")}
      >
        Dark
      </AppButton>
    </div>
  );
}
