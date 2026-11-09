import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeIdentity, ownedJob } from "../platform/index.js";
import { createProcesses, recordedAgentAlive } from "./processes.js";

vi.mock("../platform/index.js", () => ({ nativeIdentity: vi.fn(), ownedJob: vi.fn() }));
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_file, _args, _options, callback) => callback(null, "  node agent  \n")),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const identity = { createdAt: "42", owner: "owner", job: "job" };
const platform = (name: string, kill = vi.fn()) =>
  vi.stubGlobal("process", { ...process, platform: name, kill });

describe("leftover ownership checks", () => {
  it("uses groups only for legacy POSIX records and handles absent PIDs", async () => {
    const processes = createProcesses();
    const group = vi.spyOn(processes, "groupAlive").mockReturnValue(true);
    expect(await recordedAgentAlive(processes, {})).toBe(false);
    expect(await recordedAgentAlive(processes, { agentPid: 42 })).toBe(true);
    expect(group).toHaveBeenCalledWith(42);
  });

  it("checks POSIX groups without probing invalid IDs and ignores only missing signals", async () => {
    const kill = vi.fn();
    platform("linux", kill);
    const processes = createProcesses();
    expect(processes.isAlive(0)).toBe(false);
    expect(processes.groupAlive(-1)).toBe(false);
    expect(processes.isAlive(42)).toBe(true);
    expect(processes.groupAlive(42)).toBe(true);
    expect(kill).toHaveBeenCalledWith(-42, 0);
    kill.mockImplementation(() => {
      throw Object.assign(new Error(), { code: "EPERM" });
    });
    expect(processes.isAlive(42)).toBe(true);
    expect(() => processes.signalGroup(42, "SIGTERM")).toThrow();
    kill.mockImplementation(() => {
      throw Object.assign(new Error(), { code: "ESRCH" });
    });
    expect(processes.isAlive(42)).toBe(false);
    expect(() => processes.signalGroup(42, "SIGTERM")).not.toThrow();
  });

  it("bounds command discovery and returns no identity for failed or empty ps output", async () => {
    platform("linux");
    const { execFile } = await import("node:child_process");
    const processes = createProcesses();
    expect(await processes.commandLine(42)).toBe("node agent");
    expect(execFile).toHaveBeenCalledWith(
      "ps",
      ["-ww", "-o", "command=", "-p", "42"],
      { timeout: 5000, encoding: "utf8" },
      expect.any(Function),
    );
    vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
      (args[3] as (error: Error | null, text: string) => void)(new Error(), "ignored");
      return undefined as never;
    });
    expect(await processes.commandLine(42)).toBeUndefined();
  });

  it("never treats unknown, inaccessible or reused Windows identities as safe", async () => {
    platform("win32");
    const processes = createProcesses();
    expect(processes.isAlive(0)).toBe(false);
    expect(processes.groupAlive(42)).toBe(true);
    expect(await processes.commandLine(42)).toBeUndefined();
    expect(() => processes.signalGroup(42, "SIGTERM")).toThrow(/verified/);
    vi.mocked(nativeIdentity).mockResolvedValue(null);
    expect(await processes.ownerAlive?.(42, identity)).toBe(false);
    vi.mocked(nativeIdentity).mockResolvedValue(identity);
    expect(await processes.ownerAlive?.(42)).toBe(true);
    expect(await processes.ownerAlive?.(42, identity)).toBe(true);
    expect(await processes.ownerAlive?.(42, { ...identity, createdAt: "different" })).toBe(false);
    vi.mocked(nativeIdentity).mockRejectedValue(new Error("denied"));
    expect(await processes.ownerAlive?.(42, identity)).toBe(true);
    expect(await recordedAgentAlive(processes, { agentPid: 42 })).toBe(true);
    await expect(processes.stopOwned?.(42)).rejects.toThrow(/missing/);
    vi.mocked(ownedJob).mockResolvedValue("alive");
    expect(await recordedAgentAlive(processes, { agentPid: 42, agentIdentity: identity })).toBe(
      true,
    );
    await expect(processes.stopOwned?.(42, identity)).rejects.toThrow(/did not stop/);
    vi.mocked(ownedJob).mockRejectedValue(new Error("denied"));
    expect(await processes.agentAlive?.(42, identity)).toBe(true);
    vi.mocked(ownedJob).mockResolvedValue("gone");
    expect(await processes.agentAlive?.(42, identity)).toBe(false);
    await expect(processes.stopOwned?.(42, identity)).resolves.toBeUndefined();
  });
});
