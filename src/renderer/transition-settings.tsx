import { useId, useState } from "react";
import { InfoTip } from "./overlays.js";
import {
  defaultTransitionTimes,
  maxTransitionTime,
  saveTransitionTimes,
  stepTransitionTime,
  type TransitionTimes,
  transitionSliderSteps,
  transitionTimeFields,
  transitionTimeFromSlider,
  transitionTimeLabel,
  transitionTimeToSlider,
  useTransitionTimes,
} from "./transition-times.js";

export function TransitionSettings() {
  const id = useId();
  const times = useTransitionTimes();
  const [unsaved, setUnsaved] = useState(false);
  const update = (next: TransitionTimes) => setUnsaved(!saveTransitionTimes(next));
  return (
    <fieldset className="settings-group transition-settings">
      <legend className="settings-group-title">Transitions</legend>
      <button
        type="button"
        className="settings-group-reset"
        onClick={() => update(defaultTransitionTimes)}
      >
        Reset transitions
      </button>
      {transitionTimeFields.map((field) => {
        const sliderId = `${id}-${field.id}`;
        const tipId = `${sliderId}-tip`;
        const time = times[field.id];
        return (
          <div className="transition-setting" key={field.id}>
            <div className="transition-setting-heading">
              <span className="settings-label">
                <label htmlFor={sliderId}>{field.label}</label>
                <InfoTip label={field.label} id={tipId}>
                  {`${field.tip} Range: 0 to 30 seconds. Zero is instant. System reduced motion overrides these settings. Changes apply immediately and are saved on this device.`}
                </InfoTip>
              </span>
              <output htmlFor={sliderId}>{transitionTimeLabel(time)}</output>
            </div>
            <div className="transition-time-controls">
              <div className="transition-range">
                <input
                  id={sliderId}
                  type="range"
                  min={0}
                  max={transitionSliderSteps}
                  step={1}
                  value={transitionTimeToSlider(time)}
                  aria-valuetext={transitionTimeLabel(time)}
                  aria-describedby={tipId}
                  onKeyDown={(event) => {
                    const direction =
                      event.key === "ArrowRight" || event.key === "ArrowUp"
                        ? 1
                        : event.key === "ArrowLeft" || event.key === "ArrowDown"
                          ? -1
                          : 0;
                    if (!direction) return;
                    event.preventDefault();
                    update({ ...times, [field.id]: stepTransitionTime(time, direction) });
                  }}
                  onChange={(event) =>
                    update({
                      ...times,
                      [field.id]: transitionTimeFromSlider(event.target.valueAsNumber),
                    })
                  }
                />
                <div className="transition-range-limits" aria-hidden="true">
                  <span>Instant</span>
                  <span>30 s</span>
                </div>
              </div>
              <span className="settings-unit">
                <input
                  type="number"
                  min={0}
                  max={maxTransitionTime}
                  step={1}
                  value={time}
                  aria-label={`${field.label} in milliseconds`}
                  aria-describedby={tipId}
                  onChange={(event) => {
                    const value = event.target.valueAsNumber;
                    if (Number.isFinite(value)) update({ ...times, [field.id]: value });
                  }}
                />
                <span>ms</span>
              </span>
            </div>
          </div>
        );
      })}
      {unsaved && (
        <div role="alert">
          Transitions changed for this session, but could not be saved. Change a value or use Reset
          transitions to retry.
        </div>
      )}
    </fieldset>
  );
}
