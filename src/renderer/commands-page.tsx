import { useId, useRef, useState } from "react";
import type { ApplicationClient, Command, Snapshot } from "../bridge/index.js";
import { COMMAND_LIMIT } from "../bridge/index.js";
import { Button as AppButton } from "./carbon/button.js";
import { TextInput as CarbonTextInput } from "./carbon/fields.js";
import { Textarea as CarbonTextArea } from "./carbon/textarea.js";
import {
  type CommandDraft,
  commandProblems,
  commandRequest,
  editCommand,
  emptyCommand,
} from "./commands-model.js";

import { ControlDescription } from "./overlays.js";
import { PageTitle } from "./page-title.js";
import { useScopeLifetime } from "./scope-lifetime.js";

export function CommandsPage({
  commands,
  api,
  onSnapshot,
}: {
  commands: readonly Command[];
  api: ApplicationClient;
  onSnapshot(snapshot: Snapshot): void;
}) {
  const id = useId();
  const lifetime = useScopeLifetime(id);
  const [selected, setSelected] = useState<string>(commands[0]?.id ?? "new");
  const [drafts, setDrafts] = useState<Record<string, CommandDraft>>({});
  const [busy, setBusy] = useState(false);
  const [visited, setVisited] = useState<Record<string, readonly string[]>>({});
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
  const dirty = (["name", "title", "description", "prompt"] as const).some(
    (key) => (saved?.[key] ?? "") !== fields[key],
  );

  function discard() {
    setVisited((current) => ({ ...current, [selected]: [] }));
    setDrafts((current) => {
      const next = { ...current };
      delete next[selected];
      return next;
    });
    setError("");
  }
  async function perform(remove: boolean) {
    const current = lifetime.capture();
    if (pending.current || !current()) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (remove) {
        if (!saved || !(await api.deleteCommand({ id: saved.id }))) return;
      } else await api.saveCommand(commandRequest(fields, saved?.id));
      if (!current()) return;
      const snapshot = await api.snapshot();
      if (!current()) return;
      onSnapshot(snapshot);
      discard();
      setSelected(
        remove
          ? (snapshot.commands[0]?.id ?? "new")
          : (snapshot.commands.find((entry) => entry.name === fields.name)?.id ?? "new"),
      );
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  }
  return (
    <main className="prompt-editor commands-page" aria-labelledby={`${id}-heading`}>
      <header className="table-controls">
        <PageTitle page="commands" className="table-title" id={`${id}-heading`} />
        <ControlDescription>
          Reusable prompts shared across projects in this database. Start an orchestrator message
          with $name to use one.
        </ControlDescription>
      </header>
      <div className="commands-scroll">
        <div className="prompt-editor-body">
          <nav className="prompt-editor-list" aria-label="Commands">
            <AppButton
              variant="quiet"
              disabled={busy || commands.length >= COMMAND_LIMIT}
              onClick={() => {
                setSelected("new");
                setError("");
                document.getElementById(`${id}-title`)?.focus();
              }}
            >
              New command
            </AppButton>
            {commands.map((entry) => (
              <AppButton
                variant="quiet"
                type="button"
                key={entry.id}
                disabled={busy}
                aria-current={selected === entry.id ? "true" : undefined}
                onClick={() => {
                  setSelected(entry.id);
                  setError("");
                }}
              >
                <span className="prompt-editor-name">${entry.name}</span>
                <span className="prompt-editor-source">{entry.title}</span>
                {drafts[entry.id] && <span className="prompt-editor-source">Unsaved changes</span>}
              </AppButton>
            ))}
            {drafts.new && Object.values(drafts.new.fields).some(Boolean) && (
              <AppButton
                type="button"
                disabled={busy}
                variant="quiet"
                aria-current={selected === "new" ? "true" : undefined}
                onClick={() => {
                  setSelected("new");
                  setError("");
                }}
              >
                New command (unsaved)
              </AppButton>
            )}
          </nav>
          <form
            className="prompt-editor-main command-form"
            onSubmit={(event) => {
              event.preventDefault();
              const invalidFields = (["title", "name", "description", "prompt"] as const).filter(
                (field) => problems[field],
              );
              if (invalidFields.length) {
                setVisited((current) => ({ ...current, [selected]: invalidFields }));
                document.getElementById(`${id}-${invalidFields[0]}`)?.focus();
                return;
              }
              if (dirty) void perform(false);
            }}
          >
            {(["title", "name", "description", "prompt"] as const).map((field) => {
              const label = {
                title: "Title",
                name: "Name",
                description: "Description (optional)",
                prompt: "Prompt",
              }[field];
              const invalid = Boolean(problems[field] && visited[selected]?.includes(field));
              const control = {
                labelText: label,
                invalid,
                invalidText: problems[field] ?? "",
                "aria-required": field !== "description",
                onBlur: () =>
                  setVisited((current) =>
                    current[selected]?.includes(field)
                      ? current
                      : { ...current, [selected]: [...(current[selected] ?? []), field] },
                  ),
                id: `${id}-${field}`,
                value: fields[field],
                disabled: busy,
                onChange: (event: { target: { value: string } }) => {
                  setDrafts((current) => ({
                    ...current,
                    [selected]: editCommand(draft, field, event.target.value),
                  }));
                  setError("");
                },
              };
              return field === "prompt" ? (
                <CarbonTextArea
                  key={field}
                  {...control}
                  hideLabel={false}
                  rows={6}
                  spellCheck={false}
                  maxLength={100_000}
                />
              ) : (
                <CarbonTextInput
                  key={field}
                  {...control}
                  helperText={field === "name" ? "Use $name at the start of a message." : undefined}
                  autoCapitalize={field === "name" ? "none" : undefined}
                  maxLength={field === "title" ? 120 : field === "name" ? 64 : 500}
                />
              );
            })}
            {error && (
              <p className="prompt-editor-problem" role="alert">
                {error}
              </p>
            )}
            <div className="command-form-actions">
              <AppButton type="submit" className="primary" disabled={busy || (!!saved && !dirty)}>
                Save
              </AppButton>
              <AppButton type="button" disabled={busy || !dirty} onClick={discard}>
                Discard changes
              </AppButton>
              {saved && (
                <AppButton
                  className="destructive"
                  variant="quiet"
                  type="button"
                  disabled={busy}
                  onClick={() => void perform(true)}
                >
                  Delete
                </AppButton>
              )}
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
