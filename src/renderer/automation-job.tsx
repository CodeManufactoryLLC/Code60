import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type {
  AutomationEditor,
  AutomationSummary,
  AutomationUiRequest,
  DesktopApi,
} from "../bridge/index.js";
import { automationDate, automationWeekdays } from "./automation-date.js";
import { AutomationForm } from "./automation-form.js";
import { Icon } from "./icons.js";
import { AccordionContent, AccordionItem, AccordionTrigger } from "./neobrutalism/accordion.js";
import { Button } from "./neobrutalism/button.js";
import { Card, CardContent } from "./neobrutalism/card.js";

function cadence(schedule: AutomationEditor["draft"]["schedule"]) {
  if (schedule.type === "interval")
    return `Every ${schedule.everyMinutes} ${schedule.everyMinutes === 1 ? "minute" : "minutes"}`;
  return `${
    schedule.type === "daily"
      ? "Daily"
      : [...schedule.days]
          .sort()
          .map((day) => automationWeekdays[day])
          .join(", ")
  } at ${schedule.time} · ${schedule.timeZone}`;
}

export function AutomationJob({
  job,
  api,
  agents,
  active,
  open,
  busy,
  onToggle,
  onAction,
  onSaved,
}: {
  job: AutomationSummary;
  api: DesktopApi;
  agents: string[];
  active: boolean;
  open: boolean;
  busy: boolean;
  onToggle(): void;
  onAction(request: AutomationUiRequest): Promise<void>;
  onSaved(): void;
}) {
  const id = useId();
  const [editor, setEditor] = useState<AutomationEditor>();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const disclosureTrigger = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useLayoutEffect(() => {
    const closed = wasEditing.current && !editing;
    wasEditing.current = editing;
    if (closed && active && open) disclosureTrigger.current?.focus({ preventScroll: true });
  }, [editing, active, open]);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Revision and explicit Retry invalidate the saved details without changing the request ID.
  useEffect(() => {
    const owner = ++generation.current;
    if (!active || !open || editing) return;
    setLoading(true);
    setError("");
    void api
      .automation({ action: "get", id: job.id })
      .then((result) => {
        if (generation.current === owner) setEditor(result as AutomationEditor);
      })
      .catch((cause: unknown) => {
        if (generation.current === owner)
          setError(cause instanceof Error ? cause.message : "Could not load job details.");
      })
      .finally(() => {
        if (generation.current === owner) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [active, open, editing, api, job.id, job.revision, retry]);
  const running = job.running === true;
  const known = job.running !== undefined;
  const runLabel = `${running ? "Stop" : "Run"} ${job.name}`;
  const draft = editor?.draft;
  return (
    <AccordionItem className="automation-job">
      <div className="automation-job-header">
        <h3 id={`${id}-name`}>
          <span className="automation-job-heading">
            <span className="automation-job-name">
              {job.name}
              {!job.enabled && " (Paused)"}
            </span>
          </span>
        </h3>
        <div className="automation-job-controls">
          <Button
            variant="quiet"
            className={`automation-run-button${running ? " is-running" : ""}`}
            aria-label={runLabel}
            title={known ? runLabel : "Restart the Scheduling Service to use run controls"}
            disabled={busy || !known}
            onClick={() => void onAction({ action: running ? "cancel" : "runNow", id: job.id })}
          >
            <span className="automation-header-circle">
              <Icon name={running ? "pause" : "play"} />
            </span>
          </Button>
          <Button
            variant="quiet"
            className="automation-delete-button"
            aria-label={`Delete ${job.name}`}
            title={running ? "Stop the run before deleting" : `Delete ${job.name}`}
            disabled={busy || running}
            onClick={() => void onAction({ action: "delete", id: job.id, revision: job.revision })}
          >
            <span className="automation-header-circle">
              <Icon name="close" />
            </span>
          </Button>
          <AccordionTrigger
            ref={disclosureTrigger}
            aria-label={`${open ? "Collapse" : "Expand"} ${job.name}`}
            title={`${open ? "Collapse" : "Expand"} ${job.name}`}
            aria-controls={`${id}-details`}
            aria-expanded={open}
            onClick={onToggle}
          />
        </div>
      </div>
      <AccordionContent id={`${id}-details`} aria-labelledby={`${id}-name`} hidden={!open}>
        {loading && <p role="status">Loading job details…</p>}
        {error && (
          <div role="alert">
            {error} <Button onClick={() => setRetry((value) => value + 1)}>Retry details</Button>
          </div>
        )}
        {!loading &&
          !error &&
          editor &&
          draft &&
          (editing ? (
            <AutomationForm
              key={editor.id}
              api={api}
              editor={editor}
              active={active && open}
              agents={agents}
              onClose={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                onSaved();
              }}
            />
          ) : (
            <Card className="automation-job-details" size="sm">
              <CardContent>
                <section className="automation-prompt-section" aria-label="Saved prompt">
                  <h4>Prompt</h4>
                  <div className="automation-prompt-text">{draft.prompt}</div>
                </section>
                <dl className="automation-job-facts">
                  <div>
                    <dt>Schedule</dt>
                    <dd>{cadence(draft.schedule)}</dd>
                  </div>
                  <div>
                    <dt>Next run</dt>
                    <dd>{job.enabled ? automationDate(job.nextRunAt) : "Schedule paused"}</dd>
                  </div>
                  <div>
                    <dt>Agent</dt>
                    <dd>{draft.agent}</dd>
                  </div>
                  <div>
                    <dt>Turn timeout</dt>
                    <dd>{draft.turnTimeout}</dd>
                  </div>
                  <div>
                    <dt>Repository</dt>
                    <dd>{editor.repositoryLabel}</dd>
                  </div>
                  <div>
                    <dt>Base branch</dt>
                    <dd>{draft.baseBranch}</dd>
                  </div>
                  <div className="automation-fact-wide">
                    <dt>Allowed tools</dt>
                    <dd className="automation-tool-tags">
                      {draft.allow.length
                        ? draft.allow.map((kind) => <span key={kind}>{kind}</span>)
                        : "None"}
                    </dd>
                  </div>
                </dl>
                <div className="automation-details-actions">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void onAction({
                        action: "setEnabled",
                        id: job.id,
                        revision: job.revision,
                        enabled: !job.enabled,
                      })
                    }
                  >
                    {job.enabled ? "Pause schedule" : "Enable schedule"}
                  </Button>
                  <Button disabled={busy} onClick={() => setEditing(true)}>
                    Edit job
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
      </AccordionContent>
    </AccordionItem>
  );
}
