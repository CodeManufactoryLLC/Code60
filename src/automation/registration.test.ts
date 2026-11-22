import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationRequest } from "../contracts/index.js";
import { CODE60_VERSION } from "../core/index.js";
import { readPrivateJson, writePrivateJson } from "../platform/index.js";
import {
  prepareSchedulerUpdate,
  restoreSchedulerUpdate,
  schedulerControl,
} from "./registration.js";
import { automationRoot } from "./service.js";

const fake = vi.hoisted(() => ({
  running: true,
  pausedAll: false,
  request: vi.fn(),
  control: vi.fn(),
  inspect: vi.fn(),
  appVersion: "",
}));
vi.mock("../platform/index.js", async (original) => ({
  ...(await original<object>()),
  controlUserService: fake.control,
  inspectUserService: fake.inspect,
}));
vi.mock("./service.js", async (original) => ({
  ...(await original<object>()),
  automationClient: () => fake.request,
}));
const roots: string[] = [];
beforeEach(() => {
  fake.inspect.mockReset().mockImplementation(async () => ({
    definitionPresent: true,
    state: fake.running ? "running" : "stopped",
    pid: fake.running ? 2147483647 : undefined,
  }));
  fake.running = true;
  fake.pausedAll = false;
  fake.appVersion = CODE60_VERSION;
  fake.request.mockReset().mockImplementation(async (request: AutomationRequest) => {
    if (!fake.running) throw new Error("offline");
    if (request.action === "pauseAll") fake.pausedAll = true;
    if (request.action === "resumeAll") fake.pausedAll = false;
    return {
      pid: 2147483647,
      appVersion: fake.appVersion,
      pausedAll: fake.pausedAll,
      activeExecutionId: null,
      block: null,
    };
  });
  fake.control.mockReset().mockImplementation(async (_definition, action) => {
    fake.running = action !== "stop";
    if (action === "repair") fake.appVersion = CODE60_VERSION;
    return { available: fake.running };
  });
});

