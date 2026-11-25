import { useId, useRef, useState } from "react";
import type { Snapshot, StartRequest } from "../bridge/index.js";
import { Button as AppButton } from "./carbon/button.js";
import { Checkbox as CarbonCheckbox } from "./carbon/choices.js";
import { Select as CarbonSelect, TextInput as CarbonTextInput } from "./carbon/fields.js";
import { Textarea as CarbonTextArea } from "./carbon/textarea.js";
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
    <Modal
      footer={
        <>
          <AppButton
            variant="secondary"
            type="button"
            disabled={props.busy}
            onClick={props.onClose}
          >
            Cancel
          </AppButton>
          <AppButton
            type="button"
            className="primary"
            disabled={props.busy}
            onClick={() => {
              setConfigurationId(undefined);
              setChoosing(false);
            }}
          >
            Do not use a run configuration
          </AppButton>
        </>
      }
      title="Select run configuration"
      busy={props.busy}
      onClose={props.onClose}
    >
      {props.snapshot.configurations.length === 0 && <p>No saved run configurations.</p>}
      <ul className="project-list" aria-label="Available run configurations">
        {props.snapshot.configurations.map((entry) => (
          <li key={entry.id}>
            <AppButton
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
            </AppButton>
          </li>
        ))}
      </ul>
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
  const formId = useId();
  const [save, setSave] = useState(false);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <Modal
      footer={
        <>
          <AppButton
            variant={save && !saved ? "secondary" : "primary"}
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Done
          </AppButton>
          {save && !saved && (
            <AppButton
              form={formId}
              type="submit"
              className="primary"
              disabled={busy || !name.trim()}
            >
              {busy ? "Saving…" : "Save configuration"}
            </AppButton>
          )}
        </>
      }
      title="Agent sessions started"
      busy={busy}
      onClose={onClose}
    >
      <p role="status">
        {count} agent {count === 1 ? "session" : "sessions"} started. Check the sessions table and
        chats for progress or startup errors.
      </p>
      {saved ? (
        <p role="status">Run configuration saved.</p>
      ) : (
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            void onSave(name).then((success) => {
              if (success) setSaved(true);
            });
          }}
        >
          <div className="check-label">
            <CarbonCheckbox
              labelText={<>Save Run Configuration</>}
              checked={save}
              disabled={busy}
              onChange={(event) => setSave(event.target.checked)}
            />
          </div>
          {save && (
            <div className="space-top">
              <CarbonTextInput
                labelText={<>Configuration name</>}
                required
                maxLength={128}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
        </form>
      )}
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
  const formId = useId();
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
  return (
    <Modal
      footer={
        <>
          <AppButton variant="secondary" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </AppButton>
          <AppButton
            form={formId}
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
          </AppButton>
        </>
      }
      title={editing ? "Run configuration" : "New agent sessions"}
      busy={busy}
      onClose={onClose}
      closeLabel="Close new run"
      initialFocus="[data-initial-focus]"
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void onStart(request(), name);
        }}
      >
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
            <div>
              <CarbonTextInput
                labelText={<>Configuration name</>}
                data-initial-focus
                required
                maxLength={128}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          )}
          {!editing && (
            <div>
              <CarbonTextArea
                labelText={
                  <>
                    Task prompt <span className="muted">(optional)</span>
                  </>
                }
                data-initial-focus
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="What would you like your agents to do?"
                rows={5}
              />
            </div>
          )}
          <p className="field-label">Agents</p>
          {agents.map((agent, index) => (
            <div className="agent-row" key={agent.id}>
              <CarbonSelect
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
              </CarbonSelect>
              {agents.length > 1 && (
                <AppButton
                  type="button"
                  aria-label={`Remove agent ${index + 1}`}
                  onClick={() =>
                    setAgents((current) => current.filter((item) => item.id !== agent.id))
                  }
                >
                  Remove
                </AppButton>
              )}
            </div>
          ))}
          <AppButton
            type="button"
            disabled={agents.length >= 32}
            onClick={() => {
              const entry = { id: nextAgentId.current++, name: snapshot.defaultAgent };
              setAgents((current) => [...current, entry]);
            }}
          >
            <Icon name="add" /> Add agent
          </AppButton>
          <div className="space-top">
            <CarbonTextInput
              labelText={<>{agents.length === 1 ? "Parallel copies" : "Maximum active runs"}</>}
              type="number"
              min="1"
              max={agents.length === 1 ? 32 : undefined}
              value={parallel}
              placeholder={agents.length === 1 ? "1" : String(snapshot.maxParallel)}
              onChange={(event) => setParallel(event.target.value)}
            />
          </div>
          <details>
            <summary>Advanced options</summary>
            <div className="form-grid">
              <div>
                <CarbonTextInput
                  labelText={<>Base revision</>}
                  value={base}
                  placeholder="HEAD"
                  onChange={(event) => setBase(event.target.value)}
                />
              </div>
              <div>
                <CarbonTextInput
                  labelText={<>Turn timeout</>}
                  value={timeout}
                  placeholder={snapshot.turnTimeout}
                  onChange={(event) => setTimeoutValue(event.target.value)}
                />
              </div>
            </div>
            <p className="field-hint">
              Permission overrides apply only to this batch. Agent configuration remains read-only.
            </p>
            <div className="permission-grid">
              {kinds.map((kind) => (
                <div key={kind} className="check-label">
                  <CarbonCheckbox
                    labelText={<>Allow {kind}</>}
                    checked={allow.includes(kind)}
                    onChange={(event) =>
                      setAllow((current) =>
                        event.target.checked
                          ? [...current, kind]
                          : current.filter((item) => item !== kind),
                      )
                    }
                  />
                </div>
              ))}
            </div>
            <div className="check-label danger-text">
              <CarbonCheckbox
                labelText={<>Code60 auto-approval</>}
                checked={allowAll}
                onChange={(event) => setAllowAll(event.target.checked)}
              />
            </div>
          </details>
        </fieldset>
        {onBack && (
          <AppButton type="button" disabled={busy} onClick={() => onBack(request())}>
            Back
          </AppButton>
        )}
      </form>
    </Modal>
  );
}
