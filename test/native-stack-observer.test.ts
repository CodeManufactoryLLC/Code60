import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { controlNativeStackObserver } from "./native-stack-observer.js";

function fixture() {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
  let input = "";
  child.stdin.on("data", (chunk) => {
    input += chunk.toString();
  });
  const emit = vi.fn();
  const observer = controlNativeStackObserver(
    child as unknown as ChildProcessWithoutNullStreams,
    emit,
  );
  const record = (value: object) => child.stdout.write(`${JSON.stringify(value)}\n`);
  return { child, emit, observer, record, input: () => input };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it("waits for readiness, captures once, and streams stacks before observer completion", async () => {
  const f = fixture();
  f.observer.capture();
  expect(f.input()).toBe("");
  f.child.stdout.write('{"observerPhase":"stack-capture-');
  f.child.stdout.write('ready"}\n');
  expect(await f.observer.ready).toBe(true);
  expect(f.input()).toBe("");
  f.observer.capture();
  f.observer.capture();
  f.observer.cancel();
  expect(f.input()).toBe("capture\n");
  f.record({
    observerPhase: "thread-stack",
    ordinal: 0,
    frames: [{ module: "ntdll.dll", function: "NtWaitForSingleObject" }],
  });
  expect(f.emit).toHaveBeenCalledWith({
    nativePhase: "launcher.stack-observation",
    observation: {
      observerPhase: "thread-stack",
      ordinal: 0,
      frames: [{ module: "ntdll.dll", function: "NtWaitForSingleObject" }],
    },
  });
  f.child.emit("close", 0);
  await f.observer.done;
  expect(f.child.kill).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("uses a fresh five-second capture budget after bounded preparation and idle waiting", async () => {
  const f = fixture();
  vi.advanceTimersByTime(4900);
  f.record({ observerPhase: "stack-capture-ready" });
  expect(await f.observer.ready).toBe(true);
  vi.advanceTimersByTime(4900);
  f.observer.capture();
  vi.advanceTimersByTime(4999);
  expect(f.child.kill).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  await f.observer.done;
  expect(f.child.kill).toHaveBeenCalledTimes(1);
  expect(f.emit).toHaveBeenLastCalledWith(
    expect.objectContaining({ state: "observer-timeout", stage: "capturing" }),
  );
  f.child.emit("close", null);
  expect(f.child.kill).toHaveBeenCalledTimes(1);
});

it("bounds preparation and resolves readiness false if startup stalls", async () => {
  const f = fixture();
  vi.advanceTimersByTime(5000);
  expect(await f.observer.ready).toBe(false);
  await f.observer.done;
  f.observer.capture();
  expect(f.input()).toBe("");
  expect(f.child.kill).toHaveBeenCalledTimes(1);
  expect(f.emit).toHaveBeenLastCalledWith(
    expect.objectContaining({ state: "observer-timeout", stage: "preparing" }),
  );
});

it("bounds idle waiting without issuing a capture command", async () => {
  const f = fixture();
  f.record({ observerPhase: "stack-capture-ready" });
  expect(await f.observer.ready).toBe(true);
  vi.advanceTimersByTime(5000);
  await f.observer.done;
  expect(f.input()).toBe("");
  expect(f.emit).toHaveBeenLastCalledWith(
    expect.objectContaining({ state: "observer-timeout", stage: "ready" }),
  );
});

it("cancels with EOF before readiness and does not trigger after cancellation", async () => {
  const f = fixture();
  f.observer.cancel();
  expect(f.child.stdin.writableEnded).toBe(true);
  f.record({ observerPhase: "stack-capture-ready" });
  expect(await f.observer.ready).toBe(false);
  f.observer.capture();
  expect(f.input()).toBe("");
  f.child.emit("close", 0);
  await f.observer.done;
  expect(f.child.kill).not.toHaveBeenCalled();
});

it("reports observer failure once without retaining raw stderr or non-record output", async () => {
  const f = fixture();
  f.child.stderr.write("private compiler error");
  f.child.stdout.write("not json\nnull\n[]\n{}\n");
  f.child.emit("error", new Error("private startup error"));
  f.child.emit("close", 1);
  expect(await f.observer.ready).toBe(false);
  await f.observer.done;
  expect(f.emit).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(f.emit.mock.calls)).not.toContain("private");
  expect(vi.getTimerCount()).toBe(0);
});

it("retains earlier progress when later observer output exceeds its bound", async () => {
  const f = fixture();
  f.record({ observerPhase: "native-helper-compilation", state: "started" });
  f.child.stdout.write("x".repeat(65537));
  expect(await f.observer.ready).toBe(false);
  await f.observer.done;
  expect(f.emit).toHaveBeenCalledTimes(2);
  expect(f.emit).toHaveBeenLastCalledWith(
    expect.objectContaining({ state: "observer-output-invalid" }),
  );
  expect(f.child.kill).toHaveBeenCalledTimes(1);
});

it("handles a broken observer input pipe without leaving the diagnostic child running", async () => {
  const f = fixture();
  f.child.stdin.emit("error", new Error("private pipe failure"));
  expect(await f.observer.ready).toBe(false);
  await f.observer.done;
  expect(f.child.kill).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(f.emit.mock.calls)).not.toContain("private");
});

it("completes the readiness/capture protocol through a fresh synthetic child process", async () => {
  const emit = vi.fn();
  const observer = controlNativeStackObserver(
    spawn(
      process.execPath,
      [
        "-e",
        `
          process.stdout.write('{"observerPhase":"stack-capture-ready"}\\n');
          let input = '';
          process.stdin.setEncoding('utf8');
          process.stdin.on('data', (chunk) => { input += chunk; });
          process.stdin.on('end', () => {
            if (input !== 'capture\\n') { process.exitCode = 1; return; }
            process.stdout.write('{"observerPhase":"thread-stack","ordinal":0,"frames":[]}\\n');
          });
        `,
      ],
      { stdio: "pipe" },
    ),
    emit,
  );
  try {
    expect(await observer.ready).toBe(true);
    observer.capture();
    await observer.done;
    expect(emit).toHaveBeenCalledWith({
      nativePhase: "launcher.stack-observation",
      observation: { observerPhase: "thread-stack", ordinal: 0, frames: [] },
    });
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "completed", stage: "capturing" }),
    );
  } finally {
    observer.cancel();
    await observer.done;
  }
});

it("uses the documented thread-only PSS flags and thread walk class at both call sites", async () => {
  const source = await readFile(new URL("./native-stack-capture.ps1", import.meta.url), "utf8");
  // Values from Microsoft's PSS_CAPTURE_FLAGS / PSS_WALK_INFORMATION_CLASS.
  expect(source).toContain("PssCaptureThreads = 0x00000080");
  expect(source).toContain("PssCaptureThreadContext = 0x00000100");
  expect(source).toContain("PssWalkThreads = 3");
  expect(source).toContain("ContextControlIntegerAmd64 = 0x00100003");
  expect(source.match(/PssWalkSnapshot\(snapshot, PssWalkThreads,/g)).toHaveLength(2);
  expect(source).toContain("process, PssCaptureThreads | PssCaptureThreadContext,");
  expect(source).not.toMatch(/PssWalkSnapshot\(snapshot, 0,/);
});
