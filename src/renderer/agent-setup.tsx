import { useEffect, useId, useRef, useState } from "react";
import type { DesktopApi, SetupBegin, Snapshot } from "../bridge/index.js";
import { AgentLogo } from "./agent-logo.js";
import { Icon } from "./icons.js";

export { AgentLogo } from "./agent-logo.js";

export function AgentSetupWizard({
  snapshot,
  api,
  mode,
  onClose,
}: {
  snapshot: Snapshot;
  api: DesktopApi;
  mode: SetupBegin["mode"];
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const started = useRef(false);
  const id = useId();
  const attemptInFlight = useRef(false);
  const [pending, setPending] = useState<{ provider: string; revision: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const setup = snapshot.agentSetup;
  const session = setup?.session;
  const providers = setup?.providers ?? [];
  const starting =
    pending !== null &&
    (snapshot.revision <= pending.revision || session?.candidate !== pending.provider);
  const candidate = providers.find(
    (p) => p.id === (starting ? pending?.provider : session?.candidate),
  );
  const busy = starting || session?.phase === "detecting" || session?.phase === "connecting";
  const success = session?.phase === "success" && !adding && !starting;
  const choosing = !starting && !review && (!session || session.phase === "select" || adding);
  const heading = review
    ? "Your agents"
    : success
      ? "Would you like to connect another agent?"
      : choosing
        ? session?.primary || mode === "add"
          ? "Connect another agent"
          : "Select your Primary / Orchestrator"
        : `Connect ${candidate?.name ?? "agent"}`;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    if (title.current?.textContent === heading) title.current.focus();
  }, [heading]);
  useEffect(() => {
    if (pending && snapshot.revision > pending.revision && session?.candidate === pending.provider)
      setPending(null);
  }, [pending, snapshot.revision, session?.candidate]);
  useEffect(() => {
    if (started.current || session) return;
    started.current = true;
    void api.beginAgentSetup({ mode }).catch((cause: unknown) => setError(String(cause)));
  }, [api, mode, session]);
  async function invoke(action: () => Promise<void>) {
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  async function close() {
    if (saving) return;
    await invoke(async () => {
      if (session) await api.abandonAgentSetup({ sessionId: session.id });
      onClose();
    });
  }
  async function attempt(provider: string) {
    if (!session || !provider || busy || attemptInFlight.current) return;
    attemptInFlight.current = true;
    setAdding(false);
    setPending({ provider, revision: snapshot.revision });
    setError("");
    try {
      await api.attemptAgentSetup({ sessionId: session.id, provider });
    } catch (cause) {
      setPending(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      attemptInFlight.current = false;
    }
  }
  async function finish() {
    if (!session) return;
    setSaving(true);
    await invoke(async () => {
      await api.finishAgentSetup({ sessionId: session.id });
      onClose();
    });
    setSaving(false);
  }
  return (
    <dialog
      ref={dialog}
      className="setup-dialog agent-setup-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        void close();
      }}
    >
      <div className="modal-heading">
        <h2 id={id} ref={title} tabIndex={-1}>
          {heading}
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close agent setup"
          disabled={saving}
          onClick={() => void close()}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="agent-setup-body">
        {choosing && (
          <fieldset className="agent-choices" disabled={!session || saving}>
            <legend className="sr-only">{heading}</legend>
            {providers
              .filter((p) => !session?.verified.includes(p.id))
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="agent-choice"
                  onClick={() => void attempt(p.id)}
                  onKeyDown={(event) => {
                    const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"];
                    if (!keys.includes(event.key)) return;
                    event.preventDefault();
                    const cards = Array.from(
                      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                        ".agent-choice:not(:disabled)",
                      ) ?? [],
                    );
                    const index = cards.indexOf(event.currentTarget);
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? cards.length - 1
                          : (index +
                              (event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1) +
                              cards.length) %
                            cards.length;
                    cards[next]?.focus();
                  }}
                >
                  <AgentLogo id={p.logo} />
                  <span>{p.name}</span>
                </button>
              ))}
          </fieldset>
        )}
        {!choosing && !review && candidate && (
          <div className="agent-connection">
            <div className="agent-identity">
              <AgentLogo id={candidate.logo} />
              <span>{candidate.name}</span>
              {!starting && session?.phase === "success" ? (
                <span className="agent-status">
                  <Icon name="checkmark" />
                  Connected
                </span>
              ) : !starting && session?.detected ? (
                <span className="agent-status">
                  <Icon name="checkmark" />
                  Detected
                </span>
              ) : null}
            </div>
            <p role="status" aria-live="polite">
              {starting || session?.phase === "detecting"
                ? `Detecting ${candidate.name}…`
                : session?.phase === "connecting"
                  ? `Connecting to ${candidate.name}…`
                  : success
                    ? `${candidate.name} connected`
                    : ""}
            </p>
            {busy && (
              <progress
                aria-label={session?.phase === "detecting" ? "Detecting agent" : "Connecting agent"}
              />
            )}
            {!starting && session?.phase === "failed" && (
              <>
                <p role="alert">{session.error}</p>
                <section aria-label="Connection help">
                  <p>{candidate.guidance}</p>
                </section>
              </>
            )}
          </div>
        )}
        {review && (
          <ul className="agent-review">
            {session?.verified.map((provider) => {
              const p = providers.find((p) => p.id === provider);
              return (
                <li className="agent-review-item" key={provider}>
                  <AgentLogo id={p?.logo ?? provider} />
                  <span>
                    {p?.name ?? provider}
                    <small>
                      {provider === session.primary ? "Primary / Orchestrator" : "Additional agent"}
                    </small>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="modal-footer">
        {busy ? (
          <button
            type="button"
            onClick={() =>
              session &&
              void invoke(async () => {
                await api.cancelAgentSetup({ sessionId: session.id });
                setPending(null);
              })
            }
          >
            Cancel attempt
          </button>
        ) : review ? (
          <>
            <button type="button" disabled={saving} onClick={() => setReview(false)}>
              Back
            </button>
            <button
              type="button"
              className="primary"
              disabled={saving}
              onClick={() => void finish()}
            >
              {saving ? "Saving…" : "Finish setup"}
            </button>
          </>
        ) : success ? (
          <>
            <button type="button" onClick={() => setReview(true)}>
              No, finish setup
            </button>
            <button
              type="button"
              className="primary"
              disabled={providers.every((p) => session?.verified.includes(p.id))}
              onClick={() => {
                setAdding(true);
              }}
            >
              Yes, add another
            </button>
          </>
        ) : session?.phase === "failed" ? (
          <>
            <button
              type="button"
              onClick={() =>
                void invoke(async () => {
                  if (session) await api.cancelAgentSetup({ sessionId: session.id });
                  setAdding(true);
                })
              }
            >
              Choose another agent
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => candidate && void attempt(candidate.id)}
            >
              Retry
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => void close()}>
              Cancel
            </button>
            {session?.primary && (
              <button type="button" onClick={() => setReview(true)}>
                Review agents
              </button>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
