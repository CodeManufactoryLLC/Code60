import { fork } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryService } from "../src/application/memory-service.js";
import { DEFAULT_MEMORY_SETTINGS } from "../src/bridge/index.js";
import { FakeAgents, FakeClock, FakeGit, FakeProcesses } from "./fakes.js";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  fork: vi.fn(),
}));

class Sidecar extends EventEmitter {
  connected = true;
  send = vi.fn((message: { id: string; op: string }, callback: (error: null) => void) => {
    callback(null);
    queueMicrotask(() =>
      this.emit("message", {
        id: message.id,
        result: { settings: structuredClone(DEFAULT_MEMORY_SETTINGS), count: 0, conversations: [] },
      }),
    );
  });
  disconnect = vi.fn(() => {
    this.connected = false;
  });
  kill = vi.fn(() => {
    queueMicrotask(() => this.emit("exit", 0, null));
    return true;
  });
}
let service: MemoryService;
let children: Sidecar[];
beforeEach(() => {
  children = [];
  vi.mocked(fork).mockImplementation(() => {
    const child = new Sidecar();
    children.push(child);
    return child as unknown as ReturnType<typeof fork>;
  });
  service = new MemoryService(
    "/unused/memory",
    "/unused/models",
    {
      fs: {} as never,
      agents: new FakeAgents(),
      clock: new FakeClock(),
      git: new FakeGit(),
      processes: new FakeProcesses(),
      ownerPid: 42,
    },
    () => null,
  );
});
afterEach(async () => {
  await service.close();
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe("memory sidecar lifecycle", () => {
  it("loads settings from initialization without a duplicate snapshot request", async () => {
    await service.loadSettings();
    await service.loadSettings();
    expect(children).toHaveLength(1);
    expect(children[0]?.send.mock.calls.map(([message]) => message.op)).toEqual(["init"]);
  });
  it("waits for the idle owner to exit before opening a replacement writer", async () => {
    vi.useFakeTimers();
    await service.loadSettings();
    await vi.advanceTimersByTimeAsync(60000);
    expect(children[0]?.disconnect).toHaveBeenCalledOnce();
    const snapshot = service.snapshot();
    await vi.advanceTimersByTimeAsync(0);
    expect(children).toHaveLength(1);
    children[0]?.emit("exit", 0, null);
    expect((await snapshot).count).toBe(0);
    expect(children).toHaveLength(2);
    expect(children[1]?.send.mock.calls.map(([message]) => message.op)).toEqual([
      "init",
      "snapshot",
    ]);
  });
});
