import {
  Button,
  Checkbox,
  FormGroup,
  InlineLoading,
  InlineNotification,
  Select,
  SelectItem,
  TextArea,
  TextInput,
} from "@carbon/react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  type ApplicationClient,
  type AutomationEditor,
  type RendererAutomationDraft,
  TOOL_KINDS,
} from "../bridge/index.js";
import { automationDate, automationWeekdays } from "./automation-date.js";

export function AutomationForm({
  api,
  editor,
  agents,
  active = true,
  onClose,
  onSaved,
}: {
  api: ApplicationClient;
  editor: AutomationEditor;
  agents: string[];
  active?: boolean;
  onClose(): void;
  onSaved(id?: string): void;
}) {
  const promptId = useId();
  const permissionHelpId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const focused = useRef(false);
  useLayoutEffect(() => {
    if (active && !focused.current) {
      focused.current = true;
      nameInput.current?.focus();
    }
  }, [active]);
  const [draft, setDraft] = useState(editor.draft);
  const [repository, setRepository] = useState(editor.repositoryLabel);
  const [preview, setPreview] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const pending = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(editor.draft);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    let current = true;
    setPreview([]);
    void api
      .automation({ action: "preview", schedule: draft.schedule })
      .then((result) => {
        if (current) setPreview(result as string[]);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [api, draft.schedule, active]);
  const set = <K extends keyof RendererAutomationDraft>(
    key: K,
    value: RendererAutomationDraft[K],
  ) => setDraft((previous) => ({ ...previous, [key]: value }));
  const schedule = draft.schedule;
  const pick = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = (await api.automation({ action: "pickRepository" })) as {
        token: string;
        label: string;
      } | null;
      if (alive.current && result) {
        set("repositoryToken", result.token);
        setRepository(result.label);
      }
    } catch (error) {
      if (alive.current) setError((error as Error).message);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const save = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api.automation(
        editor.id
          ? { action: "update", id: editor.id, revision: editor.revision, draft }
          : { action: "create", draft },
      );
      if (alive.current) onSaved((result as { id?: string } | null)?.id ?? editor.id);
    } catch (error) {
      if (alive.current) setError((error as Error).message);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section
      className="carbon-job-editor"
      aria-label={editor.id ? "Edit scheduled job" : "New scheduled job"}
    >
      <h1>{editor.id ? "Edit scheduled job" : "New scheduled job"}</h1>
      <form
        className="carbon-job-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset className="carbon-job-form-fields" disabled={busy}>
          <TextInput
            id={`${promptId}-name`}
            labelText="Name"
            required
            maxLength={80}
            ref={nameInput}
            value={draft.name}
            onChange={(event) => set("name", event.target.value)}
          />
          <TextArea
            id={promptId}
            labelText="Saved prompt"
            required
            maxLength={32000}
            rows={5}
            value={draft.prompt}
            onChange={(event) => set("prompt", event.target.value)}
          />
          <FormGroup legendText="Schedule">
            <Select
              id={`${promptId}-schedule`}
              labelText="Frequency"
              value={schedule.type}
              onChange={(event) => {
                const type = event.target.value;
                set(
                  "schedule",
                  type === "interval"
                    ? { type, everyMinutes: 60, anchor: new Date().toISOString() }
                    : type === "weekly"
                      ? {
                          type,
                          days: [1],
                          time: "09:00",
                          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                        }
                      : {
                          type: "daily",
                          time: "09:00",
                          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                        },
                );
              }}
            >
              <SelectItem value="interval" text="Interval" />
              <SelectItem value="daily" text="Daily" />
              <SelectItem value="weekly" text="Weekly" />
            </Select>
            {schedule.type === "interval" ? (
              <TextInput
                id={`${promptId}-interval`}
                labelText="Every (minutes)"
                type="number"
                required
                min={1}
                max={10080}
                value={schedule.everyMinutes}
                onChange={(event) =>
                  set("schedule", {
                    ...schedule,
                    everyMinutes: Number(event.target.value),
                  })
                }
              />
            ) : (
              <>
                <TextInput
                  id={`${promptId}-time`}
                  labelText="Time"
                  type="time"
                  required
                  value={schedule.time}
                  onChange={(event) => set("schedule", { ...schedule, time: event.target.value })}
                />
                <TextInput
                  id={`${promptId}-timezone`}
                  labelText="Time zone"
                  required
                  value={schedule.timeZone}
                  onChange={(event) =>
                    set("schedule", { ...schedule, timeZone: event.target.value })
                  }
                />
              </>
            )}
            {schedule.type === "weekly" && (
              <fieldset className="carbon-job-checkboxes">
                <legend>Days of week</legend>
                {automationWeekdays.map((day, index) => (
                  <Checkbox
                    key={day}
                    id={`${promptId}-day-${index}`}
                    labelText={day}
                    checked={schedule.days.includes(index)}
                    onChange={(_event, { checked }) =>
                      set("schedule", {
                        ...schedule,
                        days: checked
                          ? [...schedule.days, index]
                          : schedule.days.filter((value) => value !== index),
                      })
                    }
                  />
                ))}
              </fieldset>
            )}
            <div className="carbon-job-preview" aria-live="polite">
              <span>Next occurrence preview</span>
              <strong>{preview[0] ? automationDate(preview[0]) : "Enter a valid schedule"}</strong>
            </div>
            <Checkbox
              id={`${promptId}-enabled`}
              labelText="Schedule enabled"
              checked={draft.enabled}
              onChange={(_event, { checked }) => set("enabled", checked)}
            />
          </FormGroup>
          <FormGroup legendText="Execution">
            <Select
              id={`${promptId}-agent`}
              labelText="Agent"
              required
              value={draft.agent}
              onChange={(event) => set("agent", event.target.value)}
            >
              <SelectItem value="" text="Choose a provider" />
              {agents.map((agent) => (
                <SelectItem key={agent} value={agent} text={agent} />
              ))}
            </Select>
            <div className="carbon-job-repository">
              <Button
                type="button"
                kind="tertiary"
                size="md"
                disabled={busy}
                onClick={() => void pick()}
              >
                Choose repository
              </Button>
              <span>{repository || "No repository chosen"}</span>
            </div>
            <TextInput
              id={`${promptId}-branch`}
              labelText="Local base branch"
              required
              value={draft.baseBranch}
              onChange={(event) => set("baseBranch", event.target.value)}
            />
            <TextInput
              id={`${promptId}-timeout`}
              labelText="Turn timeout"
              required
              value={draft.turnTimeout}
              onChange={(event) => set("turnTimeout", event.target.value)}
            />
          </FormGroup>

          <FormGroup legendText="Allowed tool kinds">
            <details className="carbon-job-permission-help">
              <summary>Permission limits</summary>
              <p id={permissionHelpId}>
                Everything else is denied without waiting for approval. Execute can grant broad
                user-account and network access. A worktree is not a sandbox.
              </p>
            </details>
            <div className="carbon-job-checkboxes">
              {TOOL_KINDS.map((kind) => (
                <Checkbox
                  key={kind}
                  id={`${promptId}-tool-${kind}`}
                  labelText={kind}
                  checked={draft.allow.includes(kind)}
                  aria-describedby={kind === "execute" ? permissionHelpId : undefined}
                  onChange={(_event, { checked }) =>
                    set(
                      "allow",
                      checked
                        ? [...draft.allow, kind]
                        : draft.allow.filter((value) => value !== kind),
                    )
                  }
                />
              ))}
            </div>
          </FormGroup>
        </fieldset>
        {error && (
          <InlineNotification
            kind="error"
            title="Could not save job"
            subtitle={error}
            hideCloseButton
          />
        )}
        {busy && <InlineLoading description="Saving scheduled job…" />}
        <div className="carbon-job-actions">
          <Button type="button" kind="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={busy || !repository || preview.length === 0 || (!!editor.id && !dirty)}
          >
            {editor.id ? "Save changes" : "Create job"}
          </Button>
        </div>
      </form>
    </section>
  );
}
