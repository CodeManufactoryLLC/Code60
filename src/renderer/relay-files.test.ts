import { expect, it } from "vitest";
import type { Snapshot } from "../bridge/index.js";
import { relayFileRoots, relayFileScope } from "./relay-files.js";

const snapshot = {
  chat: { kind: "project", projectId: "project-b" },
  chats: [{ kind: "relay", conversationId: "relay-id", generation: 2 }],
  directory: "/selected-project",
  runs: [
    { relay: { conversationId: "relay-id", generation: 2, targetId: "a", cwd: "/explicit-a" } },
    { relay: { conversationId: "relay-id", generation: 2, targetId: "a", cwd: "/explicit-a" } },
    { relay: { conversationId: "relay-id", generation: 1, targetId: "old", cwd: "/old" } },
    { relay: { conversationId: "another-relay", generation: 2, targetId: "other", cwd: "/other" } },
    { record: { project: "/selected-project" } },
  ],
} as unknown as Snapshot;

it("offers only Relay workspace and unique current-generation owned targets, independent of selection", () => {
  expect(relayFileRoots(snapshot)).toEqual([
    { path: "workspace", label: "Relay workspace" },
    { path: "target:a", label: "Target · /explicit-a" },
  ]);
  expect(relayFileScope(snapshot, "workspace")).toEqual({
    kind: "conversation",
    conversationId: "relay-id",
    generation: 2,
  });
  expect(relayFileScope(snapshot, "target:a")).toEqual({
    kind: "target",
    conversationId: "relay-id",
    generation: 2,
    targetId: "a",
  });
  for (const root of ["target:old", "target:other", "/explicit-a", "/selected-project"])
    expect(relayFileScope(snapshot, root)).toBeUndefined();
  expect(relayFileRoots(undefined)).toEqual([]);
  expect(relayFileScope(undefined, "workspace")).toBeUndefined();
  const disconnected = { ...snapshot, chats: [{ kind: "relay" }] } as unknown as Snapshot;
  expect(relayFileRoots(disconnected)).toEqual([]);
  expect(relayFileScope(disconnected, "workspace")).toBeUndefined();
});
