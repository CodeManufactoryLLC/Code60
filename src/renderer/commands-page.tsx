import { useId, useRef, useState } from "react";
import type { Command, DesktopApi, Snapshot } from "../bridge/index.js";
import { COMMAND_LIMIT } from "../bridge/index.js";
import {
  type CommandDraft,
  commandProblems,
  commandRequest,
  editCommand,
  emptyCommand,
} from "./commands-model.js";
import { Icon } from "./icons.js";
import { InfoTip } from "./overlays.js";

export function CommandsPage({
  commands,
  api,
  onSnapshot,
}: {
  commands: readonly Command[];
  api: DesktopApi;
  onSnapshot(snapshot: Snapshot): void;
}) {
  const id = useId();
  const [selected, setSelected] = useState<string>(commands[0]?.id ?? "new");
  const [drafts, setDrafts] = useState<Record<string, CommandDraft>>({});
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const saved = commands.find((entry) => entry.id === selected);
  const draft =
    drafts[selected] ??
    (saved
      ? {
          fields: {
            name: saved.name,
            title: saved.title,
            description: saved.description,
            prompt: saved.prompt,
          },
          nameEdited: true,
        }
      : emptyCommand());
  const fields = draft.fields;
  const problems = commandProblems(fields, commands, saved?.id);
  const dirty =
    !saved ||
    (["name", "title", "description", "prompt"] as const).some((key) => saved[key] !== fields[key]);
  const valid = Object.keys(problems).length === 0;
  function discard() {
    setDrafts((current) => {
      const next = { ...current };
      delete next[selected];
      return next;
    });
    setError("");
  }
  async function perform(remove: boolean) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (remove) {
        if (!saved || !(await api.deleteCommand({ id: saved.id }))) return;
      } else await api.saveCommand(commandRequest(fields, saved?.id));
      const snapshot = await api.snapshot();
      onSnapshot(snapshot);
      discard();
      setSelected(
        remove
          ? (snapshot.commands[0]?.id ?? "new")
          : (snapshot.commands.find((entry) => entry.name === fields.name)?.id ?? "new"),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="prompt-editor commands-page" aria-labelledby={`${id}-heading`}>
      <header className="table-controls">
        <h1 className="table-title" id={`${id}-heading`}>
          Commands
        </h1>
        <InfoTip label="About commands">
          Reusable prompts shared across projects in this database. Start an orchestrator message
          with /name to use one.
        </InfoTip>
        <div className="button-group table-control-group">
          <button
            type="button"
            disabled={busy || commands.length >= COMMAND_LIMIT}
            onClick={() => {
              setSelected("new");
              setError("");
            }}
          >
            <Icon name="add" /> New command
          </button>
        </div>
      </header>
      <div className="commands-scroll">
        <div className="prompt-editor-body">
          <nav className="prompt-editor-list" aria-label="Commands">
            {commands.map((entry) => (
              <button
                type="button"
                key={entry.id}
                disabled={busy}
                aria-current={selected === entry.id ? "true" : undefined}
                onClick={() => {
                  setSelected(entry.id);
                  setError("");
                }}
              >
                <span className="prompt-editor-name">/{entry.name}</span>
                <span className="prompt-editor-source">{entry.title}</span>
                {drafts[entry.id] && <span className="prompt-editor-source">Unsaved changes</span>}
              </button>
            ))}
            {(selected === "new" || drafts.new) && (
              <button
                type="button"
                disabled={busy}
                aria-current={selected === "new" ? "true" : undefined}
                onClick={() => {
                  setSelected("new");
                  setError("");
                }}
              >
                New command (unsaved)
              </button>
            )}
          </nav>
          <form
            className="prompt-editor-main command-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (valid && dirty) void perform(false);
            }}
          >
            {(["title", "name", "description", "prompt"] as const).map((field) => {
              const label = {
                title: "Title",
                name: "Name",
                description: "Description",
                prompt: "Prompt",
              }[field];
              const control = {
                id: `${id}-${field}`,
                value: fields[field],
                disabled: busy,
                "aria-invalid": !!problems[field],
                "aria-describedby": `${id}-${field}-problem`,
                onChange: (event: { target: { value: string } }) => {
                  setDrafts((current) => ({
                    ...current,
                    [selected]: editCommand(draft, field, event.target.value),
                  }));
                  setError("");
                },
              };
              return (
                <div className="command-field" key={field}>
                  <label className="field-label" htmlFor={control.id}>
                    {label}
                  </label>
                  {field === "prompt" ? (
                    <div className="prompt-editor-input">
                      <textarea {...control} spellCheck={false} maxLength={100_000} />
                    </div>
                  ) : (
                    <div className={field === "name" ? "command-name-input" : undefined}>
                      {field === "name" && <span aria-hidden="true">/</span>}
                      <input
                        {...control}
                        maxLength={field === "title" ? 120 : field === "name" ? 64 : 500}
                        autoCapitalize={field === "name" ? "none" : undefined}
                      />
                    </div>
                  )}
                  <p className="prompt-editor-problem" id={`${id}-${field}-problem`}>
                    {problems[field] ?? ""}
                  </p>
                </div>
              );
            })}
            {error && (
              <p className="prompt-editor-problem" role="alert">
                {error}
              </p>
            )}
            <div className="button-group">
              <button type="submit" className="primary" disabled={busy || !dirty || !valid}>
                <Icon name="checkmark" /> Save
              </button>
              <button type="button" disabled={busy || !dirty} onClick={discard}>
                Discard changes
              </button>
              <button type="button" disabled={busy || !saved} onClick={() => void perform(true)}>
                Delete
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
