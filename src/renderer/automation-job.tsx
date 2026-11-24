import {
  Button,
  InlineLoading,
  InlineNotification,
  OverflowMenu,
  OverflowMenuItem,
  TableCell,
  TableExpandedRow,
  TableExpandRow,
  Tag,
} from "@carbon/react";
import { useEffect, useState } from "react";
import type {
  ApplicationClient,
  AutomationEditor,
  AutomationSummary,
  AutomationUiRequest,
} from "../bridge/index.js";
import { automationDate, automationWeekdays } from "./automation-date.js";

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

function JobDetails({ api, job }: { api: ApplicationClient; job: AutomationSummary }) {
  const [details, setDetails] = useState<AutomationEditor>();
  const [error, setError] = useState("");
  const [attempt, retry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry repeats the read for the same job.
  useEffect(() => {
    let current = true;
    setDetails(undefined);
    setError("");
    void api
      .automation({ action: "get", id: job.id })
      .then((value) => {
        if (current) setDetails(value as AutomationEditor);
      })
      .catch((cause: unknown) => {
        if (current)
          setError(cause instanceof Error ? cause.message : "Could not read job details.");
      });
    return () => {
      current = false;
    };
  }, [api, job.id, attempt]);
  if (error)
    return (
      <>
        <InlineNotification
          kind="error"
          title="Job details unavailable"
          subtitle={error}
          hideCloseButton
        />
        <Button kind="ghost" onClick={() => retry((value) => value + 1)}>
          Retry details
        </Button>
      </>
    );
  if (!details) return <InlineLoading description="Loading job details…" />;
  const { draft } = details;
  return (
    <div className="carbon-job-details">
      <section>
        <h3>Saved prompt</h3>
        <p className="carbon-job-prompt">{draft.prompt}</p>
      </section>
      <dl className="carbon-job-facts">
        {Object.entries({
          Schedule: cadence(draft.schedule),
          Repository: details.repositoryLabel,
          "Base branch": draft.baseBranch,
          "Turn timeout": draft.turnTimeout,
          "Allowed tools": draft.allow.join(", ") || "None",
        }).map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
export function AutomationJob({
  job,
  api,
  active,
  open,
  busy,
  onToggle,
  onAction,
  onEdit,
  onHistory,
}: {
  job: AutomationSummary;
  api: ApplicationClient;
  active: boolean;
  open: boolean;
  busy: boolean;
  onToggle(): void;
  onAction(request: AutomationUiRequest): Promise<void>;
  onEdit(): void;
  onHistory(): void;
}) {
  const run = job.running ? "Stop" : "Run";
  const detailsId = `job-details-${job.id}`;
  return (
    <>
      <TableExpandRow
        id={`job-row-${job.id}`}
        isExpanded={open}
        {...(open ? { "aria-controls": detailsId } : {})}
        aria-label={`${open ? "Collapse" : "Expand"} ${job.name}`}
        expandHeader="schedule-details-heading"
        onExpand={onToggle}
      >
        <TableCell>{job.name}</TableCell>
        <TableCell>
          <Tag size="sm" type={job.enabled ? "green" : "gray"}>
            {job.enabled ? "Enabled" : "Paused"}
          </Tag>
        </TableCell>
        <TableCell>{job.enabled ? automationDate(job.nextRunAt) : "—"}</TableCell>
        <TableCell>
          {job.running === undefined ? (
            "Unknown"
          ) : job.running ? (
            <Tag size="sm" type="blue">
              Running
            </Tag>
          ) : (
            "Idle"
          )}
        </TableCell>
        <TableCell>{job.agent}</TableCell>
        <TableCell>
          <div className="carbon-job-actions">
            <Button
              size="sm"
              kind="ghost"
              aria-label={`${run} ${job.name}`}
              disabled={busy || job.running === undefined}
              onClick={() =>
                void onAction({ action: job.running ? "cancel" : "runNow", id: job.id })
              }
            >
              {run}
            </Button>
            <OverflowMenu
              id={`job-actions-${job.id}`}
              ariaLabel={`Actions for ${job.name}`}
              iconDescription={`Actions for ${job.name}`}
              flipped
              size="sm"
              disabled={busy}
            >
              <OverflowMenuItem itemText="Edit job" onClick={onEdit} />
              <OverflowMenuItem
                itemText={job.enabled ? "Pause schedule" : "Enable schedule"}
                onClick={() =>
                  void onAction({
                    action: "setEnabled",
                    id: job.id,
                    revision: job.revision,
                    enabled: !job.enabled,
                  })
                }
              />
              <OverflowMenuItem itemText="View history" onClick={onHistory} />
              <OverflowMenuItem
                itemText="Delete"
                hasDivider
                isDelete
                disabled={job.running === true}
                onClick={() =>
                  void onAction({ action: "delete", id: job.id, revision: job.revision })
                }
              />
            </OverflowMenu>
          </div>
        </TableCell>
      </TableExpandRow>
      {open && (
        <TableExpandedRow id={detailsId} colSpan={7}>
          {active && <JobDetails key={job.revision} api={api} job={job} />}
        </TableExpandedRow>
      )}
    </>
  );
}
