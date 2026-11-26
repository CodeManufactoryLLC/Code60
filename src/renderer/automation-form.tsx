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
  type AutomationActionType,
  type AutomationEditor,
  type RendererAutomationActionDraft,
  type RendererAutomationDraft,
  TOOL_KINDS,
  type WorkflowList,
  type WorkflowRecord,
} from "../bridge/index.js";
import { automationDate, automationWeekdays } from "./automation-date.js";
import { emptyWorkflowTask, WorkflowTaskEditor } from "./workflow-task-editor.js";

function defaultAction(
  type: AutomationActionType,
  agent: string,
  previous?: RendererAutomationActionDraft,
): RendererAutomationActionDraft {
  const repositoryToken = previous?.repositoryToken;
  const baseBranch = previous?.baseBranch ?? "main";
  const resolvedAgent =
    previous?.type === "prompt"
      ? previous.agent || agent
      : previous?.type === "workflow"
        ? previous.provider || agent
        : agent;
  if (type === "workflow") {
    return {
      type: "workflow",
      provider: resolvedAgent,
      baseBranch,
      tasks: [emptyWorkflowTask()],
      repairs: 2,
      retries: 2,
      autoApprove: true,
      ...(repositoryToken ? { repositoryToken } : {}),
    };
  }
  return {
    type: "prompt",
    prompt: "",
    agent: resolvedAgent,
    baseBranch,
    allow: [],
    turnTimeout: "30m",
    ...(repositoryToken ? { repositoryToken } : {}),
  };
}

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
  const [draft, setDraft] = useState<RendererAutomationDraft>(editor.draft);
  const [repository, setRepository] = useState(editor.repositoryLabel);
  const [preview, setPreview] = useState<string[]>([]);
  const [savedWorkflows, setSavedWorkflows] = useState<WorkflowRecord[]>([]);
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
      .automation({ action: "preview", schedule: draft.trigger.schedule })
      .then((result) => {
        if (current) setPreview(result as string[]);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [api, draft.trigger.schedule, active]);
  useEffect(() => {
    if (!active || draft.action.type !== "workflow") return;
    let current = true;
    void api
      .workflow({ action: "list" })
      .then((result) => {
        if (!current) return;
        const list = result as WorkflowList | null;
        setSavedWorkflows(list?.entries ?? []);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [api, active, draft.action.type]);

  const set = <K extends keyof RendererAutomationDraft>(
    key: K,
    value: RendererAutomationDraft[K],
  ) => setDraft((previous) => ({ ...previous, [key]: value }));

  const setAction = (next: RendererAutomationActionDraft) =>
    setDraft((previous) => ({ ...previous, action: next }));

  const schedule = draft.trigger.schedule;
  const setSchedule = (next: RendererAutomationDraft["trigger"]["schedule"]) =>
    set("trigger", { type: "schedule", schedule: next });

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
        setAction({ ...draft.action, repositoryToken: result.token });
        setRepository(result.label);
      }
    } catch (cause) {
      if (alive.current) setError((cause as Error).message);
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
    } catch (cause) {
      if (alive.current) setError((cause as Error).message);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const action = draft.action;

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
          <Select
            id={`${promptId}-action-type`}
            labelText="Job type"
            value={action.type}
            disabled={!!editor.id}
            onChange={(event) => {
              const nextType = event.target.value as AutomationActionType;
              if (nextType !== action.type) {
                setAction(defaultAction(nextType, agents[0] ?? "", action));
              }
            }}
          >
            <SelectItem value="prompt" text="Single prompt" />
            <SelectItem value="workflow" text="Workflow" />
          </Select>

          <FormGroup legendText="Schedule">
            <Select
              id={`${promptId}-schedule`}
              labelText="Frequency"
              value={schedule.type}
              onChange={(event) => {
                const type = event.target.value;
                setSchedule(
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
                  setSchedule({
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
                  onChange={(event) => setSchedule({ ...schedule, time: event.target.value })}
                />
                <TextInput
                  id={`${promptId}-timezone`}
                  labelText="Time zone"
                  required
                  value={schedule.timeZone}
                  onChange={(event) => setSchedule({ ...schedule, timeZone: event.target.value })}
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
                      setSchedule({
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

          {action.type === "prompt" ? (
            <>
              <TextArea
                id={promptId}
                labelText="Saved prompt"
                required
                maxLength={32000}
                rows={5}
                value={action.prompt}
                onChange={(event) => setAction({ ...action, prompt: event.target.value })}
              />
              <FormGroup legendText="Execution">
                <Select
                  id={`${promptId}-agent`}
                  labelText="Agent"
                  required
                  value={action.agent}
                  onChange={(event) => setAction({ ...action, agent: event.target.value })}
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
                  value={action.baseBranch}
                  onChange={(event) => setAction({ ...action, baseBranch: event.target.value })}
                />
                <TextInput
                  id={`${promptId}-timeout`}
                  labelText="Turn timeout"
                  required
                  value={action.turnTimeout}
                  onChange={(event) => setAction({ ...action, turnTimeout: event.target.value })}
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
                      checked={action.allow.includes(kind)}
                      aria-describedby={kind === "execute" ? permissionHelpId : undefined}
                      onChange={(_event, { checked }) =>
                        setAction({
                          ...action,
                          allow: checked
                            ? [...action.allow, kind]
                            : action.allow.filter((value) => value !== kind),
                        })
                      }
                    />
                  ))}
                </div>
              </FormGroup>
            </>
          ) : (
            <>
              <FormGroup legendText="Workflow execution">
                {savedWorkflows.length > 0 && (
                  <Select
                    id={`${promptId}-import-workflow`}
                    labelText="Copy tasks from saved workflow"
                    defaultValue=""
                    onChange={(event) => {
                      const chosen = savedWorkflows.find((item) => item.id === event.target.value);
                      if (!chosen) return;
                      setAction({
                        ...action,
                        provider:
                          chosen.definition.provider && agents.includes(chosen.definition.provider)
                            ? chosen.definition.provider
                            : action.provider,
                        tasks: structuredClone(chosen.definition.tasks),
                        repairs: chosen.definition.repairs,
                        retries: chosen.definition.retries,
                        autoApprove: chosen.definition.autoApprove,
                      });
                      if (!draft.name.trim()) set("name", chosen.name.slice(0, 80));
                    }}
                  >
                    <SelectItem value="" text="Choose a workflow to copy…" />
                    {savedWorkflows
                      .slice()
                      .reverse()
                      .map((entry) => (
                        <SelectItem
                          key={entry.id}
                          value={entry.id}
                          text={`${entry.name} (${entry.definition.tasks.length} ${entry.definition.tasks.length === 1 ? "task" : "tasks"})`}
                        />
                      ))}
                  </Select>
                )}
                <Select
                  id={`${promptId}-provider`}
                  labelText="Provider"
                  required
                  value={action.provider}
                  onChange={(event) => setAction({ ...action, provider: event.target.value })}
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
                  value={action.baseBranch}
                  onChange={(event) => setAction({ ...action, baseBranch: event.target.value })}
                />
                <TextInput
                  id={`${promptId}-repairs`}
                  labelText="Repairs per worker"
                  type="number"
                  required
                  min={0}
                  max={30}
                  value={action.repairs}
                  onChange={(event) =>
                    setAction({ ...action, repairs: Number(event.target.value) })
                  }
                />
                <TextInput
                  id={`${promptId}-retries`}
                  labelText="Fresh-session retries"
                  type="number"
                  required
                  min={0}
                  max={30}
                  value={action.retries}
                  onChange={(event) =>
                    setAction({ ...action, retries: Number(event.target.value) })
                  }
                />
                <Checkbox
                  id={`${promptId}-auto-approve`}
                  labelText="Automatically approve harness permissions"
                  checked={action.autoApprove}
                  aria-describedby={permissionHelpId}
                  onChange={(_event, { checked }) => setAction({ ...action, autoApprove: checked })}
                />
                <p id={permissionHelpId} className="carbon-job-permission-help">
                  When off, permission requests pause the workflow in Workflows for manual review. A
                  worktree is not a sandbox.
                </p>
              </FormGroup>

              <FormGroup legendText="Workflow tasks">
                <WorkflowTaskEditor
                  tasks={action.tasks}
                  disabled={busy}
                  onChange={(tasks) => setAction({ ...action, tasks })}
                />
              </FormGroup>
            </>
          )}
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
