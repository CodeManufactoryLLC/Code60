import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  type BrowserSession,
  confirmationPresentation,
  connectionStatusSchema,
  GATEWAY_VERSION,
  type GatewayFrame,
  type Interaction,
  type InteractionAnswer,
} from "../bridge/index.js";
import { App } from "./app.js";
import { useAppPreferences } from "./app-preferences.js";
import {
  browserRequest,
  connectBrowser,
  createBrowserClient,
  pairBrowser,
  saveBrowserSession,
  savedBrowserSession,
} from "./browser-client.js";
import { randomId } from "./browser-platform.js";
import { Button as AppButton } from "./carbon/button.js";
import { TextInput as CarbonTextInput } from "./carbon/fields.js";
import { Modal } from "./modal.js";

const HostPicker = lazy(() => import("./host-picker.js"));

function BrowserInteraction({
  session,
  interaction,
  onDone,
}: {
  session: BrowserSession;
  interaction: Interaction;
  onDone(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const answer = async (accepted: boolean, choice?: string, filename?: string) => {
    setBusy(true);
    setError("");
    const value: InteractionAnswer = {
      id: interaction.id,
      accepted,
      ...(choice ? { choice } : {}),
      ...(filename ? { filename } : {}),
    };
    try {
      await browserRequest("/api/interaction", session, value);
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The decision could not be completed.");
    } finally {
      setBusy(false);
    }
  };
  if (interaction.kind === "pick")
    return (
      <Suspense fallback={null}>
        <HostPicker
          session={session}
          interaction={interaction}
          busy={busy}
          error={error}
          answer={answer}
        />
      </Suspense>
    );
  const presentation = confirmationPresentation[interaction.presentation];
  return (
    <Modal
      size="sm"
      title={interaction.title}
      busy={busy}
      onClose={() => void answer(false)}
      initialFocus={
        presentation?.danger ||
        interaction.presentation === "open-project" ||
        interaction.presentation === "open-search-project"
          ? ".cds--btn--secondary"
          : ".cds--btn--primary"
      }
      footer={
        <>
          <AppButton variant="secondary" disabled={busy} onClick={() => void answer(false)}>
            Cancel
          </AppButton>
          <AppButton
            variant="primary"
            className={presentation?.danger ? "destructive" : ""}
            disabled={busy || !presentation}
            onClick={() => void answer(true)}
          >
            {presentation?.action ?? "Action unavailable"}
          </AppButton>
        </>
      }
    >
      <p>{interaction.detail}</p>
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}

export function BrowserApp() {
  const preferences = useAppPreferences();
  const lanPairing = window.location.hostname !== "127.0.0.1";
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [ready, setReady] = useState(false);
  const [requirePairing, setRequirePairing] = useState(true);
  const [client, setClient] = useState<ReturnType<typeof createBrowserClient>>();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [link, setLink] = useState<{ url: string; answer(accepted: boolean): void } | null>(null);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const establish = useCallback((value: BrowserSession | null) => {
    saveBrowserSession(value);
    setSession(value);
    setClient(undefined);
    setConnected(false);
    setInteractions([]);
  }, []);
  const bootstrap = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const policy = connectionStatusSchema.parse(await browserRequest("/api/connection", null));
      setRequirePairing(policy.requirePairing);
      let next = savedBrowserSession();
      if (next?.version !== GATEWAY_VERSION) next = null;
      if (next) {
        try {
          next = await browserRequest<BrowserSession>("/api/session", next);
        } catch {
          next = null;
        }
      }
      if (!next && !policy.requirePairing) next = await connectBrowser();
      establish(next);
      setReady(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not connect to Code60.");
    } finally {
      setBusy(false);
    }
  }, [establish]);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
  useEffect(() => {
    if (!session?.controlling) return;
    if (session.version !== GATEWAY_VERSION) {
      establish(null);
      return;
    }
    let pendingLink: ((value: boolean) => void) | undefined;
    const cancelLink = () => pendingLink?.(false);
    const receive = (frame: GatewayFrame) => {
      if (frame.event === "resync") {
        setConnected(true);
        setInteractions([]);
      }
      if (frame.event === "disconnected") {
        cancelLink();
        setConnected(false);
      }
      if (frame.event === "interaction") {
        const next = frame.value as Interaction;
        setInteractions((current) =>
          current.some((entry) => entry.id === next.id) ? current : [...current, next],
        );
      }
      if (frame.event === "interaction-ended") {
        setInteractions((current) => current.filter((entry) => entry.id !== frame.value));
      }
      if (frame.event === "control-lost") establish({ ...session, controlling: false });
      if (frame.event === "session-reset") {
        establish(null);
        void bootstrap();
      }
    };
    let disposed = false;
    const next = createBrowserClient(session, receive, (url) => {
      if (disposed || pendingLink) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        const answer = (accepted: boolean) => {
          if (pendingLink !== answer) return;
          pendingLink = undefined;
          setLink(null);
          if (accepted) window.open(url, "_blank", "noopener,noreferrer");
          resolve(accepted);
        };
        pendingLink = answer;
        setLink({ url, answer });
      });
    });
    void next.ready.then(() => {
      if (!disposed) setClient(next);
    });
    return () => {
      disposed = true;
      cancelLink();
      next.stop();
      setClient(undefined);
    };
  }, [session, establish, bootstrap]);
  const pair = async () => {
    setBusy(true);
    setError("");
    try {
      establish(await pairBrowser(code));
      setCode("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pairing failed.");
    } finally {
      setBusy(false);
    }
  };
  const takeControl = async () => {
    setBusy(true);
    setError("");
    try {
      establish(await browserRequest<BrowserSession>("/api/control", session, {}));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Control could not be transferred.");
    } finally {
      setBusy(false);
    }
  };
  if (!ready)
    return (
      <main className="browser-pairing">
        <h1>{error ? "Backend unavailable" : "Connecting to Code60"}</h1>
        {error && <p role="alert">{error}</p>}
        {error && (
          <AppButton type="button" disabled={busy} onClick={() => void bootstrap()}>
            Retry connection
          </AppButton>
        )}
      </main>
    );
  if (!session?.controlling)
    return (
      <main className="browser-pairing">
        <h1>
          {session
            ? "Take control of Code60"
            : requirePairing
              ? "Pair this browser"
              : "Connect to Code60"}
        </h1>
        {!session && requirePairing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void pair();
            }}
          >
            <p>
              {lanPairing ? (
                "Enter the pairing code from Web Server (Beta) on the computer running Code60."
              ) : (
                <>
                  Run <code>code60 open</code> on this computer and enter its pairing code.
                </>
              )}
            </p>
            <div>
              <CarbonTextInput
                labelText={<>Pairing code</>}
                autoComplete="off"
                inputMode={lanPairing ? "numeric" : "text"}
                placeholder={lanPairing ? "123-456" : ""}
                pattern={lanPairing ? "[0-9]{3}-?[0-9]{3}" : undefined}
                maxLength={lanPairing ? 7 : undefined}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            <AppButton variant="primary" type="submit" disabled={busy || !code.trim()}>
              Connect to Code60
            </AppButton>
          </form>
        ) : session ? (
          <>
            <p>
              Code60 is controlled by another browser window. Taking control keeps approved work
              running and dismisses its pending dialogs.
            </p>
            <AppButton
              variant="primary"
              type="button"
              disabled={busy}
              onClick={() => void takeControl()}
            >
              Take control
            </AppButton>
            <AppButton
              type="button"
              onClick={() => {
                establish(null);
                void bootstrap();
              }}
            >
              Reconnect
            </AppButton>
          </>
        ) : (
          <AppButton type="button" disabled={busy} onClick={() => void bootstrap()}>
            Connect to Code60
          </AppButton>
        )}
        {error && <p role="alert">{error}</p>}
      </main>
    );
  return (
    <>
      {client && (
        <App
          api={client.api}
          preferences={preferences}
          connected={connected}
          backendControls={
            <div className="backend-controls">
              <span role="status">
                {connected ? "Backend connected" : "Reconnecting to backend…"}
              </span>
              {!connected && (
                <AppButton
                  className="small ghost"
                  type="button"
                  onClick={() => {
                    establish(null);
                    void bootstrap();
                  }}
                >
                  Reconnect
                </AppButton>
              )}
              <AppButton
                className="small ghost"
                type="button"
                onClick={() =>
                  void browserRequest("/api/operation", session, {
                    id: randomId(),
                    operation: "backend-stop",
                  }).catch((cause) => setError(String(cause)))
                }
              >
                Stop Code60 Backend
              </AppButton>
              {error && <span role="alert">{error}</span>}
            </div>
          }
        />
      )}
      {link && (
        <Modal
          size="sm"
          title="Open web link?"
          busy={false}
          onClose={() => link.answer(false)}
          footer={
            <>
              <AppButton variant="secondary" onClick={() => link.answer(false)}>
                Cancel
              </AppButton>
              <AppButton variant="primary" onClick={() => link.answer(true)}>
                Open link
              </AppButton>
            </>
          }
        >
          <p>{link.url}</p>
        </Modal>
      )}
      {interactions[0] && (
        <BrowserInteraction
          key={interactions[0].id}
          session={session}
          interaction={interactions[0]}
          onDone={() =>
            setInteractions((current) =>
              current.filter((entry) => entry.id !== interactions[0]?.id),
            )
          }
        />
      )}
    </>
  );
}
