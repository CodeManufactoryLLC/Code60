import { useSyncExternalStore } from "react";

export const maxTransitionTime = 30_000;
export const transitionSliderSteps = 1000;
export type TransitionTimes = Readonly<{
  replyEntrance: number;
  scrollResponse: number;
  activityFade: number;
  activityDetails: number;
}>;
export const defaultTransitionTimes: TransitionTimes = Object.freeze({
  replyEntrance: 175,
  scrollResponse: 175,
  activityFade: 175,
  activityDetails: 175,
});

export const transitionTimeFields = [
  {
    id: "replyEntrance",
    label: "Reply entrance",
    property: "--chat-reply-duration",
    tip: "Time for new messages to take up space smoothly, moving the status row with them, and for assistant replies to fade in. New streamed lines retarget the height without restarting the fade.",
  },
  {
    id: "scrollResponse",
    label: "Scroll response",
    property: "--chat-scroll-response",
    tip: "How gradually Chat catches up with content that is not already moving through Reply entrance. Higher values follow more slowly. Already-smoothed message growth keeps the status row anchored; scrolling up always stops following.",
  },
  {
    id: "activityFade",
    label: "Activity fade",
    property: "--chat-activity-duration",
    tip: "Time for each activity fade, the centered Connecting indicator's fade, and the activity row's expansion or collapse. Approval, stopping and errors still appear immediately.",
  },
  {
    id: "activityDetails",
    label: "Activity dropdown",
    property: "--chat-details-duration",
    tip: "Time for activity details to expand or collapse. Manual scrolling interrupts automatic reveal.",
  },
] as const;

const storageKey = "code60.transitionTimes";
const storageVersion = 1;
const listeners = new Set<() => void>();
let current: TransitionTimes | undefined;

function bounded(value: number) {
  return Math.round(Math.max(0, Math.min(maxTransitionTime, value)));
}

export function parseTransitionTimes(raw: string | null): TransitionTimes {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaultTransitionTimes;
    const record = value as Record<string, unknown>;
    if (record.version !== undefined && record.version !== storageVersion)
      return defaultTransitionTimes;
    // Halve legacy durations once. Versioned saves already contain the displayed millisecond values.
    const scale = record.version === storageVersion ? 1 : 0.5;
    const result = { ...defaultTransitionTimes };
    for (const { id } of transitionTimeFields) {
      const time = record[id];
      if (typeof time === "number" && Number.isFinite(time))
        result[id] = bounded(Math.max(0, Math.min(maxTransitionTime, time)) * scale);
    }
    return Object.freeze(result);
  } catch {
    return defaultTransitionTimes;
  }
}

/** Preserve fine control at short durations without compressing the multi-second range. */
export function transitionTimeFromSlider(position: number): number {
  if (!Number.isFinite(position)) return 0;
  const fraction = Math.max(0, Math.min(transitionSliderSteps, position)) / transitionSliderSteps;
  return bounded(Math.expm1(fraction * Math.log1p(maxTransitionTime / 10)) * 10);
}

export function transitionTimeToSlider(time: number): number {
  if (!Number.isFinite(time)) return 0;
  return Math.round(
    (Math.log1p(bounded(time) / 10) / Math.log1p(maxTransitionTime / 10)) * transitionSliderSteps,
  );
}

export function transitionTimeLabel(time: number): string {
  if (time === 0) return "Instant";
  return time < 1000 ? `${time} ms` : `${Number((time / 1000).toFixed(3))} s`;
}

export function stepTransitionTime(time: number, direction: -1 | 1): number {
  const next = transitionTimeFromSlider(transitionTimeToSlider(time) + direction);
  // Several low-end slider positions represent the same whole millisecond.
  return bounded(next === time ? time + direction : next);
}

export function transitionTimeProperties(times: TransitionTimes): Record<string, string> {
  return Object.fromEntries(
    transitionTimeFields.map(({ id, property }) => [property, `${times[id]}ms`]),
  );
}

function snapshot(): TransitionTimes {
  if (!current) {
    try {
      current = parseTransitionTimes(localStorage.getItem(storageKey));
    } catch {
      current = defaultTransitionTimes;
    }
  }
  return current;
}

export function useTransitionTimes(): TransitionTimes {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot,
    () => defaultTransitionTimes,
  );
}

/** Apply for this session even when browser storage is unavailable; report that separately. */
export function saveTransitionTimes(times: TransitionTimes): boolean {
  current = parseTransitionTimes(JSON.stringify({ ...times, version: storageVersion }));
  let saved = true;
  try {
    localStorage.setItem(storageKey, JSON.stringify({ ...current, version: storageVersion }));
  } catch {
    saved = false;
  }
  for (const listener of listeners) listener();
  return saved;
}
