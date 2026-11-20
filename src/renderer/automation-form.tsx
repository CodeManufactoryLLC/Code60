import { useEffect, useId, useRef, useState } from "react";
import {
  type AutomationEditor,
  type DesktopApi,
  type RendererAutomationDraft,
  TOOL_KINDS,
} from "../bridge/index.js";
import { automationDate } from "./automation-date.js";
import { Button } from "./neobrutalism/button.js";
import { Card, CardContent } from "./neobrutalism/card.js";
import { Textarea } from "./neobrutalism/textarea.js";

export function AutomationForm({
  api,
  editor,
  agents,
  active = true,
  onClose,
  onSaved,
}: {
  api: DesktopApi;
  editor: AutomationEditor;
  agents: string[];
  active?: boolean;
  onClose(): void;
  onSaved(): void;
}) {
  const promptId = useId();
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
      await api.automation(
        editor.id
          ? { action: "update", id: editor.id, revision: editor.revision, draft }
          : { action: "create", draft },
      );
      if (alive.current) onSaved();
    } catch (error) {
      if (alive.current) setError((error as Error).message);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Card
      className="automation-editor"
      size="sm"
      as="section"
      aria-label={editor.id ? "Edit scheduled job" : "New scheduled job"}
    >
      <CardContent>
        <h3>{editor.id ? "Edit job" : "New scheduled job"}</h3>
        <form
          className="automation-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset className="automation-form-fields" disabled={busy}>
            <label className="automation-name-field">
              Name
              <input
                required
                maxLength={80}
                value={draft.name}
                onChange={(event) => set("name", event.target.value)}
              />
            </label>
            <label className="automation-form-prompt" htmlFor={promptId}>
              Saved prompt
              <Textarea
                id={promptId}
                required
                maxLength={32000}
                value={draft.prompt}
                onChange={(event) => set("prompt", event.target.value)}
              />
            </label>
            <fieldset className="automation-form-basics">
              <legend>Execution</legend>
              <label>
                Agent
                <select
                  required
                  value={draft.agent}
                  onChange={(event) => set("agent", event.target.value)}
                >
                  <option value="">Choose a provider</option>
                  {agents.map((agent) => (
                    <option key={agent}>{agent}</option>
                  ))}
                </select>
              </label>
              <div className="automation-form-field">
                <span className="automation-form-label">Repository</span>
                <div className="automation-repository-choice">
                  <Button type="button" disabled={busy} onClick={() => void pick()}>
                    Choose repository
                  </Button>
                  <span>{repository || "No repository chosen"}</span>
                </div>
              </div>
              <label>
                Local base branch
                <input
                  required
                  value={draft.baseBranch}
                  onChange={(event) => set("baseBranch", event.target.value)}
                />
              </label>
              <label>
                Turn timeout
                <input
                  required
                  value={draft.turnTimeout}
                  onChange={(event) => set("turnTimeout", event.target.value)}
                />
              </label>
            </fieldset>
            <fieldset>
              <legend>Schedule</legend>
              <label>
                Schedule
                <select
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
                  <option value="interval">Interval</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
              {schedule.type === "interval" ? (
                <label>
                  Every (minutes)
                  <input
                    type="number"
                    required
                    min={1}
                    max={10080}
                    value={schedule.everyMinutes}
                    onChange={(event) =>
                      set("schedule", { ...schedule, everyMinutes: Number(event.target.value) })
                    }
                  />
                </label>
              ) : (
                <>
                  <label>
                    Time
                    <input
                      type="time"
                      required
                      value={schedule.time}
                      onChange={(event) =>
                        set("schedule", { ...schedule, time: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Time zone
                    <input
                      required
                      value={schedule.timeZone}
                      onChange={(event) =>
                        set("schedule", { ...schedule, timeZone: event.target.value })
                      }
                    />
                  </label>
                </>
              )}
              {schedule.type === "weekly" && (
                <div className="automation-actions">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => (
                    <label key={day}>
                      <input
                        type="checkbox"
                        checked={schedule.days.includes(index)}
                        onChange={(event) =>
                          set("schedule", {
                            ...schedule,
                            days: event.target.checked
                              ? [...schedule.days, index]
                              : schedule.days.filter((value) => value !== index),
                          })
                        }
                      />
                      {day}
                    </label>
                  ))}
                </div>
              )}
              <div className="automation-preview" aria-live="polite">
                <span>Next run</span>
                <strong>
                  {preview[0] ? automationDate(preview[0]) : "Enter a valid schedule"}
                </strong>
              </div>
              <label className="automation-form-enabled">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => set("enabled", event.target.checked)}
                />
                Schedule enabled
              </label>
            </fieldset>
            <fieldset>
              <legend>Allowed tool kinds</legend>
              <details className="automation-permissions-help">
                <summary>Permission limits</summary>
                <p>
                  Everything else is denied without waiting for approval. Execute can grant broad
                  user-account and network access. A worktree is not a sandbox.
                </p>
              </details>
              <div className="automation-actions">
                {TOOL_KINDS.map((kind) => (
                  <label key={kind}>
                    <input
                      type="checkbox"
                      checked={draft.allow.includes(kind)}
                      onChange={(event) =>
                        set(
                          "allow",
                          event.target.checked
                            ? [...draft.allow, kind]
                            : draft.allow.filter((value) => value !== kind),
                        )
                      }
                    />
                    {kind}
                  </label>
                ))}
              </div>
            </fieldset>
          </fieldset>
          {error && <p role="alert">{error}</p>}
          <div className="automation-actions automation-form-actions">
            <Button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={busy || !repository || preview.length === 0 || (!!editor.id && !dirty)}
            >
              {editor.id ? "Save changes" : "Create job"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
