import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import {
  type ApplicationClient,
  type CodexChallenge,
  codexChallengeSchema,
  type SetupBegin,
  type Snapshot,
} from "../bridge/index.js";
import { AgentLogo } from "./agent-logo.js";
import { Icon } from "./icons.js";
import { DialogContent } from "./neobrutalism/dialog.js";

export function AgentSetupWizard({
  windowControls,
  snapshot,
  api,
  mode,
  onClose,
}: {
  windowControls?: ReactNode;
  snapshot: Snapshot;
  api: ApplicationClient;
  mode: SetupBegin["mode"];
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const started = useRef(false);
  const id = useId();
  const attemptInFlight = useRef(false);
  const [pending, setPending] = useState<{ provider: string; revision: number } | null>(null);
  const [connected, setConnected] = useState<string | null>(null);
  const saveInFlight = useRef(false);
  const autoSaveSession = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [codexStarting, setCodexStarting] = useState(false);
  const [codexAttempt, setCodexAttempt] = useState<{ sessionId: string; attemptId: string } | null>(
    null,
  );
  const [challenge, setChallenge] = useState<CodexChallenge | null>(null);
  const setup = snapshot.agentSetup;
  const session = setup?.session;
  const providers = setup?.providers ?? [];
  const starting =
    pending !== null &&
    (snapshot.revision <= pending.revision || session?.candidate !== pending.provider);
  const candidate = providers.find(
    (p) => p.id === (starting ? pending?.provider : (session?.candidate ?? connected)),
  );
  const success = connected !== null;
  const busy =
    starting ||
    saving ||
    codexStarting ||
    session?.phase === "installing" ||
    session?.phase === "authenticating" ||
    session?.phase === "detecting" ||
    session?.phase === "connecting" ||
    (session?.phase === "success" && !success && !error);
  const choosing = !busy && !success && (!session || session.phase === "select");
  const heading = choosing
    ? setup?.complete || mode === "add"
      ? "Connect another provider"
      : "Select your Primary Provider"
    : `Connect ${candidate?.name ?? "provider"}`;
  const finish = useCallback(async () => {
    if (!session?.id || !session.candidate || saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setError("");
    try {
      await api.finishAgentSetup({ sessionId: session.id });
      setConnected(session.candidate);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }, [api, session?.id, session?.candidate]);
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
    if (session) started.current = true;
    if (started.current || connected || saving) return;
    started.current = true;
    void api.beginAgentSetup({ mode }).catch((cause: unknown) => setError(String(cause)));
  }, [api, mode, session, connected, saving]);
  useEffect(() => {
    if (session?.phase !== "success" || autoSaveSession.current === session.id) return;
    autoSaveSession.current = session.id;
    void finish();
  }, [session?.phase, session?.id, finish]);
  useEffect(() => {
    setChallenge(null);
    const read = api.readCodexSetup;
    if (
      !codexAttempt ||
      !read ||
      session?.id !== codexAttempt.sessionId ||
      !["installing", "authenticating", "connecting"].includes(session.phase)
    )
      return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const progress = await read(codexAttempt);
        if (stopped) return;
        const parsed = codexChallengeSchema.safeParse(progress.challenge);
        setChallenge(progress.phase === "authenticating" && parsed.success ? parsed.data : null);
      } catch {
        if (!stopped) setChallenge(null);
      }
      if (!stopped) timer = setTimeout(() => void poll(), 1_000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api, codexAttempt, session?.id, session?.phase]);
  async function invoke(action: () => Promise<void>) {
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  async function close() {
    if (saveInFlight.current) return;
    await invoke(async () => {
      if (session && !connected) await api.abandonAgentSetup({ sessionId: session.id });
      onClose();
    });
  }
  async function attempt(provider: string) {
    if (!session || !provider || busy || attemptInFlight.current) return;
    attemptInFlight.current = true;
    setPending({ provider, revision: snapshot.revision });
    setError("");
    setChallenge(null);
    setCodexAttempt(null);
    try {
      await api.attemptAgentSetup({ sessionId: session.id, provider });
    } catch (cause) {
      setPending(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      attemptInFlight.current = false;
    }
  }
  async function startCodex(install: boolean) {
    const start = install ? api.installCodexForSetup : api.loginCodexForSetup;
    if (!session || !start || attemptInFlight.current || busy) return;
    attemptInFlight.current = true;
    setCodexStarting(true);
    setError("");
    setChallenge(null);
    try {
      const result = await start({ sessionId: session.id });
      setCodexAttempt({ sessionId: session.id, attemptId: result.attemptId });
    } catch {
      setError("Could not start Codex setup. Retry.");
    } finally {
      attemptInFlight.current = false;
      setCodexStarting(false);
    }
  }
  async function addAnother() {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    await invoke(async () => {
      await api.beginAgentSetup({ mode: "add" });
      setConnected(null);
    });
    saveInFlight.current = false;
    setSaving(false);
  }
  return (
    <DialogContent
      ref={dialog}
      className="setup-dialog agent-setup-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        void close();
      }}
    >
      {windowControls}
      <div className="modal-heading">
        <h2 id={id} ref={title} tabIndex={-1}>
          {heading}
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close provider setup"
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
        {!choosing && candidate && (
          <div className="agent-connection">
            <div className="agent-identity">
              <AgentLogo id={candidate.logo} />
              <span>{candidate.name}</span>
              {success ? (
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
                : saving || (session?.phase === "success" && !error)
                  ? success
                    ? `${candidate.name} connected`
                    : "Saving connection…"
                  : session?.phase === "installing"
                    ? "Installing Codex…"
                    : session?.phase === "authenticating"
                      ? "Waiting for Codex sign-in…"
                      : session?.phase === "connecting"
                        ? `Connecting to ${candidate.name}…`
                        : success
                          ? `${candidate.name} connected`
                          : ""}
            </p>
            {challenge && session?.phase === "authenticating" && (
              <section className="codex-device-login" aria-label="Codex sign-in">
                <output aria-label="Device code">{challenge.userCode}</output>
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(challenge.userCode)
                        .catch(() =>
                          setError("Could not copy the device code. Select and copy it instead."),
                        )
                    }
                  >
                    Copy code
                  </button>
                  <a href={challenge.verificationUrl} target="_blank" rel="noopener noreferrer">
                    Open sign-in page
                  </a>
                </div>
                <section aria-label="Sign-in help">
                  <p>Enter this code on the sign-in page. Keep this dialog open until connected.</p>
                </section>
              </section>
            )}
            {busy && (
              <progress
                aria-label={
                  session?.phase === "detecting" ? "Detecting provider" : "Connecting provider"
                }
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
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="modal-footer">
        {busy && !saving ? (
          <button
            type="button"
            onClick={() =>
              session &&
              void invoke(async () => {
                if (codexAttempt && api.cancelCodexSetup) await api.cancelCodexSetup(codexAttempt);
                else await api.cancelAgentSetup({ sessionId: session.id });
                setCodexAttempt(null);
                setChallenge(null);
                setPending(null);
              })
            }
          >
            Cancel attempt
          </button>
        ) : success ? (
          <>
            <button
              type="button"
              className="primary"
              disabled={saving}
              onClick={() => void close()}
            >
              Close
            </button>
            <button
              type="button"
              disabled={saving || providers.every((p) => setup?.enabled.includes(p.id))}
              onClick={() => void addAnother()}
            >
              Add another provider
            </button>
          </>
        ) : session?.phase === "failed" || (session?.phase === "success" && error) ? (
          <>
            <button type="button" onClick={() => void close()}>
              Close
            </button>
            {session.phase === "failed" && (
              <button
                type="button"
                onClick={() =>
                  void invoke(async () => {
                    if (session) await api.cancelAgentSetup({ sessionId: session.id });
                  })
                }
              >
                Choose another provider
              </button>
            )}
            {candidate?.id === "codex" &&
              session.codexAction &&
              (session.codexAction === "install"
                ? api.installCodexForSetup
                : api.loginCodexForSetup) && (
                <button
                  type="button"
                  className="primary"
                  onClick={() => void startCodex(session.codexAction === "install")}
                >
                  {session.codexAction === "install"
                    ? "Install Codex and sign in"
                    : "Sign in to Codex"}
                </button>
              )}
            <button
              type="button"
              className="primary"
              onClick={() => {
                if (session.phase === "success") void finish();
                else if (candidate) void attempt(candidate.id);
              }}
            >
              Retry
            </button>
          </>
        ) : (
          <button type="button" disabled={saving} onClick={() => void close()}>
            {saving ? "Saving…" : "Close"}
          </button>
        )}
      </div>
    </DialogContent>
  );
}
