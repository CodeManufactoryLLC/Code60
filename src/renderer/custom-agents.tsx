import { useEffect, useId, useRef, useState } from "react";
import type {
  ApplicationClient,
  CustomAgent,
  CustomAgentRequest,
  CustomAgentSummary,
} from "../bridge/index.js";
import { AnchoredMenu } from "./anchored-menu.js";
import { Icon } from "./icons.js";
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
  api: ApplicationClient;
  agents: readonly CustomAgentSummary[];
  active: boolean;
  onOpen(id: string): Promise<boolean>;
}) {
  const [archived, setArchived] = useState(false);
  const [editor, setEditor] = useState<CustomAgent | "new">();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState<{ agent: CustomAgentSummary; x: number; y: number }>();
  const alive = useRef(active);
  useEffect(() => {
    alive.current = active;
    if (!active) setMenu(undefined);
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
      setError(cause instanceof Error ? cause.message : "Custom assistant action failed.");
    } finally {
      setBusy(false);
    }
  };
  const visible = agents.filter((a) => a.archived === archived);
  const menuVisible =
    active &&
    !busy &&
    menu &&
    visible.some((a) => a.id === menu.agent.id && a.revision === menu.agent.revision);
  return (
    <section className="custom-agents-page">
      <header className="table-controls">
        <PageTitle
          page="custom-agents"
          actions={[
            {
              id: "custom-agents-0",
              label: archived ? "Active assistants" : "Archived",
              run: () => {
                setMenu(undefined);
                setArchived((v) => !v);
              },
              checked: archived,
            },
          ]}
        />
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
          icon: "app-custom-agents" as const,
          available: true,
        }))}
        create={!archived ? { label: "New Assistant", onClick: () => setEditor("new") } : undefined}
        pending={busy}
        onOpen={(a) => {
          if (archived) void act({ type: "restore", id: a.id, revision: a.revision });
          else void onOpen(a.id);
        }}
        renderActions={(a) => (
          <button
            type="button"
            className="icon-button home-card-actions"
            aria-label={`More actions for ${a.name}`}
            aria-haspopup="menu"
            aria-expanded={Boolean(menuVisible && menu?.agent.id === a.id)}
            disabled={busy}
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              setMenu({ agent: a, x: bounds.left, y: bounds.bottom });
            }}
          >
            <Icon name="overflow-menu--horizontal" />
          </button>
        )}
      />
      {menuVisible && menu && (
        <AnchoredMenu
          x={menu.x}
          y={menu.y}
          label={`Actions for ${menu.agent.name}`}
          onClose={() => setMenu(undefined)}
          items={
            archived
              ? [
                  {
                    label: "Restore",
                    run: () =>
                      void act({
                        type: "restore",
                        id: menu.agent.id,
                        revision: menu.agent.revision,
                      }),
                  },
                ]
              : [
                  { label: "Edit", run: () => void act({ type: "read", id: menu.agent.id }) },
                  {
                    label: "Archive",
                    run: () =>
                      void act({
                        type: "archive",
                        id: menu.agent.id,
                        revision: menu.agent.revision,
                      }),
                  },
                ]
          }
        />
      )}
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
  api: ApplicationClient;
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
      title={agent === "new" ? "New Assistant" : "Edit Assistant"}
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
              setError(cause instanceof Error ? cause.message : "Could not save assistant.");
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
