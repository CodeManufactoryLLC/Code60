import { expect, it } from "vitest";
import {
  parseGitProject,
  parseGitSetupCommit,
  parseGitSetupFile,
  parseGitSetupIdentity,
} from "./git-setup.js";

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

it("requires a paired project instance and database epoch for Git setup addresses", () => {
  const identity = {
    project: "/project",
    projectId: crypto.randomUUID(),
    databaseEpoch: 0,
  };
  const session = { ...identity, sessionId: crypto.randomUUID() };
  for (const { parse, value } of [
    { parse: parseGitProject, value: identity },
    { parse: parseGitSetupIdentity, value: session },
    { parse: parseGitSetupFile, value: { ...session, fileId: crypto.randomUUID() } },
    {
      parse: parseGitSetupCommit,
      value: { ...session, fileIds: [], name: "Test", email: "test@example.invalid" },
    },
  ]) {
    expect(parse(value)).toEqual(value);
    for (const extra of [
      { projectId: undefined },
      { databaseEpoch: undefined },
      { projectId: "/project" },
      { databaseEpoch: -1 },
      { databaseEpoch: 0.5 },
      { databaseEpoch: Number.MAX_SAFE_INTEGER + 1 },
    ])
      expect(() => parse({ ...value, ...extra })).toThrow("Invalid Git setup request");
  }
});
