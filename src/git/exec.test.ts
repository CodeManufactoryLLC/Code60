import { afterEach, describe, expect, it, vi } from "vitest";
import { runGit } from "./exec.js";

const child = vi.hoisted(() => ({
  kill: vi.fn(),
  complete: undefined as
    | undefined
    | ((error: Error | null, stdout: string, stderr: string) => void),
}));
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_command, _args, _options, callback) => {
    child.complete = callback;
    return { kill: child.kill };
  }),
}));
afterEach(() => vi.clearAllMocks());

describe("Git subprocess cancellation", () => {
  it("waits for process completion before rejecting cancellation", async () => {
    const abort = new AbortController();
    const pending = runGit(["diff"], "/repo", { signal: abort.signal });
    const rejected = expect(pending).rejects.toThrow("cancelled");
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    abort.abort(new Error("cancelled"));
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    await Promise.resolve();
    expect(settled).toBe(false);
    child.complete?.(new Error("killed"), "partial diff", "");
    await rejected;
    expect(settled).toBe(true);
  });
  it("removes the abort listener after normal completion", async () => {
    const abort = new AbortController();
    const pending = runGit(["diff"], "/repo", { signal: abort.signal });
    child.complete?.(null, "patch", "");
    expect(await pending).toBe("patch");
    abort.abort();
    expect(child.kill).not.toHaveBeenCalled();
  });
  it("does not spawn a pre-cancelled request", async () => {
    const abort = new AbortController();
    abort.abort(new Error("already cancelled"));
    const { execFile } = await import("node:child_process");
    await expect(runGit(["diff"], "/repo", { signal: abort.signal })).rejects.toThrow(
      "already cancelled",
    );
    expect(execFile).not.toHaveBeenCalled();
  });
});
