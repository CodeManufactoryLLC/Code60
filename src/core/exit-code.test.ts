import { describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor } from "./exit-code.js";

describe("exitCodeFor", () => {
  it("returns 0 when every run finished", () => {
    expect(exitCodeFor(["finished", "finished"])).toBe(ExitCode.ok);
  });

  it("returns 1 for a failed or interrupted run", () => {
    expect(exitCodeFor(["finished", "failed"])).toBe(ExitCode.failed);
    expect(exitCodeFor(["interrupted"])).toBe(ExitCode.failed);
  });

  it("prefers a timeout over a failure", () => {
    expect(exitCodeFor(["failed", "timed_out"])).toBe(ExitCode.timedOut);
  });

  it("prefers cancellation over a timeout", () => {
    expect(exitCodeFor(["timed_out", "cancelled"])).toBe(ExitCode.cancelled);
  });

  it("returns 130 on a signal even when every run finished", () => {
    expect(exitCodeFor(["finished"], { signal: true })).toBe(ExitCode.cancelled);
  });

  it("returns 2 for a usage error above everything else", () => {
    expect(exitCodeFor(["cancelled"], { signal: true, usageError: true })).toBe(ExitCode.usage);
  });

  it("throws when a run is still active", () => {
    expect(() => exitCodeFor(["finished", "idle"])).toThrow(/active run status/);
  });
});
