import { useEffect, useId, useRef, useState } from "react";
import type {
  CustomAgent,
  CustomAgentRequest,
  CustomAgentSummary,
  DesktopApi,
} from "../bridge/index.js";
import { Modal } from "./modal.js";
import { NavigationCards } from "./navigation-cards.js";
import { PageTitle } from "./page-title.js";

export function CustomAgentsPage({
  api,
  agents,
  active,
  onOpen,
  storageError,
}: {
  storageError?: string | undefined;
  api: DesktopApi;
  agents: readonly CustomAgentSummary[];
  active: boolean;
  onOpen(id: string): Promise<boolean>;
}) {
  const [archived, setArchived] = useState(false);
  const [editor, setEditor] = useState<CustomAgent | "new">();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(active);
  useEffect(() => {
    alive.current = active;
    return () => {
      alive.current = false;
    };
  }, [active]);
  const act = async (request: CustomAgentRequest) => {
    if (!api.customAgent || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.customAgent(request);
      if (alive.current && request.type === "read" && result.agent) setEditor(result.agent);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Custom agent action failed.");
    } finally {
      setBusy(false);
    }
  };
  const visible = agents.filter((a) => a.archived === archived);
  return (
    <section className="custom-agents-page">
      <header className="table-controls">
        <PageTitle page="custom-agents">Custom Agents</PageTitle>
        <button type="button" aria-pressed={archived} onClick={() => setArchived((v) => !v)}>
          {archived ? "Active agents" : "Archived"}
        </button>
      </header>
      {(error || storageError) && (
        <p role="alert" className="error-banner">
          {error || storageError}
        </p>
      )}
      <NavigationCards
        cards={visible.map((a) => ({
          ...a,
          label: a.name,
          icon: "app-helmet" as const,
          available: true,
        }))}
        create={!archived ? { label: "New Agent", onClick: () => setEditor("new") } : undefined}
        pending={busy}
        onOpen={(a) => {
          if (archived) void act({ type: "restore", id: a.id, revision: a.revision });
          else void onOpen(a.id);
        }}
      >
        <div className="custom-agent-actions">
          {visible.map((a) => (
            <div key={a.id}>
              <span>{a.name}</span>
              {archived ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act({ type: "restore", id: a.id, revision: a.revision })}
                >
                  Restore
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="button"
                    aria-label={`Edit ${a.name}`}
                    disabled={busy}
                    onClick={() => void act({ type: "read", id: a.id })}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="button"
                    aria-label={`Archive ${a.name}`}
                    disabled={busy}
                    onClick={() => void act({ type: "archive", id: a.id, revision: a.revision })}
                  >
                    Archive
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </NavigationCards>
      {editor && (
        <AgentEditor
          key={editor === "new" ? "new" : editor.id}
          agent={editor}
          api={api}
          onClose={() => setEditor(undefined)}
        />
      )}
    </section>
  );
}

export function AgentEditor({
  agent,
  api,
  onClose,
}: {
  agent: CustomAgent | "new";
  api: DesktopApi;
  onClose(): void;
}) {
  const id = useId();
  const [name, setName] = useState(agent === "new" ? "" : agent.name);
  const [instructions, setInstructions] = useState(agent === "new" ? "" : agent.instructions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed = agent === "new" || name !== agent.name || instructions !== agent.instructions;
  return (
    <Modal
      className="custom-agent-editor"
      title={agent === "new" ? "New Agent" : "Edit Agent"}
      busy={busy}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!api.customAgent || busy) return;
          setBusy(true);
          setError("");
          void api
            .customAgent(
              agent === "new"
                ? { type: "create", name, instructions }
                : { type: "edit", id: agent.id, revision: agent.revision, name, instructions },
            )
            .then(onClose, (cause: unknown) => {
              setError(cause instanceof Error ? cause.message : "Could not save agent.");
              setBusy(false);
            });
        }}
      >
        <label htmlFor={`${id}-name`}>Name</label>
        <input
          id={`${id}-name`}
          required
          maxLength={120}
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <label htmlFor={`${id}-instructions`}>Special instructions</label>
        <textarea
          id={`${id}-instructions`}
          required
          rows={12}
          maxLength={32_000}
          value={instructions}
          disabled={busy}
          onChange={(e) => setInstructions(e.target.value)}
        />
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !changed || !name.trim() || !instructions.trim()}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
