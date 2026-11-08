import { useEffect, useRef, useState } from "react";
import type { ActivitySnapshot, ActivityState } from "../bridge/index.js";
import analyzing from "./activity-animations/analyzing.gif";
import communicating from "./activity-animations/communicating.gif";
import comparing from "./activity-animations/comparing.gif";
import delegating from "./activity-animations/delegating.gif";
import downloading from "./activity-animations/downloading.gif";
import editing from "./activity-animations/editing.gif";
import executing from "./activity-animations/executing.gif";
import planning from "./activity-animations/planning.gif";
import reading from "./activity-animations/reading.gif";
import searching from "./activity-animations/searching.gif";
import summarizing from "./activity-animations/summarizing.gif";
import testing from "./activity-animations/testing.gif";
import uploading from "./activity-animations/uploading.gif";
import verifying from "./activity-animations/verifying.gif";
import waiting_for_workers from "./activity-animations/waiting_for_workers.gif";
import working from "./activity-animations/working.gif";
import writing from "./activity-animations/writing.gif";
import { durationText } from "./chat-presentation.js";
import { Icon, type IconName } from "./icons.js";
import { useTicker } from "./ticker.js";

/** Presentation is local: the MCP vocabulary never contains these choices. */
const visuals: Partial<Record<ActivityState, IconName>> = {
  searching: "search",
  reading: "document",
  writing: "chat",
  responding: "chat",
  editing: "document",
  summarizing: "document",
  comparing: "compare",
  analyzing: "view",
  planning: "branch",
  delegating: "branch",
  dispatching: "branch",
  communicating: "chat",
  sending: "chat",
  receiving: "chat",
  uploading: "arrow--up",
  downloading: "arrow--down",
  retrieving: "arrow--down",
  executing: "terminal",
  testing: "terminal",
  verifying: "view",
  deleting: "trash-can",
  moving: "folder",
  waiting_for_workers: "time",
  waiting_for_approval: "pause",
  stopping: "stop",
  cancelled: "stop",
  failed: "error",
  interrupted: "warning--alt",
  timed_out: "time",
  idle: "chat",
  finished: "chat",
  connecting: "renew",
  preparing: "time",
};
export function activityIcon(state: ActivityState): IconName {
  return visuals[state] ?? "information";
}

/** Only specific semantic matches share artwork; retrieving does not imply downloading. */
const animations: Partial<Record<ActivityState, string>> = {
  planning,
  searching,
  reading,
  analyzing,
  comparing,
  writing,
  editing,
  summarizing,
  delegating,
  communicating,
  waiting_for_workers,
  executing,
  testing,
  verifying,
  uploading,
  downloading,
  working,
  responding: writing,
  dispatching: delegating,
  sending: communicating,
  receiving: communicating,
};

export function activityAnimation(state: ActivityState): string | undefined {
  return animations[state];
}

export function activityLabel(state: ActivityState): string {
  if (state === "waiting_for_workers") return "Monitoring subagents";
  const words = state.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function ActivityArtwork({ state, animate }: { state: ActivityState; animate: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = activityAnimation(state);
  return (
    <span className="activity-visual" aria-hidden="true">
      {animate && src && !failed ? (
        <img src={src} alt="" width={48} height={48} onError={() => setFailed(true)} />
      ) : (
        <Icon name={activityIcon(state)} />
      )}
    </span>
  );
}

/** Time in this displayed activity, independent of purpose edits and animation preferences. */
function ActivityTimer({ visible }: { visible: boolean }) {
  const [startedAt] = useState(Date.now);
  const now = useTicker(visible, 1000);
  return (
    <span
      className="activity-timer"
      role="timer"
      aria-live="off"
      aria-label="Time in current activity"
    >
      {durationText(Math.max(0, now - startedAt))}
    </span>
  );
}

/** Fade ordinary changes within a bounded window; urgent host states interrupt immediately. */
export function ActivityDisplay({
  activity,
  fallback,
  delegated,
  hidden = false,
  override,
  id,
  expanded = false,
  controls,
  onToggle,
}: {
  activity: ActivitySnapshot | undefined;
  fallback: string;
  delegated: string;
  hidden?: boolean;
  id?: string;
  expanded?: boolean;
  controls?: string;
  onToggle?(): void;
  override?: "Stopping" | "Connecting" | "Sending" | undefined;
}) {
  const target: ActivitySnapshot | undefined = override
    ? {
        state:
          override === "Stopping"
            ? "stopping"
            : override === "Connecting"
              ? "connecting"
              : "sending",
        label: override,
        source: "host",
        declaration: activity?.declaration ?? null,
        otherOperations: activity?.otherOperations ?? 0,
        workerCount: activity?.workerCount ?? 0,
        active: true,
        urgent: override === "Stopping",
      }
    : activity;
  const [displayed, setDisplayed] = useState(target);
  const [exiting, setExiting] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const latest = useRef(target);
  latest.current = target;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Avoid scheduling redraws just because an unrelated snapshot arrived.
  const signature = JSON.stringify(target);
  const immediate =
    hidden ||
    !documentVisible ||
    reducedMotion ||
    (target?.urgent === true && target.state !== "idle" && target.state !== "waiting_for_workers");
  useEffect(() => {
    const value: ActivitySnapshot | undefined =
      signature === undefined ? undefined : JSON.parse(signature);
    if (
      immediate ||
      value?.state === displayed?.state ||
      displayed?.state === undefined ||
      displayed?.state === "idle"
    ) {
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = undefined;
      setExiting(false);
      setDisplayed(value);
    } else if (timer.current === undefined) {
      setExiting(true);
      timer.current = setTimeout(() => {
        timer.current = undefined;
        setDisplayed(latest.current);
        setExiting(false);
      }, 200);
    }
  }, [signature, immediate, displayed?.state]);
  useEffect(() => {
    const visibility = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      if (timer.current !== undefined) clearTimeout(timer.current);
    };
  }, []);
  const value = immediate ? target : displayed;
  const state = value?.state ?? "idle";
  if (state === "idle") return null;
  const active =
    value?.active === true || state === "waiting_for_workers" || state === "connecting";
  const animate = active && !hidden && documentVisible && !reducedMotion && state !== "stopping";
  const name = value || override ? activityLabel(state) : fallback;
  const label = `${name}${active ? "..." : ""}`;
  const source = value?.source ?? "host";
  const details = [
    `${source === "declared" ? "Agent-reported" : source === "observed" ? "Observed" : "Host"} activity: ${name}`,
    value?.declaration ? `Agent-reported purpose: ${value.declaration.label}` : null,
    value?.otherOperations
      ? `${value.otherOperations} other operation${value.otherOperations === 1 ? "" : "s"}`
      : null,
    delegated || null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      id={id}
      className="chat-progress activity-display"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.preventDefault();
          onToggle?.();
        }
      }}
      data-tooltip={details}
      aria-description={details}
      data-activity={state}
      data-source={source}
      data-animate={animate}
      data-exiting={!immediate && exiting}
      data-collapsing={!immediate && exiting && (!target || target.state === "idle")}
      aria-live="off"
      data-immediate={immediate}
    >
      <ActivityArtwork key={state} state={state} animate={animate} />
      <span className="activity-name">
        <span role="status" aria-live="polite" aria-atomic="true">
          {label}
        </span>
        {active && (
          <>
            {" "}
            <ActivityTimer key={state} visible={!hidden && documentVisible} />
          </>
        )}
      </span>
    </button>
  );
}
