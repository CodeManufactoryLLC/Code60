import { useEffect, useId, useState } from "react";
import type { DesktopApi, Plan, PlanAction, PlanSummary } from "../bridge/index.js";

const states: Record<Plan["state"], string> = {
  draft: "Awaiting acceptance",
  queued: "Queued",
  running: "In progress",
  paused: "Paused",
  failed: "Delivery failed",
  completed: "Complete",
  dismissed: "Dismissed",
};
const taskStates: Record<Plan["tasks"][number]["state"], string> = {
  pending: "Pending",
  in_progress: "In progress",
  blocked: "Blocked",
  completed: "Completed",
};

export function PlanPanel({
  plan,
  api,
  currentChat,
  project,
}: {
  plan: Plan;
  api: DesktopApi;
  currentChat: string | undefined;
  project: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const completed = plan.tasks.filter((task) => task.state === "completed").length;
  const total = plan.tasks.length;
  const current = currentChat === plan.chatId;
  const available = current && project === plan.project && !pending;
  const action = async (type: PlanAction["type"]) => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await api.planAction({ type, chatId: plan.chatId, planId: plan.id, revision: plan.revision });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="plan-panel" aria-label="Plan">
      <header className="plan-toolbar">
        <div className="plan-progress-label" aria-live="polite">
          <span className="plan-state" data-state={plan.state}>
            {states[plan.state]}
          </span>
          <output className="plan-count" aria-label="Tasks completed">
            {completed} out of {total}
          </output>
        </div>
        <progress
          aria-label="Tasks completed"
          aria-valuetext={`${completed} out of ${total} tasks completed`}
          value={completed}
          max={total}
        />
        <div className="plan-actions">
          {plan.state === "draft" && (
            <button
              type="button"
              className="primary plan-action"
              disabled={!available}
              onClick={() => void action("accept")}
            >
              Accept
            </button>
          )}
          {(["paused", "failed"] as string[]).includes(plan.state) && (
            <button
              type="button"
              className="primary plan-action"
              disabled={!available}
              onClick={() => void action("resume")}
            >
              Resume plan
            </button>
          )}
          {!["running", "completed", "dismissed"].includes(plan.state) && (
            <button
              type="button"
              className="plan-action"
              disabled={!current || pending}
              onClick={() => void action("dismiss")}
            >
              Dismiss
            </button>
          )}
        </div>
        {plan.project !== project && (
          <p className="plan-notice" role="status">
            Open the plan’s project to continue.
          </p>
        )}
        {plan.error && (
          <p className="plan-notice" role="status">
            {plan.error}
          </p>
        )}
        {error && (
          <p className="plan-notice" role="alert">
            {error}
          </p>
        )}
      </header>
      <article className="plan-document" aria-label="Plan document">
        <h2 className="plan-title">{plan.title}</h2>
        {plan.description && <p className="plan-description">{plan.description}</p>}
        <ul className="plan-tasks">
          {plan.tasks.map((task) => (
            <li className="plan-task" key={task.id} data-state={task.state}>
              <span className="plan-task-check">
                <input
                  id={`${id}-task-${task.id}`}
                  type="checkbox"
                  checked={task.state === "completed"}
                  disabled
                  readOnly
                />
              </span>
              <label className="plan-task-text" htmlFor={`${id}-task-${task.id}`}>
                {task.text}
              </label>
              <span className="plan-task-status">
                <span className="plan-task-badge">{taskStates[task.state]}</span>
              </span>
              {task.target && (
                <p className="plan-task-note">
                  Target: <code>{task.target.cwd}</code> (
                  {task.target.workspaceMode === "direct"
                    ? "direct edits, no isolated apply or undo"
                    : "isolated worktree"}
                  )
                </p>
              )}
              {task.note && <p className="plan-task-note">{task.note}</p>}
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}
export function PlanPanelLoader({
  summary,
  api,
  currentChat,
  project,
}: {
  summary: PlanSummary;
  api: DesktopApi;
  currentChat: string | undefined;
  project: string | null;
}) {
  const [plan, setPlan] = useState<Plan>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Re-read after a persisted revision or an explicit retry.
  useEffect(() => {
    let active = true;
    setError("");
    void api
      .readPlan({ chatId: summary.chatId, planId: summary.id })
      .then((value) => {
        if (active) setPlan(value);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [api, summary.chatId, summary.id, summary.revision, retry]);
  if (error)
    return (
      <div role="alert">
        {error}{" "}
        <button type="button" onClick={() => setRetry((value) => value + 1)}>
          Retry
        </button>
      </div>
    );
  if (!plan || plan.id !== summary.id) return <p role="status">Loading plan…</p>;
  return <PlanPanel plan={plan} api={api} currentChat={currentChat} project={project} />;
}