describe("read-only scheduler registration status", () => {
  it.each([true, false])("honors installed=%s instead of marker existence", async (installed) => {
    const s = await setup(installed);
    fake.running = false;
    fake.inspect.mockResolvedValue({ definitionPresent: installed, state: "stopped" });
    const before = await readPrivateJson(join(automationRoot(s.env), "registration.json"), 16_384);
    expect(await schedulerControl(s.env, "status")).toEqual({
      installed,
      nativeState: "stopped",
      service: null,
    });
    expect(fake.control).not.toHaveBeenCalled();
    expect(await readPrivateJson(join(automationRoot(s.env), "registration.json"), 16_384)).toEqual(
      before,
    );
  });
  it("distinguishes missing registration from a stopped installed service and standalone runtime", async () => {
    const root = await mkdtemp(join(tmpdir(), "c60-service-absent-"));
    roots.push(root);
    const env = { ...process.env, XDG_STATE_HOME: root };
    fake.running = false;
    fake.inspect.mockResolvedValue({ definitionPresent: false, state: "stopped" });
    expect(await schedulerControl(env, "status")).toMatchObject({
      installed: false,
      service: null,
    });
    fake.running = true;
    expect(await schedulerControl(env, "status")).toMatchObject({
      installed: false,
      service: { pausedAll: false },
    });
    await expect(
      readPrivateJson(join(automationRoot(env), "registration.json"), 16_384),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("reports unavailable supervision without fabricating running or stopped health", async () => {
    const s = await setup();
    fake.running = false;
    fake.inspect.mockResolvedValue({ definitionPresent: true, state: "unavailable" });
    expect(await schedulerControl(s.env, "status")).toEqual({
      installed: true,
      nativeState: "unavailable",
      service: null,
    });
  });
  it.each(["invalid", "missing-definition", "orphan-definition"])(
    "rejects %s registration without repairing it",
    async (kind) => {
      const s = await setup(kind !== "orphan-definition");
      const marker = join(automationRoot(s.env), "registration.json");
      if (kind === "invalid")
        await writePrivateJson(
          marker,
          { installed: "yes" },
          await readPrivateJson(marker, 16_384),
          16_384,
        );
      fake.inspect.mockResolvedValue({
        definitionPresent: kind !== "missing-definition",
        state: "stopped",
      });
      await expect(schedulerControl(s.env, "status")).rejects.toThrow(/registration/);
      expect(fake.control).not.toHaveBeenCalled();
    },
  );
});
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup(installed = true) {
  const root = await mkdtemp(join(tmpdir(), "c60-update-"));
  roots.push(root);
  const env = { ...process.env, XDG_STATE_HOME: root };
  // The production store has already created this private directory.
  const { privateDirectory } = await import("../platform/index.js");
  await privateDirectory(automationRoot(env));
  await writePrivateJson(
    join(automationRoot(env), "registration.json"),
    { installed, runtime: {} },
    undefined,
    16_384,
  );
  return { env, marker: join(automationRoot(env), "update-restart.json") };
}
describe("scheduler update recovery", () => {
  it.each(["stopped", "unavailable", "different-pid"])(
    "never touches a responder outside the native service (%s)",
    async (kind) => {
      const s = await setup();
      fake.appVersion = "0.0.0";
      fake.inspect.mockResolvedValue({
        definitionPresent: true,
        state: kind === "different-pid" ? "running" : kind,
        pid: 42,
      });
      const before = await readFile(join(automationRoot(s.env), "registration.json"));
      await expect(prepareSchedulerUpdate(s.env)).rejects.toThrow("standalone");
      await expect(restoreSchedulerUpdate(s.env, true)).rejects.toThrow("standalone");
      expect(fake.control).not.toHaveBeenCalled();
      expect(fake.request.mock.calls.every(([r]) => r.action === "status")).toBe(true);
      expect(await readFile(join(automationRoot(s.env), "registration.json"))).toEqual(before);
      await expect(readFile(s.marker)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
  it("refuses the standalone scheduler that appears in the fallback status probe", async () => {
    const s = await setup(false);
    fake.inspect.mockResolvedValue({ definitionPresent: false, state: "stopped" });
    fake.request.mockRejectedValueOnce(new Error("starting"));
    await expect(prepareSchedulerUpdate(s.env)).rejects.toThrow("standalone");
    expect(fake.control).not.toHaveBeenCalled();
    expect(fake.pausedAll).toBe(false);
    await expect(readFile(s.marker)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.each(["99.0.0", "unknown", CODE60_VERSION])(
    "never automatically replaces version %s",
    async (version) => {
      const s = await setup();
      fake.appVersion = version;
      await restoreSchedulerUpdate(s.env, true);
      expect(fake.control).not.toHaveBeenCalled();
      expect(fake.pausedAll).toBe(false);
    },
  );
  it("claims restart intent exclusively across concurrent desktop launches", async () => {
    const s = await setup();
    await prepareSchedulerUpdate(s.env);
    const results = await Promise.allSettled([
      restoreSchedulerUpdate(s.env),
      restoreSchedulerUpdate(s.env),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(fake.control.mock.calls.map((call) => call[1])).toEqual(["stop", "repair"]);
    expect(fake.pausedAll).toBe(false);
    await restoreSchedulerUpdate(s.env);
    expect(fake.control).toHaveBeenCalledTimes(2);
  });
  it.each(["file", "parent"])(
    "rejects a replaceable AppImage %s before any update side effect",
    async (kind) => {
      const s = await setup();
      const image = join(roots.at(-1)!, "Code60.AppImage");
      await writeFile(image, "image", { mode: 0o700 });
      await chmod(kind === "file" ? image : roots.at(-1)!, kind === "file" ? 0o722 : 0o777);
      const env = { ...s.env, APPIMAGE: image };
      fake.appVersion = "0.0.0";
      const registrationPath = join(automationRoot(s.env), "registration.json");
      const before = await readFile(registrationPath);
      for (const run of [
        () => prepareSchedulerUpdate(env),
        () => restoreSchedulerUpdate(env, true),
        () => schedulerControl(env, "repair", true),
      ])
        await expect(run()).rejects.toThrow("replaceable");
      expect(fake.control).not.toHaveBeenCalled();
      expect(fake.request.mock.calls.every(([r]) => r.action === "status")).toBe(true);
      await expect(readFile(s.marker)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(registrationPath)).toEqual(before);
      await expect(lstat(join(automationRoot(s.env), "update-recovery"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );
  it.each(["uninstalled", "newer", "standalone"])(
    "retains intent without replacing a %s service during recovery",
    async (kind) => {
      const s = await setup();
      await prepareSchedulerUpdate(s.env);
      fake.control.mockClear();
      if (kind === "uninstalled") {
        const path = join(automationRoot(s.env), "registration.json");
        await writePrivateJson(
          path,
          { installed: false },
          await readPrivateJson(path, 16_384),
          16_384,
        );
        fake.inspect.mockResolvedValue({ definitionPresent: false, state: "stopped" });
      } else {
        fake.running = true;
        fake.appVersion = kind === "newer" ? "99.0.0" : "0.0.0";
        if (kind === "standalone")
          fake.inspect.mockResolvedValue({ definitionPresent: true, state: "stopped" });
      }
      await expect(restoreSchedulerUpdate(s.env)).rejects.toThrow(
        kind === "uninstalled"
          ? "no longer installed"
          : kind === "newer"
            ? "newer or unverifiable"
            : "standalone",
      );
      expect(fake.control).not.toHaveBeenCalled();
      expect(await readPrivateJson(s.marker, 4096)).toEqual({ version: 1, pausedAll: false });
    },
  );
  it("reconciles a manually installed app with an older active service exactly once", async () => {
    const s = await setup();
    fake.appVersion = "0.0.0";
    await restoreSchedulerUpdate(s.env, true);
    expect(fake.control.mock.calls.map((call) => call[1])).toEqual(["stop", "repair"]);
    expect(fake.appVersion).toBe(CODE60_VERSION);
    expect(fake.pausedAll).toBe(false);
    expect(
      await readPrivateJson(join(automationRoot(s.env), "registration.json"), 16_384),
    ).toMatchObject({ installed: true });
    await restoreSchedulerUpdate(s.env, true);
    expect(fake.control).toHaveBeenCalledTimes(2);
  });
  it.each(["development", "uninstalled", "current", "stopped"])(
    "does not auto-upgrade a %s service",
    async (kind) => {
      const s = await setup(kind !== "uninstalled");
      fake.inspect.mockResolvedValue({
        definitionPresent: kind !== "uninstalled",
        state: "stopped",
      });
      if (kind === "development" || kind === "uninstalled") fake.appVersion = "0.0.0";
      if (kind === "stopped") fake.running = false;
      await restoreSchedulerUpdate(s.env, kind !== "development");
      expect(fake.control).not.toHaveBeenCalled();
    },
  );
  it.each(["running", "unavailable"])(
    "refuses an unreachable %s native service before installation or recovery",
    async (state) => {
      const s = await setup();
      fake.running = false;
      fake.inspect.mockResolvedValue({ definitionPresent: true, state });
      await expect(prepareSchedulerUpdate(s.env)).rejects.toThrow("stop could not be verified");
      await expect(restoreSchedulerUpdate(s.env, true)).rejects.toThrow("verify service health");
      expect(fake.control).not.toHaveBeenCalled();
    },
  );
  it.each([
    "stop",
    "repair",
    "version",
    "blocked",
    "resume",
    "verification",
    "timeout",
    "invalid-marker",
  ])("retains recovery evidence on %s failure", async (stage) => {
    const s = await setup();
    if (stage === "stop") fake.control.mockRejectedValueOnce(new Error("stop failure"));
    if (stage === "stop")
      await expect(prepareSchedulerUpdate(s.env)).rejects.toThrow("stop failed");
    else await prepareSchedulerUpdate(s.env);
    if (stage === "repair") fake.control.mockRejectedValueOnce(new Error("repair failure"));
    if (stage === "version")
      fake.control.mockImplementationOnce(async () => {
        fake.running = true;
        fake.appVersion = "0.0.0";
      });
    if (stage === "blocked")
      fake.request.mockImplementation(async () => {
        if (!fake.running) throw new Error("offline");
        return {
          pid: 2147483647,
          appVersion: CODE60_VERSION,
          pausedAll: true,
          block: { reason: "leftover_agent" },
        };
      });
    if (stage === "resume" || stage === "verification")
      fake.request.mockImplementation(async (request: AutomationRequest) => {
        if (!fake.running) throw new Error("offline");
        if (request.action === "resumeAll" && stage === "resume") throw new Error("resume failure");
        return {
          pid: 2147483647,
          appVersion: CODE60_VERSION,
          pausedAll: true,
          block: null,
          activeExecutionId: null,
        };
      });
    if (stage === "timeout") fake.control.mockImplementationOnce(async () => {});
    if (stage === "invalid-marker")
      await writePrivateJson(s.marker, { version: 9 }, await readPrivateJson(s.marker, 4096), 4096);
    if (stage !== "stop") {
      // Expire the bounded restart wait deterministically, with real filesystem I/O.
      const now =
        stage === "timeout"
          ? vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(30_000)
          : undefined;
      try {
        const messages: Record<string, string> = {
          repair: "upgrade failed",
          version: "version does not match",
          blocked: "recovery is blocked",
          resume: "resume failure",
          verification: "reactivation could not be verified",
          timeout: "did not restart",
          "invalid-marker": "metadata is invalid",
        };
        await expect(restoreSchedulerUpdate(s.env)).rejects.toThrow(messages[stage]);
      } finally {
        now?.mockRestore();
      }
    }
    expect(await readPrivateJson(s.marker, 4096)).toBeTruthy();
  });
  it.each([false, true])(
    "restores a running scheduler with previous pausedAll=%s",
    async (paused) => {
      const s = await setup();
      fake.pausedAll = paused;
      await prepareSchedulerUpdate(s.env);
      expect(fake.running).toBe(false);
      expect(fake.pausedAll).toBe(true);
      expect(await readPrivateJson(s.marker, 4096)).toEqual({ version: 1, pausedAll: paused });
      await restoreSchedulerUpdate(s.env);
      expect(fake.control.mock.calls.map((call) => call[1])).toEqual(["stop", "repair"]);
      expect(fake.running).toBe(true);
      expect(fake.pausedAll).toBe(paused);
      await expect(readPrivateJson(s.marker, 4096)).rejects.toMatchObject({ code: "ENOENT" });
      await restoreSchedulerUpdate(s.env);
      expect(fake.control).toHaveBeenCalledTimes(2);
    },
  );
  it("does not start a scheduler that was stopped before the update", async () => {
    const s = await setup();
    fake.running = false;
    await prepareSchedulerUpdate(s.env);
    await restoreSchedulerUpdate(s.env);
    expect(fake.control).not.toHaveBeenCalled();
  });
  it("preserves restart intent after a failed repair for the next startup", async () => {
    const s = await setup();
    await prepareSchedulerUpdate(s.env);
    fake.control.mockRejectedValueOnce(new Error("supervisor unavailable"));
    await expect(restoreSchedulerUpdate(s.env)).rejects.toThrow("upgrade failed");
    expect(await readPrivateJson(s.marker, 4096)).toEqual({ version: 1, pausedAll: false });
    await restoreSchedulerUpdate(s.env);
    expect(fake.pausedAll).toBe(false);
  });
  it("never installs an unregistered standalone scheduler without consent", async () => {
    const s = await setup(false);
    fake.inspect.mockResolvedValue({ definitionPresent: false, state: "stopped" });
    await expect(prepareSchedulerUpdate(s.env)).rejects.toThrow("standalone");
    expect(fake.control).not.toHaveBeenCalled();
    expect(fake.pausedAll).toBe(false);
  });
});
