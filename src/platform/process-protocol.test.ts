import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnOwnedProcess } from "./process.js";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), server: vi.fn(), status: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:net", () => ({ createServer: mocks.server }));
vi.mock("./command.js", () => ({
  resolveCommand: async () => ({ file: "agent.exe", args: ["--acp"] }),
}));
vi.mock("./helper.js", async (original) => ({
  ...(await original<typeof import("./helper.js")>()),
  windowsHelper: () => "code60-host.exe",
  ownedJob: mocks.status,
}));
class Control extends EventEmitter {
  destroyed = false;
  destroy() {
    this.destroyed = true;
    this.emit("close");
  }
  end = vi.fn();
}
let child: EventEmitter & {
  pid: number;
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};
let server: EventEmitter & { close: ReturnType<typeof vi.fn>; listen: ReturnType<typeof vi.fn> };
let control: Control;
let frame: Record<string, unknown>;
let authenticate = true;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("process", { ...process, platform: "win32" });
  child = Object.assign(new EventEmitter(), {
    pid: 101,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => child.emit("exit", 1, null)),
  });
  server = Object.assign(new EventEmitter(), {
    close: vi.fn(),
    listen: vi.fn((_pipe, ready) => ready()),
  });
  control = new Control();
  authenticate = true;
  mocks.server.mockReturnValue(server);
  mocks.status.mockResolvedValue("gone");
  mocks.spawn.mockImplementation((_file, args, options) => {
    frame = {
      version: 1,
      token: options.env.CODE60_HOST_CONTROL_TOKEN,
      pid: 42,
      createdAt: "123",
      owner: "S-1-5-21-123",
      job: args[2],
    };
    queueMicrotask(() => {
      server.emit("connection", control);
      if (authenticate) control.emit("data", Buffer.from(`${JSON.stringify(frame)}\n`));
    });
    return child;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("Windows owned-process control protocol (simulated transport)", () => {
  it("authenticates separately from ACP and verifies the owned job after concurrent stops", async () => {
    const owned = await spawnOwnedProcess(["agent", "--acp"], "workspace", {});
    expect(owned.pid).toBe(42);
    expect(owned.supervisorPid).toBe(101);
    expect(owned.identity).toMatchObject({ createdAt: "123", job: frame.job });
    expect(owned.hasExited()).toBe(false);
    control.end.mockImplementation(() => {
      control.emit("data", Buffer.from('{"stopped":true,"exit":3}\n'));
      child.emit("exit", 0, null);
    });
    const stopped = Promise.all([owned.stop(), owned.stop()]);
    await vi.advanceTimersByTimeAsync(25);
    await stopped;
    expect(control.end).toHaveBeenCalledExactlyOnceWith("stop\n");
    expect(await owned.exited).toEqual({ code: 3, signal: null });
    expect(owned.hasExited()).toBe(true);
    expect(mocks.status).toHaveBeenCalledWith("status", 42, owned.identity, expect.any(Number));
    expect(child.stdin.destroyed).toBe(true);
  });
  it("rejects a wrong token, malformed frames and oversized control traffic without accepting a PID", async () => {
    authenticate = false;
    const starting = spawnOwnedProcess(["agent"], "workspace", {});
    const failed = expect(starting).rejects.toThrow(/startup exceeded/);
    await vi.advanceTimersByTimeAsync(1);
    for (const value of [
      "not json\n",
      `${JSON.stringify({ ...frame, token: "forged" })}\n`,
      "x".repeat(8193),
    ]) {
      const socket = new Control();
      server.emit("connection", socket);
      socket.emit("data", Buffer.from(value));
      expect(socket.destroyed).toBe(true);
    }
    await vi.advanceTimersByTimeAsync(5025);
    await failed;
    expect(child.kill).toHaveBeenCalledOnce();
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it("fails closed when the helper exits before authentication", async () => {
    authenticate = false;
    const starting = spawnOwnedProcess(["agent"], "workspace", {});
    const failed = expect(starting).rejects.toThrow(/helper exited/);
    await vi.advanceTimersByTimeAsync(1);
    child.emit("exit", 2, null);
    await vi.advanceTimersByTimeAsync(25);
    await failed;
    expect(child.kill).toHaveBeenCalledOnce();
  });
  it("does not claim cleanup when native ownership still reports alive", async () => {
    const owned = await spawnOwnedProcess(["agent"], "workspace", {});
    mocks.status.mockResolvedValue("alive");
    control.end.mockImplementation(() => child.emit("exit", 0, null));
    const failed = expect(owned.stop()).rejects.toThrow(/verify owned job exit/);
    await vi.advanceTimersByTimeAsync(25);
    await failed;
  });
  it("bounds cleanup when an authenticated helper does not exit", async () => {
    const owned = await spawnOwnedProcess(["agent"], "workspace", {});
    const failed = expect(owned.stop()).rejects.toThrow(/cleanup exceeded seven seconds/);
    await vi.advanceTimersByTimeAsync(7000);
    await failed;
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it("preserves POSIX groups, concurrent-stop identity and exit reporting on every test platform", async () => {
    const kill = vi.fn((_pid, signal) => {
      if (signal === 0) throw Object.assign(new Error("gone"), { code: "ESRCH" });
      if (signal === "SIGTERM") child.emit("exit", null, "SIGTERM");
      return true;
    });
    vi.stubGlobal("process", { ...process, platform: "linux", kill });
    mocks.spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
    const owned = await spawnOwnedProcess(["agent"], "workspace", {});
    await Promise.all([owned.stop(0), owned.stop(1000)]);
    expect(await owned.exited).toEqual({ code: null, signal: "SIGTERM" });
    expect(kill).toHaveBeenCalledWith(-101, "SIGTERM");
    expect(kill).toHaveBeenCalledWith(-101, "SIGKILL");
    expect(child.stdout.destroyed).toBe(true);
    expect(mocks.status).not.toHaveBeenCalled();
  });
  function posix(kill: (pid: number, signal: NodeJS.Signals | 0) => true) {
    vi.stubGlobal("process", { ...process, platform: "linux", kill: vi.fn(kill) });
    mocks.spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });
  }
  const missing = () => {
    throw Object.assign(new Error("gone"), { code: "ESRCH" });
  };
  it("waits out the grace period, then for group members that outlive the root", async () => {
    let killed = false;
    let probes = 0;
    posix((_pid, signal) => {
      if (signal === "SIGKILL") {
        killed = true;
        child.emit("exit", null, "SIGKILL");
      }
      if (signal !== 0) return true;
      // SIGTERM is ignored. An inaccessible (EPERM) group counts as alive.
      if (!killed) throw Object.assign(new Error("denied"), { code: "EPERM" });
      if (++probes > 2) missing();
      return true;
    });
    const owned = await spawnOwnedProcess(["agent"], "workspace", {});
    owned.stdin.emit("error", new Error("EPIPE"));
    child.emit("error", new Error("late"));
    let done = false;
    const stopped = owned.stop(100).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(owned.hasExited()).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await stopped;
    expect(done).toBe(true);
    expect(owned.hasExited()).toBe(true);
    expect(probes).toBe(3);
    expect(process.kill).toHaveBeenCalledWith(-101, "SIGTERM");
    expect(process.kill).toHaveBeenCalledWith(-101, "SIGKILL");
  });
  it("fails when the POSIX group outlives the cleanup deadline", async () => {
    posix((_pid, signal) => {
      if (signal === "SIGKILL") child.emit("exit", null, "SIGKILL");
      return true;
    });
    const owned = await spawnOwnedProcess(["agent"], "workspace", {});
    const failed = expect(owned.stop(0)).rejects.toThrow(/Process group cleanup exceeded/);
    await vi.advanceTimersByTimeAsync(7100);
    await failed;
    expect(child.stdout.destroyed).toBe(false);
  });
  it("reports POSIX and Windows helper spawn errors as start failures", async () => {
    vi.stubGlobal("process", { ...process, platform: "linux", kill: vi.fn() });
    mocks.spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit("error", new Error("ENOENT")));
      return child;
    });
    await expect(spawnOwnedProcess(["agent"], "workspace", {})).rejects.toThrow(
      "could not start 'agent.exe': ENOENT",
    );
    vi.stubGlobal("process", { ...process, platform: "win32" });
    mocks.spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit("error", new Error("EACCES")));
      return child;
    });
    await expect(spawnOwnedProcess(["agent"], "workspace", {})).rejects.toThrow(
      "could not start 'agent.exe': EACCES",
    );
  });
  it("accepts only exit frames from the authenticated control pipe", async () => {
    const owned = await spawnOwnedProcess(["agent"], "workspace", {});
    const late = new Control();
    server.emit("connection", late);
    late.emit("data", Buffer.from('{"stopped":true,"exit":9}\n'));
    expect(late.destroyed).toBe(true);
    control.emit("data", Buffer.from('{"stopped":"yes"}\n'));
    expect(control.destroyed).toBe(true);
    expect(owned.hasExited()).toBe(false);
    child.emit("exit", 0, null);
    await vi.advanceTimersByTimeAsync(25);
    expect(await owned.exited).toEqual({ code: null, signal: null });
  });
});
