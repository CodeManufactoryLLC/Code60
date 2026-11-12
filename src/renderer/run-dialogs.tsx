import { useEffect, useRef, useState } from "react";
import type { Snapshot, StartRequest } from "../bridge/index.js";
import { agentCount, providers } from "./configurations.js";
import { Icon } from "./icons.js";
import { Modal } from "./modal.js";

const kinds = [
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "switch_mode",
  "other",
];
export function NewSession(props: {
  snapshot: Snapshot;
  busy: boolean;
  error: string;
  onClose(): void;
  onStart(request: StartRequest): Promise<void>;
}) {
  const [choosing, setChoosing] = useState(true);
  const [configurationId, setConfigurationId] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, StartRequest>>({});
  const configuration = props.snapshot.configurations.find((entry) => entry.id === configurationId);
  const key = configurationId ?? "adhoc";
  if (!choosing)
    return (
      <NewRun
        {...props}
        initial={drafts[key] ?? configuration?.settings}
        onBack={(draft) => {
          setDrafts((current) => ({ ...current, [key]: draft }));
          setChoosing(true);
        }}
        onStart={(request) =>
          props.onStart({ ...request, ...(configurationId ? { configurationId } : {}) })
        }
      />
    );
  return (
    <Modal title="Select run configuration" busy={props.busy} onClose={props.onClose}>
      <p className="muted">Choose saved settings or configure this batch without a preset.</p>
      {props.snapshot.configurations.length === 0 && <p>No saved run configurations.</p>}
      <ul className="project-list" aria-label="Available run configurations">
        {props.snapshot.configurations.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className="project-item"
              disabled={props.busy}
              onClick={() => {
                setConfigurationId(entry.id);
                setChoosing(false);
              }}
            >
              <strong>{entry.name}</strong>
              <span>
                {providers(entry)} / {agentCount(entry)} agents
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="modal-footer">
        <button type="button" disabled={props.busy} onClick={props.onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={props.busy}
          onClick={() => {
            setConfigurationId(undefined);
            setChoosing(false);
          }}
        >
          Do not use a run configuration
        </button>
      </div>
    </Modal>
  );
}

export function LaunchConfirmation({
  count,
  busy,
  error,
  onClose,
  onSave,
}: {
  count: number;
  busy: boolean;
  error: string;
  onClose(): void;
  onSave(name: string): Promise<boolean>;
}) {
  const [save, setSave] = useState(false);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <Modal title="Agent sessions started" busy={busy} onClose={onClose}>
      <p role="status">
        {count} agent {count === 1 ? "session" : "sessions"} started. Check the sessions table and
        chats for progress or startup errors.
      </p>
      {saved ? (
        <p role="status">Run configuration saved.</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onSave(name).then((success) => {
              if (success) setSaved(true);
            });
          }}
        >
          <label className="check-label">
            <input
              type="checkbox"
              checked={save}
              disabled={busy}
              onChange={(event) => setSave(event.target.checked)}
            />
            Save Run Configuration
          </label>
          {save && (
            <label className="space-top">
              Configuration name
              <input
                required
                maxLength={128}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {save && (
            <div className="modal-footer">
              <button type="submit" className="primary" disabled={busy || !name.trim()}>
                {busy ? "Saving…" : "Save configuration"}
              </button>
            </div>
          )}
        </form>
      )}
      <div className="modal-footer">
        <button type="button" disabled={busy} onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

export function NewRun({
  snapshot,
  busy,
  error,
  onClose,
  onStart,
  initial,
  configurationName,
  onBack,
}: {
  snapshot: Snapshot;
  busy: boolean;
  error: string;
  onClose(): void;
  initial?: StartRequest | undefined;
  configurationName?: string;
  onBack?(request: StartRequest): void;
  onStart(request: StartRequest, name?: string): Promise<void>;
}) {
  const editing = configurationName !== undefined;
  const [name, setName] = useState(configurationName ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [agents, setAgents] = useState(
    (initial?.agents ?? [snapshot.defaultAgent]).map((name, id) => ({ id, name })),
  );
  const nextAgentId = useRef(agents.length);
  const [parallel, setParallel] = useState(initial?.parallel ?? "");
  const [base, setBase] = useState(initial?.base ?? "");
  const [timeout, setTimeoutValue] = useState(initial?.turnTimeout ?? "");
  const [allow, setAllow] = useState<string[]>(initial?.allow ?? []);
  const [allowAll, setAllowAll] = useState(initial?.allowAll ?? false);
  const request = (): StartRequest => ({
    agents: agents.map((agent) => agent.name),
    allow,
    allowAll,
    ...(!editing && prompt.trim() ? { prompt } : {}),
    ...(parallel ? { parallel } : {}),
    ...(base ? { base } : {}),
    ...(timeout ? { turnTimeout: timeout } : {}),
  });
  const unavailable = agents.filter((agent) => !snapshot.agents.includes(agent.name));
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="setup-dialog"
      aria-label={editing ? "Run configuration" : "New agent sessions"}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onStart(request(), name);
        }}
      >
        <div className="modal-heading">
          <div>
            <h2>{editing ? "Run configuration" : "Put your agents to work"}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close new run"
            disabled={busy}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <p className="muted">
          {editing
            ? "Reusable settings shared across projects in this database. Task prompts are never saved."
            : "Each agent gets a separate worktree when Git is available."}
        </p>
        {unavailable.length > 0 && (
          <p role="alert" className="error-banner">
            Unavailable providers: {[...new Set(unavailable.map((agent) => agent.name))].join(", ")}
            . Choose available providers before continuing.
          </p>
        )}
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <fieldset disabled={busy}>
          {editing && (
            <label>
              Configuration name
              <input
                autoFocus
                required
                maxLength={128}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}
          {!editing && (
            <>
              <label>
                Task prompt <span className="muted">(optional)</span>
                <textarea
                  autoFocus
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="What would you like your agents to do?"
                  rows={5}
                />
              </label>
              <p className="field-hint">
                Leave blank to start sessions and send each agent its own prompt later.
              </p>
            </>
          )}
          <p className="field-label">Agents</p>
          {agents.map((agent, index) => (
            <div className="agent-row" key={agent.id}>
              <select
                aria-label={`Agent ${index + 1}`}
                value={agent.name}
                onChange={(event) =>
                  setAgents((current) =>
                    current.map((item) =>
                      item.id === agent.id ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }
              >
                {!snapshot.agents.includes(agent.name) && (
                  <option value={agent.name}>{agent.name} (unavailable)</option>
                )}
                {snapshot.agents.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
              {agents.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove agent ${index + 1}`}
                  onClick={() =>
                    setAgents((current) => current.filter((item) => item.id !== agent.id))
                  }
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            disabled={agents.length >= 32}
            onClick={() => {
              const entry = { id: nextAgentId.current++, name: snapshot.defaultAgent };
              setAgents((current) => [...current, entry]);
            }}
          >
            <Icon name="add" /> Add agent
          </button>
          <label className="space-top">
            {agents.length === 1 ? "Parallel copies" : "Maximum active runs"}
            <input
              type="number"
              min="1"
              max={agents.length === 1 ? 32 : undefined}
              value={parallel}
              placeholder={agents.length === 1 ? "1" : String(snapshot.maxParallel)}
              onChange={(event) => setParallel(event.target.value)}
            />
          </label>
          <details>
            <summary>Advanced options</summary>
            <div className="form-grid">
              <label>
                Base revision
                <input
                  value={base}
                  placeholder="HEAD"
                  onChange={(event) => setBase(event.target.value)}
                />
              </label>
              <label>
                Turn timeout
                <input
                  value={timeout}
                  placeholder={snapshot.turnTimeout}
                  onChange={(event) => setTimeoutValue(event.target.value)}
                />
              </label>
            </div>
            <p className="field-hint">
              Permission overrides apply only to this batch. Agent configuration remains read-only.
            </p>
            <div className="permission-grid">
              {kinds.map((kind) => (
                <label key={kind} className="check-label">
                  <input
                    type="checkbox"
                    checked={allow.includes(kind)}
                    onChange={(event) =>
                      setAllow((current) =>
                        event.target.checked
                          ? [...current, kind]
                          : current.filter((item) => item !== kind),
                      )
                    }
                  />
                  Allow {kind}
                </label>
              ))}
            </div>
            <label className="check-label danger-text">
              <input
                type="checkbox"
                checked={allowAll}
                onChange={(event) => setAllowAll(event.target.checked)}
              />
              Code60 auto-approval
            </label>
          </details>
        </fieldset>
        <div className="modal-footer">
          {onBack && (
            <button type="button" disabled={busy} onClick={() => onBack(request())}>
              Back
            </button>
          )}
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || !agents[0] || unavailable.length > 0 || (editing && !name.trim())}
          >
            {editing
              ? busy
                ? "Saving…"
                : "Save configuration"
              : busy
                ? "Starting…"
                : "Start agents"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
