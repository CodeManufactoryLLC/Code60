import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DesktopApi, UpdateAction, UpdateState } from "../bridge/index.js";
import { Icon } from "./icons.js";

export function useUpdates(api: DesktopApi) {
  const [state, setState] = useState<UpdateState>();
  const [error, setError] = useState("");
  const [savingPreference, setSavingPreference] = useState<boolean>();
  useEffect(() => {
    let alive = true;
    const receive = (next: UpdateState) => {
      if (alive)
        setState((current) => (!current || next.revision >= current.revision ? next : current));
    };
    const unsubscribe = api.onUpdate(receive);
    api
      .update("status")
      .then(receive)
      .catch(() => {
        if (alive) setError("Could not load update status.");
      });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [api]);
  const act = useCallback(
    async (action: UpdateAction) => {
      setError("");
      const preference = action === "auto-on" || action === "auto-off";
      if (preference) setSavingPreference(action === "auto-on");
      try {
        const next = await api.update(action);
        setState((current) => (!current || next.revision >= current.revision ? next : current));
      } catch {
        setError("Could not complete the update action. Try again.");
      } finally {
        if (preference) setSavingPreference(undefined);
      }
    },
    [api],
  );
  return {
    state:
      state && savingPreference !== undefined ? { ...state, autoCheck: savingPreference } : state,
    savingPreference: savingPreference !== undefined,
    error,
    act,
  };
}

export function useUpdateNotice(state: UpdateState | undefined, enabled: boolean) {
  const [notice, setNotice] = useState<string | null>(null);
  const shown = useRef(new Set<string>());
  useEffect(() => {
    const version = state?.version;
    if (!enabled || state?.status !== "available" || !version || shown.current.has(version)) return;
    const key = `code60.updateNotice.${version}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      // Still show only once in this renderer if storage is unavailable.
    }
    const show = () => {
      if (document.querySelector("dialog[open]")) return;
      shown.current.add(version);
      try {
        localStorage.setItem(key, "shown");
      } catch {}
      setNotice(version);
      observer.disconnect();
    };
    // Wait for an existing dialog to close instead of covering it with another modal.
    const observer = new MutationObserver(show);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    show();
    return () => observer.disconnect();
  }, [state?.status, state?.version, enabled]);
  return {
    notice: enabled && state?.status === "available" && notice === state.version ? notice : null,
    dismiss: () => setNotice(null),
  };
}

export function UpdateIndicator({
  state,
  onOpen,
}: {
  state: UpdateState | undefined;
  onOpen(): void;
}) {
  if (!state || !["available", "downloading", "ready", "installing"].includes(state.status))
    return null;
  const label =
    state.status === "ready"
      ? "Ready to install"
      : state.status === "downloading"
        ? `Downloading update ${state.percent}%`
        : state.status === "installing"
          ? "Installing update…"
          : "Update available";
  return (
    <button
      type="button"
      className="update-indicator"
      onClick={onOpen}
      title={`Code60 ${state.version}`}
    >
      <Icon name="renew" />
      {label}
    </button>
  );
}

export function UpdatesSection({ updates }: { updates: ReturnType<typeof useUpdates> }) {
  const id = useId();
  const { state, error, act } = updates;
  return (
    <section id="app-updates" className="settings-section" aria-labelledby={id}>
      <h2 id={id}>Updates</h2>
      <label className="settings-row">
        Automatically check for updates
        <input
          type="checkbox"
          role="switch"
          checked={state?.autoCheck ?? true}
          aria-checked={state?.autoCheck ?? true}
          disabled={!state || updates.savingPreference || state.status === "installing"}
          onChange={(event) => void act(event.target.checked ? "auto-on" : "auto-off")}
        />
      </label>
      <p role="status">{state?.message ?? "Loading update status…"}</p>
      {error && <p role="alert">{error}</p>}
      {state?.status === "downloading" && (
        <>
          <progress aria-label="Update download" value={state.percent} max={100} />
          <span> {state.percent}%</span>
        </>
      )}
      <div className="button-group">
        <button
          type="button"
          disabled={!state || !["idle", "available", "error"].includes(state.status)}
          onClick={() => void act("check")}
        >
          Check for updates
        </button>
        {state?.status === "available" && (
          <button type="button" onClick={() => void act("download")}>
            Download update
          </button>
        )}
        {state?.status === "downloading" && (
          <button type="button" onClick={() => void act("cancel")}>
            Cancel download
          </button>
        )}
        {state?.status === "ready" && (
          <button type="button" onClick={() => void act("install")}>
            Install and restart
          </button>
        )}
      </div>
      <p>
        Updates are downloaded only when you choose. Your settings, databases and worktrees are
        preserved.
      </p>
    </section>
  );
}
