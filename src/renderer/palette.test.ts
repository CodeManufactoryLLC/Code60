import { describe, expect, it } from "vitest";
import { markParts, rankCommands } from "./palette.js";

const commands = [
  { label: "Settings", group: "Pages" },
  { label: "Discard worktree", hint: "claude / k3f2a9", group: "Session" },
  { label: "Theme: Dark", group: "Appearance" },
  { label: "Open project", group: "Project" },
];

describe("command ranking", () => {
  it("keeps the given order for an empty query", () => {
    expect(rankCommands(commands, "  ").map((entry) => entry.command.label)).toEqual(
      commands.map((command) => command.label),
    );
  });

  it("ranks label prefixes, then word starts, then substrings, then context", () => {
    const labels = (query: string) => rankCommands(commands, query).map((e) => e.command.label);
    expect(labels("dark")).toEqual(["Theme: Dark"]);
    expect(labels("k3f2")).toEqual(["Discard worktree"]);
    expect(labels("o")).toEqual(["Open project", "Discard worktree"]);
    expect(labels("t")).toEqual(["Theme: Dark", "Settings", "Discard worktree", "Open project"]);
    expect(labels("pages")).toEqual(["Settings"]);
    expect(labels("open nothing")).toEqual([]);
  });

  it("marks matched letters in the label", () => {
    const [entry] = rankCommands(commands, "disc tree");
    expect(entry?.marks).toEqual([
      [0, 4],
      [12, 16],
    ]);
    expect(markParts("Discard worktree", entry?.marks ?? [])).toEqual([
      { text: "Disc", marked: true, start: 0 },
      { text: "ard work", marked: false, start: 4 },
      { text: "tree", marked: true, start: 12 },
    ]);
  });
});
