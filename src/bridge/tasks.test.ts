import { expect, it } from "vitest";
import { parseTaskAction } from "./tasks.js";

it("accepts scoped generated identities and rejects paths, commands and unknown fields", () => {
  const request = {
    type: "apply",
    project: "/project",
    reviewId: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
  };
  expect(parseTaskAction(request)).toEqual(request);
  for (const extra of [{ path: "../outside" }, { command: "git reset" }, { fileId: "file.txt" }])
    expect(() => parseTaskAction({ ...request, ...extra })).toThrow("Invalid task request");
  expect(() => parseTaskAction({ ...request, operationId: "../../outside" })).toThrow();
});
