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

it("pairs project instance and database epoch for every task action", () => {
  const identity = {
    project: "/project",
    projectId: crypto.randomUUID(),
    databaseEpoch: 0,
    reviewId: crypto.randomUUID(),
  };
  for (const action of [
    { type: "status" },
    { type: "cancel" },
    { type: "prepare", revisionId: crypto.randomUUID() },
    { type: "file", operationId: crypto.randomUUID(), fileId: crypto.randomUUID() },
    ...["apply", "undo", "recover", "revise"].map((type) => ({
      type,
      operationId: crypto.randomUUID(),
    })),
  ]) {
    const value = { ...identity, ...action };
    expect(parseTaskAction(value)).toEqual(value);
    for (const extra of [
      { projectId: undefined },
      { databaseEpoch: undefined },
      { projectId: "/project" },
      { databaseEpoch: -1 },
      { databaseEpoch: Number.MAX_SAFE_INTEGER + 1 },
    ])
      expect(() => parseTaskAction({ ...value, ...extra })).toThrow("Invalid task request");
  }
});
