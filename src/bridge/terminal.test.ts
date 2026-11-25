import { describe, expect, it } from "vitest";
import {
  abbreviateTerminalPath,
  parseTerminalClose,
  parseTerminalOpen,
  parseTerminalResize,
  parseTerminalWrite,
  TERMINAL_LIMITS,
} from "./terminal.js";

const validUuid = "11111111-1111-4111-8111-111111111111";

describe("bridge terminal validation", () => {
  it("accepts opaque targets and rejects caller-supplied paths or unknown fields", () => {
    expect(
      parseTerminalOpen({
        target: { kind: "project-worker", runId: "run-1", projectId: validUuid, databaseEpoch: 2 },
        cols: 80,
        rows: 24,
      }),
    ).toEqual({
      target: { kind: "project-worker", runId: "run-1", projectId: validUuid, databaseEpoch: 2 },
      cols: 80,
      rows: 24,
    });
    expect(
      parseTerminalOpen({
        target: { kind: "relay", conversationId: validUuid },
        cols: 100,
        rows: 30,
      }),
    ).toEqual({
      target: { kind: "relay", conversationId: validUuid },
      cols: 100,
      rows: 30,
    });
    expect(() =>
      parseTerminalOpen({
        target: { kind: "project", cwd: "/etc" },
        cols: 80,
        rows: 24,
      }),
    ).toThrow();
    expect(() =>
      parseTerminalOpen({
        target: { kind: "relay" },
        cols: 1,
        rows: 24,
      }),
    ).toThrow();
  });

  it("validates write, resize, and close bounds", () => {
    expect(parseTerminalWrite({ id: validUuid, data: "ls\n" })).toEqual({
      id: validUuid,
      data: "ls\n",
    });
    expect(() => parseTerminalWrite({ id: validUuid, data: "" })).toThrow();
    expect(() =>
      parseTerminalWrite({ id: validUuid, data: "a".repeat(TERMINAL_LIMITS.maxWriteBytes + 1) }),
    ).toThrow();
    expect(parseTerminalResize({ id: validUuid, cols: 120, rows: 40 })).toEqual({
      id: validUuid,
      cols: 120,
      rows: 40,
    });
    expect(() => parseTerminalResize({ id: validUuid, cols: 600, rows: 40 })).toThrow();
    expect(parseTerminalClose({ id: validUuid })).toEqual({ id: validUuid });
    expect(() => parseTerminalClose({ id: "not-a-uuid" })).toThrow();
  });

  it("abbreviates paths consistently with PROMPT_DIRTRIM behavior", () => {
    expect(abbreviateTerminalPath("/home/node", "/home/node")).toBe("~");
    expect(abbreviateTerminalPath("/home/node/demo-repo", "/home/node")).toBe("~/demo-repo");
    expect(abbreviateTerminalPath("/home/node/a/b", "/home/node")).toBe("~/a/b");
    expect(abbreviateTerminalPath("/home/node/a/b/c", "/home/node")).toBe("~/…/b/c");
    expect(abbreviateTerminalPath("/tmp/demo-project", "/home/node")).toBe("/tmp/demo-project");
    expect(
      abbreviateTerminalPath(
        "/Users/matthew/.gemini/antigravity/worktrees/Code60 Live/sidebar_terminal_tab/test-results/dev/state/code60/relay/workspace",
        "/home/node",
      ),
    ).toBe("…/relay/workspace");
  });
});
