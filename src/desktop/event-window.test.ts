import { expect, it } from "vitest";
import type { SequencedEvent } from "../bridge/index.js";
import { EventWindow } from "./event-window.js";

const event = (revision: number, text = ""): SequencedEvent => ({
  revision,
  event: { type: "message", runId: "relay", at: "", text },
});

it("retains more than 512 events when only a character limit is configured", () => {
  const window = new EventWindow({ characters: 1_000_000 });
  const entries = Array.from({ length: 700 }, (_, index) => event(index, "😀"));
  for (const entry of entries) window.append(entry);
  expect(window.read()).toEqual(entries);
  expect(window.truncated).toBe(false);
  window.read().pop();
  expect(window.read()).toHaveLength(700);
});

it("evicts oldest events above exact capacity and clears accounting and truncation", () => {
  const first = event(1, "a");
  const second = event(2, "😀");
  const characters = JSON.stringify(first).length + JSON.stringify(second).length;
  const window = new EventWindow({ characters });
  window.append(first);
  window.append(second);
  expect(window.read()).toEqual([first, second]);
  expect(window.truncated).toBe(false);
  const third = event(3, "b");
  window.append(third);
  expect(window.read()).toEqual([second, third]);
  expect(window.truncated).toBe(true);
  window.clear();
  expect(window.read()).toEqual([]);
  expect(window.truncated).toBe(false);
  window.append(first);
  expect(window.read()).toEqual([first]);
});
