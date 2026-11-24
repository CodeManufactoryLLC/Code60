import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { spawnOwnedProcess } from "./process.js";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn: mocks.spawn,
}));

let child: EventEmitter & {
  pid: number;
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
};
beforeEach(() => {
  vi.useFakeTimers();
  child = Object.assign(new EventEmitter(), {
    pid: 12345,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  mocks.spawn.mockImplementation(() => {
    queueMicrotask(() => child.emit("spawn"));
    return child;
  });
});
afterEach(() => {
  child.stdin.destroy();
  child.stdout.destroy();
  child.stderr.destroy();
  vi.restoreAllMocks();
  vi.useRealTimers();
  mocks.spawn.mockReset();
});

it("reports startup failure without inventing a live owned process", async () => {
  mocks.spawn.mockImplementation(() => {
    queueMicrotask(() => child.emit("error", new Error("executable missing")));
    return child;
  });
  await expect(spawnOwnedProcess(["missing-agent"], "/project")).rejects.toThrow(
    "could not start 'missing-agent': executable missing",
  );
});

it("bounds an owned root that never reports exit, and tolerates late pipe errors", async () => {
  vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("gone"), { code: "ESRCH" });
  });
  const owned = await spawnOwnedProcess(["agent"], "/project");
  expect(owned.hasExited()).toBe(false);
  expect(() => child.stdin.emit("error", new Error("closed pipe"))).not.toThrow();
  expect(() => child.emit("error", new Error("late transport error"))).not.toThrow();
  const failed = expect(owned.stop(0)).rejects.toThrow(
    "Owned process cleanup exceeded seven seconds",
  );
  await vi.advanceTimersByTimeAsync(7_001);
  await failed;
});

it("refuses success while descendants remain unverifiable after the root exits", async () => {
  const kill = vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("access denied"), { code: "EPERM" });
  });
  const owned = await spawnOwnedProcess(["agent"], "/project");
  child.emit("exit", 0, null);
  expect(owned.hasExited()).toBe(true);
  const failed = expect(owned.stop(0)).rejects.toThrow(
    "Process group cleanup exceeded seven seconds",
  );
  await vi.advanceTimersByTimeAsync(7_001);
  await failed;
  expect(kill).toHaveBeenCalledWith(-12345, "SIGTERM");
  expect(kill).toHaveBeenCalledWith(-12345, "SIGKILL");
});

it("preserves structured startup error codes for secret-safe boundary classification", async () => {
  mocks.spawn.mockImplementation(() => {
    queueMicrotask(() =>
      child.emit("error", Object.assign(new Error("private executable path"), { code: "ENOENT" })),
    );
    return child;
  });
  await expect(spawnOwnedProcess(["missing-agent"], "/project")).rejects.toMatchObject({
    cause: { code: "ENOENT" },
  });
});
