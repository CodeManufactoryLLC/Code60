import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultTransitionTimes,
  maxTransitionTime,
  parseTransitionTimes,
  stepTransitionTime,
  transitionSliderSteps,
  transitionTimeFields,
  transitionTimeFromSlider,
  transitionTimeLabel,
  transitionTimeProperties,
  transitionTimeToSlider,
} from "./transition-times.js";

afterEach(() => vi.unstubAllGlobals());

describe("transition-time preferences", () => {
  it("defaults every transition to 175 ms and bounds every field independently", () => {
    expect(defaultTransitionTimes).toEqual({
      replyEntrance: 175,
      scrollResponse: 175,
      activityFade: 175,
      activityDetails: 175,
    });
    for (const raw of [null, "", "bad JSON", "null", "[]", '"text"', "42"])
      expect(parseTransitionTimes(raw)).toEqual(defaultTransitionTimes);
    expect(
      parseTransitionTimes(
        JSON.stringify({
          version: 1,
          replyEntrance: -100,
          scrollResponse: maxTransitionTime + 1,
          activityFade: "100",
          activityDetails: 456.7,
          ignored: "untrusted",
        }),
      ),
    ).toEqual({
      replyEntrance: 0,
      scrollResponse: maxTransitionTime,
      activityFade: 175,
      activityDetails: 457,
    });
    expect(parseTransitionTimes('{"replyEntrance":1e1000}').replyEntrance).toBe(175);
    expect(parseTransitionTimes('{"version":2,"replyEntrance":900}')).toEqual(
      defaultTransitionTimes,
    );
  });

  it("halves legacy saved values without halving defaults or repeatedly scaling new saves", () => {
    const legacy = JSON.stringify({
      replyEntrance: 350,
      scrollResponse: 1000,
      activityFade: 0,
      activityDetails: 30_000,
    });
    const expected = {
      replyEntrance: 175,
      scrollResponse: 500,
      activityFade: 0,
      activityDetails: 15_000,
    };
    expect(parseTransitionTimes(legacy)).toEqual(expected);
    expect(parseTransitionTimes(legacy)).toEqual(expected);
    expect(parseTransitionTimes(JSON.stringify({ ...expected, version: 1 }))).toEqual(expected);
    expect(parseTransitionTimes('{"replyEntrance":9,"activityFade":"invalid"}')).toEqual({
      ...defaultTransitionTimes,
      replyEntrance: 5,
    });
    expect(parseTransitionTimes('{"replyEntrance":-20,"scrollResponse":90000}')).toEqual({
      ...defaultTransitionTimes,
      replyEntrance: 0,
      scrollResponse: 15_000,
    });
  });

  it("offers a monotonic wide slider with exact endpoints and fine fast-end control", () => {
    expect(transitionTimeFromSlider(0)).toBe(0);
    expect(transitionTimeFromSlider(transitionSliderSteps)).toBe(maxTransitionTime);
    expect(transitionTimeToSlider(0)).toBe(0);
    expect(transitionTimeToSlider(maxTransitionTime)).toBe(transitionSliderSteps);
    expect(transitionTimeFromSlider(-1)).toBe(0);
    expect(transitionTimeFromSlider(transitionSliderSteps + 1)).toBe(maxTransitionTime);
    expect(transitionTimeFromSlider(Number.NaN)).toBe(0);
    expect(transitionTimeToSlider(Number.POSITIVE_INFINITY)).toBe(0);
    expect(stepTransitionTime(0, 1)).toBe(1);
    expect(stepTransitionTime(1, -1)).toBe(0);
    expect(stepTransitionTime(0, -1)).toBe(0);
    expect(stepTransitionTime(maxTransitionTime, 1)).toBe(maxTransitionTime);
    let previous = 0;
    for (let position = 0; position <= transitionSliderSteps; position++) {
      const time = transitionTimeFromSlider(position);
      expect(time).toBeGreaterThanOrEqual(previous);
      expect(time).toBeLessThanOrEqual(maxTransitionTime);
      previous = time;
    }
    for (const time of Object.values(defaultTransitionTimes)) {
      const position = transitionTimeToSlider(time);
      expect(transitionTimeFromSlider(position)).toBeCloseTo(time, -1);
      expect(
        transitionTimeFromSlider(position + 1) - transitionTimeFromSlider(position),
      ).toBeLessThan(5);
    }
  });

  it("labels instant/short/long values and emits only trusted CSS properties at both extremes", () => {
    expect(transitionTimeLabel(0)).toBe("Instant");
    expect(transitionTimeLabel(75)).toBe("75 ms");
    expect(transitionTimeLabel(1500)).toBe("1.5 s");
    expect(transitionTimeLabel(maxTransitionTime)).toBe("30 s");
    for (const time of [0, maxTransitionTime]) {
      const times = { ...defaultTransitionTimes };
      for (const field of transitionTimeFields) times[field.id] = time;
      const properties = transitionTimeProperties(times);
      expect(Object.keys(properties)).toHaveLength(4);
      expect(Object.values(properties)).toEqual(Array(4).fill(`${time}ms`));
    }
  });

  it("persists timing changes and reports storage failures", async () => {
    vi.resetModules();
    const storage = {
      setItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", storage);
    const preferences = await import("./transition-times.js");
    expect(preferences.saveTransitionTimes({ ...defaultTransitionTimes, activityFade: 9000 })).toBe(
      true,
    );
    expect(storage.setItem).toHaveBeenCalledWith(
      "code60.transitionTimes",
      JSON.stringify({ ...defaultTransitionTimes, activityFade: 9000, version: 1 }),
    );
    storage.setItem.mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    expect(preferences.saveTransitionTimes(defaultTransitionTimes)).toBe(false);
    vi.resetModules();
  });
});
