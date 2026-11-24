import { Slider } from "@carbon/react";
import { useId, useState } from "react";
import { Button as AppButton } from "./carbon/button.js";
import { TextInput as CarbonTextInput } from "./carbon/fields.js";
import { ControlDescription } from "./overlays.js";
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
      <AppButton
        type="button"
        className="settings-group-reset"
        onClick={() => update(defaultTransitionTimes)}
      >
        Reset transitions
      </AppButton>
      {transitionTimeFields.map((field) => {
        const sliderId = `${id}-${field.id}`;
        const tipId = `${sliderId}-tip`;
        const time = times[field.id];
        return (
          <div className="transition-setting" key={field.id}>
            <div className="transition-setting-heading">
              <span className="settings-label">
                <span>{field.label}</span>
                <ControlDescription id={tipId}>
                  {`${field.tip} Range: 0 to 30 seconds. Zero is instant. System reduced motion overrides these settings. Changes apply immediately and are saved on this device.`}
                </ControlDescription>
              </span>
              <output htmlFor={sliderId}>{transitionTimeLabel(time)}</output>
            </div>
            <div className="transition-time-controls">
              <div className="transition-range">
                <Slider
                  id={sliderId}
                  labelText={field.label}
                  hideLabel
                  hideTextInput
                  min={0}
                  max={transitionSliderSteps}
                  minLabel="Instant"
                  maxLabel="30 s"
                  step={1}
                  value={transitionTimeToSlider(time)}
                  formatLabel={(_position, label) => label ?? transitionTimeLabel(time)}
                  aria-describedby={tipId}
                  onKeyDownCapture={(event) => {
                    if (event.key === "Home" || event.key === "End") {
                      event.preventDefault();
                      event.stopPropagation();
                      update({
                        ...times,
                        [field.id]: event.key === "Home" ? 0 : maxTransitionTime,
                      });
                      return;
                    }
                    const direction =
                      event.key === "ArrowRight" || event.key === "ArrowUp"
                        ? 1
                        : event.key === "ArrowLeft" || event.key === "ArrowDown"
                          ? -1
                          : 0;
                    if (!direction) return;
                    event.preventDefault();
                    event.stopPropagation();
                    update({ ...times, [field.id]: stepTransitionTime(time, direction) });
                  }}
                  onChange={({ value }) =>
                    update({ ...times, [field.id]: transitionTimeFromSlider(value) })
                  }
                />
              </div>
              <span className="settings-unit">
                <CarbonTextInput
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
