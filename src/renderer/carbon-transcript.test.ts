import type { ChatInstance, MessageResponse } from "@carbon/ai-chat";
import { expect, it, vi } from "vitest";
import { CarbonTranscript } from "./carbon-transcript.js";

it("prepends only missing history and retires obsolete response slots on Undo or reorder", async () => {
  const cache = new CarbonTranscript();
  const slots = new Map<string, unknown>();
  const record = (message: MessageResponse) => {
    slots.set(message.id!, message.output.generic?.[0]?.user_defined?.slot);
  };
  const messaging = {
    insertHistory: vi.fn<ChatInstance["messaging"]["insertHistory"]>(async (history) => {
      for (const item of history) record(item.message as MessageResponse);
    }),
    removeMessages: vi.fn(async (_ids: string[]) => {}),
    upsertMessage: vi.fn<ChatInstance["messaging"]["upsertMessage"]>(async (_id, _state, update) =>
      record(await update(undefined)),
    ),
  };
  const set = (...ids: string[]) =>
    cache.reconcile(
      messaging,
      ids.map((id) => [id, "assistant", null]),
      () => true,
    );
  await set("b", "d");
  const original = slots.get("d");
  await set("a", "b", "d");
  expect(messaging.insertHistory.mock.calls[1]?.[0].map((item) => item.message.id)).toEqual(["a"]);
  expect(messaging.removeMessages).not.toHaveBeenCalled();
  expect(cache.isCurrent("d", original)).toBe(true);
  await set("a", "b", "c", "d");
  expect(cache.isCurrent("d", original)).toBe(false);
  expect(cache.isCurrent("d", slots.get("d"))).toBe(true);
  await set("a", "b");
  expect(cache.isCurrent("c", slots.get("c"))).toBe(false);
  expect(messaging.upsertMessage).toHaveBeenCalledTimes(2);
});
