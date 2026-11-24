import { ProgressBar } from "@carbon/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  type ApplicationClient,
  type ProviderLoginChallenge,
  type ProviderLoginMethod,
  type ProviderSetupIdentity,
  providerLoginChallengeSchema,
  type SetupBegin,
  type SetupProviderId,
  type Snapshot,
} from "../bridge/index.js";
import { AgentLogo } from "./agent-logo.js";
import { copyText } from "./browser-platform.js";
import { Button as AppButton } from "./carbon/button.js";
import { Select, TextInput } from "./carbon/fields.js";
import { Icon } from "./icons.js";
import { Modal } from "./modal.js";

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
  const started = useRef(false);
  const closing = useRef(false);
  const attemptInFlight = useRef(false);
  const [pending, setPending] = useState<{ provider: string; revision: number } | null>(null);
  const [connected, setConnected] = useState<string | null>(null);
  const saveInFlight = useRef(false);
  const autoSaveSession = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loginStarting, setLoginStarting] = useState(false);
  const [loginAttempt, setLoginAttempt] = useState<ProviderSetupIdentity | null>(null);
  const [challenge, setChallenge] = useState<ProviderLoginChallenge | null>(null);
  const [method, setMethod] = useState<ProviderLoginMethod>("default");
  const [authorizationCode, setAuthorizationCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const setup = snapshot.agentSetup;
  const session = setup?.session;
  const providers = setup?.providers ?? [];
  const starting =
    pending !== null &&
    (snapshot.revision <= pending.revision || session?.candidate !== pending.provider);
  const candidate = providers.find(
    (p) => p.id === (starting ? pending?.provider : (session?.candidate ?? connected)),
  );
  useEffect(() => {
    setMethod(candidate?.loginMethods?.[0] ?? "default");
  }, [candidate?.loginMethods?.[0]]);
  const challengeId = challenge?.challengeId ?? null;
  const previousChallenge = useRef<string | null>(null);
  useEffect(() => {
    if (challengeId !== previousChallenge.current) {
      previousChallenge.current = challengeId;
      setAuthorizationCode("");
      setSubmitting(false);
    }
  }, [challengeId]);
  const success = connected !== null;
  const busy =
    starting ||
    saving ||
    loginStarting ||
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
    if (pending && snapshot.revision > pending.revision && session?.candidate === pending.provider)
      setPending(null);
  }, [pending, snapshot.revision, session?.candidate]);
  useEffect(() => {
    // A reopened dialog can briefly see the previous session's retiring snapshot.
    // Only our own begin request consumes this dialog's one-time startup guard.
    if (session || started.current || closing.current || connected || saving) return;
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
    const read =
      api.readProviderSetup ??
      (api.readCodexSetup
        ? async (identity: ProviderSetupIdentity) => {
            const result = await api.readCodexSetup?.({
              sessionId: identity.sessionId,
              attemptId: identity.attemptId,
            });
            return {
              ...result,
              challenge: result?.challenge
                ? { ...result.challenge, kind: "device" as const, challengeId: identity.attemptId }
                : null,
            };
          }
        : undefined);
    if (
      !loginAttempt ||
      !read ||
      session?.id !== loginAttempt.sessionId ||
      !["installing", "authenticating", "connecting"].includes(session.phase)
    )
      return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const progress = await read(loginAttempt);
        if (stopped) return;
        const parsed = providerLoginChallengeSchema.safeParse(progress.challenge);
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
  }, [api, loginAttempt, session?.id, session?.phase]);
  async function invoke(action: () => Promise<void>) {
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  async function close() {
    if (saveInFlight.current || closing.current) return;
    closing.current = true;
    try {
      await invoke(async () => {
        if (session && !connected) await api.abandonAgentSetup({ sessionId: session.id });
        onClose();
      });
    } finally {
      closing.current = false;
    }
  }
  async function attempt(provider: string) {
    if (!session || !provider || busy || attemptInFlight.current) return;
    attemptInFlight.current = true;
    setPending({ provider, revision: snapshot.revision });
    setError("");
    setChallenge(null);
    setLoginAttempt(null);
    try {
      await api.attemptAgentSetup({ sessionId: session.id, provider });
    } catch (cause) {
      setPending(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      attemptInFlight.current = false;
    }
  }
  async function startLogin(install: boolean) {
    const generic = install ? api.installProviderForSetup : api.loginProviderForSetup;
    const legacy = install ? api.installCodexForSetup : api.loginCodexForSetup;
    if (
      !session ||
      !candidate ||
      (!generic && !(candidate.id === "codex" && legacy)) ||
      attemptInFlight.current ||
      busy
    )
      return;
    attemptInFlight.current = true;
    setLoginStarting(true);
    setError("");
    setChallenge(null);
    try {
      const request = { sessionId: session.id, provider: candidate.id as SetupProviderId, method };
      const result = generic ? await generic(request) : await legacy?.({ sessionId: session.id });
      if (result)
        setLoginAttempt({
          sessionId: session.id,
          provider: request.provider,
          attemptId: result.attemptId,
        });
    } catch {
      setError(`Could not start ${candidate.name} setup. Retry.`);
    } finally {
      attemptInFlight.current = false;
      setLoginStarting(false);
    }
  }
  async function submitLogin(accepted?: boolean) {
    if (!loginAttempt || !challenge || !api.submitProviderSetup || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await api.submitProviderSetup({
        ...loginAttempt,
        challengeId: challenge.challengeId,
        answer:
          challenge.kind === "confirmation"
            ? { kind: "confirmation", accepted: accepted === true }
            : { kind: "code", code: authorizationCode.trim() },
      });
      setAuthorizationCode("");
      setChallenge(null);
    } catch {
      setError("Could not submit this sign-in step. Retry or cancel setup.");
    } finally {
      setSubmitting(false);
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
    <Modal
      title={heading}
      className="agent-setup-dialog"
      busy={saving}
      onClose={() => void close()}
      closeLabel="Close provider setup"
      focusHeading
    >
      {windowControls}
      <div className="agent-setup-body">
        {choosing && (
          <fieldset className="agent-choices" disabled={!session || saving}>
            <legend className="sr-only">{heading}</legend>
            {providers
              .filter((p) => !session?.verified.includes(p.id))
              .map((p) => (
                <AppButton
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
                </AppButton>
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
                    ? `Installing ${candidate.name}…`
                    : session?.phase === "authenticating"
                      ? `Waiting for ${candidate.name} sign-in…`
                      : session?.phase === "connecting"
                        ? `Connecting to ${candidate.name}…`
                        : success
                          ? `${candidate.name} connected`
                          : ""}
            </p>
            {challenge && session?.phase === "authenticating" && (
              <section className="codex-device-login" aria-label={`${candidate.name} sign-in`}>
                {challenge.kind !== "confirmation" && (
                  <>
                    {challenge.kind === "device" && (
                      <output aria-label="Device code">{challenge.userCode}</output>
                    )}
                    <div>
                      {challenge.kind === "device" && (
                        <AppButton
                          type="button"
                          onClick={() =>
                            void copyText(challenge.userCode).catch(() =>
                              setError(
                                "Could not copy the device code. Select and copy it instead.",
                              ),
                            )
                          }
                        >
                          Copy code
                        </AppButton>
                      )}
                      <a href={challenge.verificationUrl} target="_blank" rel="noopener noreferrer">
                        Open sign-in page
                      </a>
                    </div>
                  </>
                )}
                {challenge.kind === "code" ? (
                  <form
                    className="provider-code-login"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitLogin();
                    }}
                  >
                    <TextInput
                      labelText="Authorization code"
                      aria-label="Authorization code"
                      value={authorizationCode}
                      onChange={(event) => setAuthorizationCode(event.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={4096}
                    />
                    <AppButton type="submit" disabled={submitting || !authorizationCode.trim()}>
                      Complete sign-in
                    </AppButton>
                    <p>Sign in on the provider’s page, then paste its authorization code here.</p>
                  </form>
                ) : challenge.kind === "confirmation" ? (
                  <>
                    <p>
                      The system keychain is unavailable. Save your Copilot login in a private file
                      on the computer running Code60?
                    </p>
                    <AppButton
                      type="button"
                      disabled={submitting}
                      onClick={() => void submitLogin(true)}
                    >
                      Save login
                    </AppButton>
                    <AppButton
                      type="button"
                      disabled={submitting}
                      onClick={() => void submitLogin(false)}
                    >
                      Don’t save
                    </AppButton>
                  </>
                ) : (
                  <section aria-label="Sign-in help">
                    <p>
                      {challenge.kind === "device"
                        ? "Enter this code on the sign-in page. "
                        : "Complete sign-in on the provider’s page. "}
                      Keep this dialog open until connected.
                    </p>
                  </section>
                )}
              </section>
            )}
            {busy && (
              <ProgressBar
                hideLabel
                label={
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
          <AppButton
            type="button"
            onClick={() =>
              session &&
              void invoke(async () => {
                if (loginAttempt && api.cancelProviderSetup)
                  await api.cancelProviderSetup(loginAttempt);
                else if (loginAttempt && api.cancelCodexSetup)
                  await api.cancelCodexSetup({
                    sessionId: loginAttempt.sessionId,
                    attemptId: loginAttempt.attemptId,
                  });
                else await api.cancelAgentSetup({ sessionId: session.id });
                setLoginAttempt(null);
                setChallenge(null);
                setPending(null);
              })
            }
          >
            Cancel attempt
          </AppButton>
        ) : success ? (
          <>
            <AppButton
              type="button"
              className="primary"
              disabled={saving}
              onClick={() => void close()}
            >
              Close
            </AppButton>
            <AppButton
              type="button"
              disabled={saving || providers.every((p) => setup?.enabled.includes(p.id))}
              onClick={() => void addAnother()}
            >
              Add another provider
            </AppButton>
          </>
        ) : session?.phase === "failed" || (session?.phase === "success" && error) ? (
          <>
            <AppButton type="button" onClick={() => void close()}>
              Close
            </AppButton>
            {session.phase === "failed" && (
              <AppButton
                type="button"
                onClick={() =>
                  void invoke(async () => {
                    if (session) await api.cancelAgentSetup({ sessionId: session.id });
                  })
                }
              >
                Choose another provider
              </AppButton>
            )}
            {candidate &&
              (session.setupAction || session.codexAction) &&
              (api.installProviderForSetup ||
                (candidate.id === "codex" && api.installCodexForSetup)) && (
                <>
                  {(candidate.loginMethods?.length ?? 0) > 1 && (
                    <Select
                      labelText="Sign-in method"
                      aria-label="Sign-in method"
                      value={method}
                      onChange={(event) => setMethod(event.target.value as ProviderLoginMethod)}
                    >
                      {candidate.loginMethods?.map((item) => (
                        <option key={item} value={item}>
                          {
                            {
                              "claude-subscription": "Claude subscription",
                              "claude-console": "Anthropic Console",
                              chatgpt: "ChatGPT",
                              "github-copilot": "GitHub Copilot",
                              default: "Browser sign-in",
                            }[item]
                          }
                        </option>
                      ))}
                    </Select>
                  )}
                  <AppButton
                    type="button"
                    className="primary"
                    onClick={() =>
                      void startLogin((session.setupAction ?? session.codexAction) === "install")
                    }
                  >
                    {(session.setupAction ?? session.codexAction) === "install"
                      ? `Install ${candidate.name} and sign in`
                      : `Sign in to ${candidate.name}`}
                  </AppButton>
                </>
              )}
            <AppButton
              type="button"
              className="primary"
              onClick={() => {
                if (session.phase === "success") void finish();
                else if (candidate) void attempt(candidate.id);
              }}
            >
              Retry
            </AppButton>
          </>
        ) : (
          <AppButton type="button" disabled={saving} onClick={() => void close()}>
            {saving ? "Saving…" : "Close"}
          </AppButton>
        )}
      </div>
    </Modal>
  );
}
