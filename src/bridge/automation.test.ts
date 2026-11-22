import { expect, it } from "vitest";
import { automationEnvelopeSchema } from "../contracts/index.js";
import { parseAutomationUiRequest } from "./automation.js";

it("accepts only bounded exact notification identities at both boundaries", () => {
  const uuid = "12345678-1234-4234-8234-123456789abc";
  const executionIds = [uuid];
  for (const parse of [
    parseAutomationUiRequest,
    (value: unknown) =>
      automationEnvelopeSchema.parse({
        v: 1,
        token: "a".repeat(64),
        id: uuid,
        request: value,
      }).request,
  ]) {
    expect(parse({ action: "notifications" })).toEqual({ action: "notifications" });
    expect(parse({ action: "acknowledgeNotifications", executionIds })).toEqual({
      action: "acknowledgeNotifications",
      executionIds,
    });
    for (const invalid of [[], ["/tmp/path"], Array(51).fill(executionIds[0])])
      expect(() => parse({ action: "acknowledgeNotifications", executionIds: invalid })).toThrow();
    expect(() => parse({ action: "notifications", path: "/tmp" })).toThrow();
    expect(() =>
      parse({ action: "acknowledgeNotifications", executionIds, through: 99 }),
    ).toThrow();
  }
});
