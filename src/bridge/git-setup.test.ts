import { expect, it } from "vitest";
import { parseGitProject, parseGitSetupCommit, parseGitSetupFile } from "./git-setup.js";

it("accepts only bounded project/session/file identities and author values", () => {
  const identity = { project: "/project", sessionId: crypto.randomUUID() };
  const request = {
    ...identity,
    fileIds: [crypto.randomUUID()],
    name: "Test",
    email: "test@example.invalid",
  };
  expect(parseGitSetupCommit(request)).toEqual(request);
  expect(() => parseGitProject({ project: "/project", command: "git init" })).toThrow();
  expect(() => parseGitSetupFile({ ...identity, fileId: "../private" })).toThrow();
  expect(() => parseGitSetupCommit({ ...request, paths: ["arbitrary"] })).toThrow();
  expect(() => parseGitSetupCommit({ ...request, name: "Bad\nName" })).toThrow();
  expect(() => parseGitSetupCommit({ ...request, sessionId: "unknown" })).toThrow();
});
