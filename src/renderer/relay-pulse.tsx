import { createContext, useEffect, useId, useRef, useState } from "react";
import type { OrchestrationChat } from "../bridge/index.js";

// Only the visible built-in Relay editor reports focus to the shell.
export const RelayInputFocus = createContext<((focused: boolean) => void) | undefined>(undefined);

function pulseState(chat: OrchestrationChat | undefined, listening: boolean, complete: boolean) {
  if (!chat) return "Unavailable";
  const run = chat.run;
  const activity = chat.activity?.state ?? run?.status;
  if (
    chat.error ||
    run?.pending.length ||
    chat.plans?.some((plan) => plan.state === "draft" || plan.state === "paused")
  )
    return "Attention";
  switch (activity) {
    case "failed":
    case "timed_out":
    case "interrupted":
    case "waiting":
    case "waiting_for_approval":
      return "Attention";
    case "responding":
      return "Speaking";
    case "cancelled":
    case "finished":
    case "idle":
    case undefined:
      if (complete) return "Complete";
      return listening ? "Listening" : "Idle";
    default:
      return "Thinking";
  }
}

export function RelayPulse({
  chat,
  listening,
  connected,
}: {
  chat: OrchestrationChat | undefined;
  listening: boolean;
  connected: boolean;
}) {
  const roomId = useId();
  const run = chat?.run;
  const completedTurn =
    run &&
    run.turns > 0 &&
    (run.status === "finished" || (run.status === "idle" && run.lastOutcome === "finished"))
      ? `${run.id}/${run.turns}`
      : undefined;
  const runId = run?.id;
  const previous = useRef({ runId, completedTurn });
  const [recent, setRecent] = useState<string>();
  useEffect(() => {
    const changed =
      runId === previous.current.runId && completedTurn !== previous.current.completedTurn;
    previous.current = { runId, completedTurn };
    if (!changed || !completedTurn) return;
    setRecent(completedTurn);
    const timeout = window.setTimeout(() => setRecent(undefined), 3000);
    return () => window.clearTimeout(timeout);
  }, [runId, completedTurn]);

  const state = connected
    ? pulseState(chat, listening, !!completedTurn && recent === completedTurn)
    : "Disconnected";
  const label = `Relay: ${state}`;
  return (
    <div className="relay-pulse-row">
      <svg
        className="relay-pulse-room"
        viewBox="-16 -6 32 12"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={`${roomId}-back`} x2="0" y2="1">
            <stop stopColor="var(--room-shadow)" />
            <stop offset="1" stopColor="var(--room-depth)" />
          </linearGradient>
          <linearGradient id={`${roomId}-left`}>
            <stop stopColor="var(--cds-layer-01)" />
            <stop offset="1" stopColor="var(--room-depth)" />
          </linearGradient>
          <linearGradient id={`${roomId}-right`} x1="1" x2="0">
            <stop stopColor="var(--room-highlight)" />
            <stop offset="1" stopColor="var(--room-depth)" />
          </linearGradient>
          <linearGradient id={`${roomId}-ceiling`} x2="0" y2="1">
            <stop stopColor="var(--cds-layer-01)" />
            <stop offset="1" stopColor="var(--room-shadow)" />
          </linearGradient>
          <linearGradient id={`${roomId}-floor`} x2="0" y2="1">
            <stop stopColor="var(--room-depth)" />
            <stop offset="1" stopColor="var(--room-highlight)" />
          </linearGradient>
        </defs>
        <rect x="-16" y="-6" width="32" height="12" fill={`url(#${roomId}-back)`} />
        <path d="M-16 -16 L-3.5 -3.5 V3.5 L-16 16Z" fill={`url(#${roomId}-left)`} />
        <path d="M16 -16 L3.5 -3.5 V3.5 L16 16Z" fill={`url(#${roomId}-right)`} />
        <path d="M-6 -6 H6 L3.5 -3.5 H-3.5Z" fill={`url(#${roomId}-ceiling)`} />
        <path d="M-3.5 3.5 H3.5 L6 6 H-6Z" fill={`url(#${roomId}-floor)`} />
      </svg>
      <span
        className="relay-pulse"
        role="img"
        aria-label={label}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard focus reveals the current Relay activity label.
        tabIndex={0}
        data-state={state}
      >
        <span className="relay-pulse-core" />
        <svg viewBox="0 0 40 40" aria-hidden="true">
          {state === "Listening" && (
            <path className="relay-arcs" d="M9 10a15 15 0 0 0 0 20 M31 10a15 15 0 0 1 0 20" />
          )}
          {state === "Thinking" && (
            <circle
              className="relay-orbit"
              cx="20"
              cy="20"
              r="14"
              pathLength="100"
              strokeDasharray="80 20"
            />
          )}
          {state === "Speaking" && (
            <>
              <circle className="relay-wave" cx="20" cy="20" r="13" />
              <circle className="relay-wave relay-wave-next" cx="20" cy="20" r="17" />
            </>
          )}
          {state === "Complete" && <path className="relay-mark" d="m15.5 20 3 3 6-6" />}
          {state === "Attention" && <path className="relay-mark" d="M20 15.5v5 M20 24v.25" />}
        </svg>
      </span>
      <span className="relay-pulse-label" aria-hidden="true">
        {label}
      </span>
    </div>
  );
}
