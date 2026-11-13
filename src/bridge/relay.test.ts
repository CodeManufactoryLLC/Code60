import { expect, it } from "vitest";
import { parseRelayMessageRead } from "./relay.js";

it("accepts only opaque Relay message source identities, never paths or byte offsets", () => {
  const request = { conversationId: crypto.randomUUID(), source: crypto.randomUUID() };
  expect(parseRelayMessageRead(request)).toEqual(request);
  expect(parseRelayMessageRead({ ...request, cursor: crypto.randomUUID() })).toHaveProperty(
    "cursor",
  );
  for (const invalid of [
    {},
    { ...request, source: "/private/history.frames" },
    { ...request, cursor: 123 },
    { ...request, position: 123 },
    { ...request, path: "/private/history.frames" },
  ])
    expect(() => parseRelayMessageRead(invalid)).toThrow("Invalid Relay source");
});
