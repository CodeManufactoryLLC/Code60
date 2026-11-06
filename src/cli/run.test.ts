import { describe, expect, it } from "vitest";
import { CODE60_VERSION } from "../core/index.js";
import { HELP, run } from "./run.js";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: { write: (s: string) => out.push(s) },
      stderr: { write: (s: string) => err.push(s) },
    },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

describe("run", () => {
  it("prints the version without reading config, stdin, or the workspace", async () => {
    const c = capture();
    expect(
      await run(["--version"], {
        ...c.io,
        cwd: () => {
          throw new Error("unexpected read");
        },
      }),
    ).toBe(0);
    expect(c.stdout()).toBe(`code60 ${CODE60_VERSION}\n`);
    expect(c.stderr()).toBe("");
    expect(HELP).toContain("--version");
  });

  it("prints help to stdout and exits 0", async () => {
    const c = capture();
    expect(await run(["--help"], c.io)).toBe(0);
    expect(c.stdout()).toBe(HELP);
    expect(c.stderr()).toBe("");
    expect(HELP).toMatch(/^ {2}code60 run/m);
    expect(HELP).not.toMatch(/agent-orchestrator|code60-cli/);
  });

  it("prints help for a command's --help", async () => {
    const c = capture();
    expect(await run(["diff", "--help"], c.io)).toBe(0);
    expect(c.stdout()).toBe(HELP);
  });

  it.each([
    [[] as string[], /missing command/],
    [["bogus"], /unknown command 'bogus'/],
    [["--version", "extra"], /--version takes no arguments/],
    [["list", "--nope"], /--nope/],
    [["diff"], /wrong number of arguments/],
    [["run", "one", "two"], /wrong number of arguments/],
  ])("exits 2 with a usage error on stderr for %j", async (argv, message) => {
    const c = capture();
    expect(await run(argv, c.io)).toBe(2);
    expect(c.stdout()).toBe("");
    expect(c.stderr()).toMatch(message);
  });
});
