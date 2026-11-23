import { useCallback, useEffect, useState } from "react";
import {
  type BrowserSession,
  type Choices,
  GATEWAY_VERSION,
  type GatewayFrame,
  type Interaction,
  type InteractionAnswer,
} from "../bridge/index.js";
import { App } from "./app.js";
import {
  browserRequest,
  createBrowserClient,
  pairBrowser,
  saveBrowserSession,
  savedBrowserSession,
} from "./browser-client.js";
import { Modal } from "./modal.js";

function BrowserInteraction({
  session,
  interaction,
  onDone,
}: {
  session: BrowserSession;
  interaction: Interaction;
  onDone(): void;
}) {
  const [choices, setChoices] = useState<Choices>();
  const [filename, setFilename] = useState("code60.sqlite");
  const [folderName, setFolderName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(
    async (directory?: string, createDirectory?: string) => {
      setBusy(true);
      setError("");
      try {
        setChoices(
          await browserRequest<Choices>("/api/chooser", session, {
            id: interaction.id,
            directory,
            createDirectory,
          }),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not list this folder.");
      } finally {
        setBusy(false);
      }
    },
    [interaction.id, session],
  );
  useEffect(() => {
    if (interaction.kind === "pick") void load();
  }, [interaction.kind, load]);
  const answer = async (accepted: boolean, choice?: string) => {
    setBusy(true);
    setError("");
    const value: InteractionAnswer = {
      id: interaction.id,
      accepted,
      ...(choice ? { choice } : {}),
      ...(accepted && interaction.picker === "database-create" ? { filename } : {}),
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
  const current = choices?.entries.find((entry) => entry.name === ".");
  return (
    <Modal title={interaction.title} busy={busy} onClose={() => void answer(false)}>
      <p>{interaction.detail}</p>
      {interaction.kind === "pick" && (
        <>
          <p>{choices?.directory ?? "Loading folders…"}</p>
          <button type="button" disabled={busy} onClick={() => void load()}>
            Workspace roots
          </button>
          <ul className="host-chooser" aria-label="Host folders and databases">
            {choices?.entries
              .filter((entry) => entry.name !== ".")
              .map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void (entry.directory ? load(entry.id) : answer(true, entry.id))}
                  >
                    {entry.directory ? `Open folder ${entry.name}` : `Open database ${entry.name}`}
                  </button>
                </li>
              ))}
          </ul>
          {choices?.truncated && <p>Listing is limited. Open a folder to narrow the selection.</p>}
          {current && (
            <label>
              New folder name
              <input value={folderName} onChange={(event) => setFolderName(event.target.value)} />
              <button
                type="button"
                disabled={busy || !folderName.trim()}
                onClick={() => {
                  void load(current.id, folderName);
                  setFolderName("");
                }}
              >
                Create folder
              </button>
            </label>
          )}
          {interaction.picker === "database-create" && (
            <label>
              Database filename
              <input value={filename} onChange={(event) => setFilename(event.target.value)} />
            </label>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={() => void answer(false)}>
          Cancel
        </button>
        {interaction.kind === "confirm" ? (
          <button type="button" disabled={busy} onClick={() => void answer(true)}>
            Confirm
          </button>
        ) : (
          interaction.picker !== "database-open" && (
            <button
              type="button"
              disabled={busy || !current}
              onClick={() => void answer(true, current?.id)}
            >
              {interaction.picker === "folder" ? "Select this folder" : "Create database here"}
            </button>
          )
        )}
      </div>
    </Modal>
  );
}

export function BrowserApp() {
  const [session, setSession] = useState<BrowserSession | null>(savedBrowserSession);
  const [client, setClient] = useState<ReturnType<typeof createBrowserClient>>();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const establish = useCallback((value: BrowserSession | null) => {
    saveBrowserSession(value);
    setSession(value);
    setInteractions([]);
  }, []);
  useEffect(() => {
    if (!session?.controlling) return;
    if (session.version !== GATEWAY_VERSION) {
      establish(null);
      return;
    }
    const receive = (frame: GatewayFrame) => {
      if (frame.event === "resync") {
        setConnected(true);
        setInteractions([]);
      }
      if (frame.event === "disconnected") setConnected(false);
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
    };
    const next = createBrowserClient(session, receive);
    let disposed = false;
    void next.ready.then(() => {
      if (!disposed) setClient(next);
    });
    return () => {
      disposed = true;
      next.stop();
      setClient(undefined);
    };
  }, [session, establish]);
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
  if (!session?.controlling)
    return (
      <main className="browser-pairing">
        <h1>Code60</h1>
        {!session ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void pair();
            }}
          >
            <p>
              Run <code>code60 open</code> on this computer and enter its pairing code.
            </p>
            <label>
              Pairing code
              <input
                autoComplete="off"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <button type="submit" disabled={busy || !code.trim()}>
              Connect to Code60
            </button>
          </form>
        ) : (
          <>
            <p>
              Code60 is controlled by another browser window. Taking control keeps approved work
              running and dismisses its pending dialogs.
            </p>
            <button type="button" disabled={busy} onClick={() => void takeControl()}>
              Take control
            </button>
            <button type="button" onClick={() => establish(null)}>
              Pair again
            </button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </main>
    );
  return (
    <>
      {client && <App api={client.api} />}
      <div className="backend-controls">
        <span role="status">{connected ? "Backend connected" : "Reconnecting to backend…"}</span>
        {!connected && (
          <button type="button" onClick={() => establish(null)}>
            Pair again
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            void browserRequest("/api/operation", session, {
              id: crypto.randomUUID(),
              operation: "backend-stop",
            }).catch((cause) => setError(String(cause)))
          }
        >
          Stop Code60 Backend
        </button>
        {error && <span role="alert">{error}</span>}
      </div>
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
