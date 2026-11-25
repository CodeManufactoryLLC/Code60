import { mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CODE60_VERSION } from "../core/index.js";
import { privateDirectory, userServiceDefinition, writePrivateJson } from "../platform/index.js";
import {
  type BackendRemovalGuard,
  backendControl,
  restoreSchedulerHandoff,
} from "./registration.js";
import { gatewayRoot } from "./server.js";

const fake = vi.hoisted(() => ({
  control: vi.fn(),
  inspect: vi.fn(),
  management: vi.fn(),
  legacy: vi.fn(),
  legacyRequest: vi.fn(),
  exited: vi.fn(),
}));
vi.mock("../platform/index.js", async (original) => ({
  ...(await original<typeof import("../platform/index.js")>()),
  controlUserService: fake.control,
  inspectUserService: fake.inspect,
  waitForRuntimeExit: fake.exited,
}));
vi.mock("../automation/index.js", async (original) => ({
  ...(await original<typeof import("../automation/index.js")>()),
  schedulerControl: fake.legacy,
  automationClient: () => fake.legacyRequest,
}));
vi.mock("./server.js", async (original) => ({
  ...(await original<typeof import("./server.js")>()),
  managementRequest: fake.management,
}));
const directories: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  fake.control.mockResolvedValue({ available: true });
  fake.inspect.mockResolvedValue({ definitionPresent: true, state: "running", pid: 42 });
  fake.management.mockResolvedValue({ pid: 42 });
  fake.legacy.mockResolvedValue({ installed: false, nativeState: "stopped", service: null });
  fake.exited.mockResolvedValue(undefined);
});
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture(installed = false) {
  if (!installed)
    fake.inspect.mockResolvedValue({ definitionPresent: false, state: "stopped", loaded: false });
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-registration-")));
  directories.push(directory);
  const env = {
    ...process.env,
    HOME: directory,
    XDG_STATE_HOME: join(directory, "state"),
    XDG_CONFIG_HOME: join(directory, "config"),
    APPIMAGE: "/untrusted/legacy.AppImage",
  };
  if (installed) {
    await privateDirectory(gatewayRoot(env));
    await writePrivateJson(
      join(gatewayRoot(env), "registration.json"),
      {
        version: 1,
        installed: true,
        appVersion: CODE60_VERSION,
        runtime: {
          executable: await realpath(process.execPath),
          args: ["/fixture/gateway/main.js"],
          env: {},
        },
      },
      undefined,
      16_384,
    );
    const saved = JSON.parse(await readFile(join(gatewayRoot(env), "registration.json"), "utf8"));
    const definition = userServiceDefinition(
      process.platform,
      env.HOME,
      gatewayRoot(env),
      saved.runtime,
      "backend",
    );
    await mkdir(dirname(definition.path), { recursive: true, mode: 0o700 });
    await writeFile(definition.path, definition.contents, { mode: 0o600 });
  }
  return { env, directory, root: gatewayRoot(env) };
}
it("keeps uninstalled status read-only and requires explicit consent before installation", async () => {
  const { env, root } = await fixture();
  expect(await backendControl(env, "status")).toMatchObject({ installed: false, service: null });
  await expect(backendControl(env, "install")).rejects.toThrow("consent");
  await expect(readFile(join(root, "registration.json"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(fake.control).not.toHaveBeenCalled();
});

it("keeps damaged private registration contents out of management errors", async () => {
  const f = await fixture();
  await privateDirectory(f.root);
  const contents = "private123";
  const path = join(f.root, "registration.json");
  await writeFile(path, contents, { mode: 0o600 });
  await expect(backendControl(f.env, "status")).rejects.toThrow(
    "Backend registration is unavailable or invalid",
  );
  expect(await readFile(path, "utf8")).toBe(contents);
  expect(fake.control).not.toHaveBeenCalled();
});
it("pins plain Node and the backend entrypoint, ignoring Electron/AppImage environment", async () => {
  const { env, root } = await fixture();
  await backendControl(env, "install", true);
  const saved = JSON.parse(await readFile(join(root, "registration.json"), "utf8"));
  expect(saved.runtime.executable).toBe(await realpath(process.execPath));
  expect(saved.runtime.args[0]).toMatch(/gateway\/main\.js$/);
  expect(saved.runtime.env).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
  expect(fake.control.mock.calls[0]?.[0].path).toContain(
    process.platform === "darwin" ? "code60.backend" : "code60-backend",
  );
  await expect(backendControl(env, "install", true)).rejects.toThrow("already installed");
});
it("preserves the explicit Codex home path without persisting provider credentials or config payloads", async () => {
  const { env, root } = await fixture();
  await backendControl(
    {
      ...env,
      CODEX_HOME: join(env.HOME, "workflow's Codex home"),
      CODEX_CONFIG: "fixture configuration",
      OPENAI_API_KEY: "fixture value",
    },
    "install",
    true,
  );
  const saved = JSON.parse(await readFile(join(root, "registration.json"), "utf8"));
  expect(saved.runtime.env.CODEX_HOME).toBe(join(env.HOME, "workflow's Codex home"));
  expect(saved.runtime.env).not.toHaveProperty("CODEX_CONFIG");
  expect(saved.runtime.env).not.toHaveProperty("OPENAI_API_KEY");
});
it("rejects relative workflow provider homes before changing service registration", async () => {
  const { env, root } = await fixture();
  await expect(backendControl({ ...env, CODEX_HOME: "relative" }, "install", true)).rejects.toThrow(
    "absolute",
  );
  expect(fake.control).not.toHaveBeenCalled();
  await expect(readFile(join(root, "registration.json"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("refuses an unverified responder before stopping or replacing registration", async () => {
  const { env, root } = await fixture(true);
  const before = await readFile(join(root, "registration.json"));
  fake.management.mockResolvedValue({ pid: 99 });
  expect(await backendControl(env, "status")).toMatchObject({
    nativeState: "unavailable",
    service: null,
  });
  await expect(backendControl(env, "repair", true)).rejects.toThrow("ownership");
  expect(fake.control).not.toHaveBeenCalled();
  expect(await readFile(join(root, "registration.json"))).toEqual(before);
});
it("drains owned work before a supervisor stop and keeps its installation metadata", async () => {
  const { env, root } = await fixture(true);
  await backendControl(env, "stop", true);
  expect(fake.management.mock.calls.map((call) => call[1])).toEqual(["status", "shutdown"]);
  expect(fake.control.mock.calls.map((call) => call[1])).toEqual(["stop"]);
  expect(JSON.parse(await readFile(join(root, "registration.json"), "utf8")).installed).toBe(true);
});

async function removalFixture() {
  const f = await fixture(true);
  const registration = join(f.root, "registration.json");
  const saved = JSON.parse(await readFile(registration, "utf8"));
  const guard: BackendRemovalGuard = {
    pid: 42,
    executable: saved.runtime.executable,
    entrypoint: saved.runtime.args[0],
    appVersion: saved.appVersion,
  };
  const definition = userServiceDefinition(
    process.platform,
    f.env.HOME,
    f.root,
    saved.runtime,
    "backend",
  );
  let stopped = false;
  let removed = false;
  fake.inspect.mockImplementation(async () => ({
    state: stopped ? "stopped" : "running",
    definitionPresent: !removed,
    loaded: !stopped,
    ...(stopped ? {} : { pid: 42 }),
  }));
  const offline = () =>
    Object.assign(Error("Backend offline"), { cause: { code: "ECONNREFUSED" } });
  fake.management.mockImplementation(async (_env, action) => {
    if (stopped) throw offline();
    return action === "status" ? { pid: 42, uninstallPrepared: true } : { stopped: true };
  });
  fake.control.mockImplementation(async (_definition, action) => {
    if (action === "stop") stopped = true;
    if (action === "uninstall") {
      await unlink(definition.path);
      removed = true;
    }
    return { available: false };
  });
  return {
    ...f,
    guard,
    definition,
    registration,
    offline,
    stopped: () => {
      stopped = true;
    },
    removed: () => {
      stopped = true;
      removed = true;
    },
  };
}
it("unregisters only the prepared runtime/PID after authenticated idle preparation and verified exit", async () => {
  const f = await removalFixture();
  expect(await backendControl(f.env, "uninstall", true, f.guard)).toMatchObject({
    installed: false,
    enginePids: [],
  });
  expect(fake.exited).toHaveBeenCalledWith([42]);
  expect(fake.control.mock.calls.map((call) => call[1])).toEqual(["stop", "uninstall"]);
  expect(JSON.parse(await readFile(f.registration, "utf8")).installed).toBe(false);
  await expect(readFile(f.definition.path)).rejects.toMatchObject({ code: "ENOENT" });
});
it.each(["restarted", "unprepared", "runtime", "stopped-proof"] as const)(
  "preserves registration and processes when the %s guard does not match",
  async (fault) => {
    const f = await removalFixture();
    const before = await readFile(f.registration);
    if (fault === "restarted")
      fake.inspect.mockResolvedValue({ state: "running", pid: 84, definitionPresent: true });
    if (fault === "unprepared")
      fake.management.mockResolvedValue({ pid: 42, uninstallPrepared: false });
    if (fault === "runtime") f.guard.entrypoint = "/different/gateway.js";
    if (fault === "stopped-proof") f.guard.pid = null;
    await expect(backendControl(f.env, "uninstall", true, f.guard)).rejects.toThrow();
    expect(fake.control).not.toHaveBeenCalled();
    expect(fake.exited).not.toHaveBeenCalled();
    expect(await readFile(f.registration)).toEqual(before);
  },
);
it("refuses a restart between authenticated shutdown and the supervisor stop", async () => {
  const f = await removalFixture();
  const before = await readFile(f.registration);
  fake.inspect
    .mockResolvedValueOnce({ state: "running", pid: 42, definitionPresent: true })
    .mockResolvedValue({ state: "running", pid: 84, definitionPresent: true });
  await expect(backendControl(f.env, "uninstall", true, f.guard)).rejects.toThrow(
    "generation changed before",
  );
  expect(fake.control).not.toHaveBeenCalled();
  expect(await readFile(f.registration)).toEqual(before);
});
it("does not delete a definition or mark registration removed when backend exit is uncertain", async () => {
  const f = await removalFixture();
  const before = await readFile(f.registration);
  fake.exited.mockRejectedValue(Error("Recorded process remains"));
  await expect(backendControl(f.env, "uninstall", true, f.guard)).rejects.toThrow(
    "process remains",
  );
  expect(fake.control.mock.calls.map((call) => call[1])).toEqual(["stop"]);
  expect(await readFile(f.registration)).toEqual(before);
  expect(await readFile(f.definition.path, "utf8")).toBe(f.definition.contents);
});
it("recovers metadata only after positive native/HTTP absence if the owned definition was already removed", async () => {
  const f = await removalFixture();
  f.removed();
  await unlink(f.definition.path);
  expect(await backendControl(f.env, "uninstall", true, { ...f.guard, pid: null })).toMatchObject({
    installed: false,
    enginePids: [],
  });
  expect(fake.control).not.toHaveBeenCalled();
  expect(JSON.parse(await readFile(f.registration, "utf8")).installed).toBe(false);
});
it("retains partial removal when native absence cannot be verified after unregistration", async () => {
  const f = await removalFixture();
  const before = await readFile(f.registration);
  fake.inspect
    .mockResolvedValueOnce({ state: "running", pid: 42, definitionPresent: true })
    .mockResolvedValueOnce({ state: "running", pid: 42, definitionPresent: true })
    .mockResolvedValueOnce({ state: "stopped", definitionPresent: true })
    .mockResolvedValue({ state: "unavailable", definitionPresent: false });
  await expect(backendControl(f.env, "uninstall", true, f.guard)).rejects.toThrow(
    "unregistration could not be verified",
  );
  expect(await readFile(f.registration)).toEqual(before);
});
it("does not treat a damaged connection record as positive backend absence", async () => {
  const f = await removalFixture();
  f.stopped();
  const before = await readFile(f.registration);
  fake.management.mockRejectedValue(Error("Malformed metadata"));
  await expect(backendControl(f.env, "uninstall", true, { ...f.guard, pid: null })).rejects.toThrow(
    "connection ownership is uncertain",
  );
  expect(fake.control).not.toHaveBeenCalled();
  expect(await readFile(f.registration)).toEqual(before);
});

it("refuses a backend restart while offline workflow preparation is in progress", async () => {
  const f = await removalFixture();
  f.stopped();
  const before = await readFile(f.registration);
  fake.inspect
    .mockResolvedValueOnce({ state: "stopped", definitionPresent: true })
    .mockResolvedValueOnce({ state: "stopped", definitionPresent: true })
    .mockResolvedValue({ state: "running", pid: 84, definitionPresent: true });
  await expect(backendControl(f.env, "uninstall", true, { ...f.guard, pid: null })).rejects.toThrow(
    "restarted during workflow preparation",
  );
  expect(fake.control).not.toHaveBeenCalled();
  expect(await readFile(f.registration)).toEqual(before);
});
it("checks fixed native absence for files-only installations and refuses unexpected responders", async () => {
  const f = await fixture();
  const guard = {
    pid: null,
    executable: await realpath(process.execPath),
    entrypoint: "/fixture/gateway/main.js",
    appVersion: CODE60_VERSION,
  };
  fake.management.mockResolvedValue({ pid: 99 });
  await expect(backendControl(f.env, "uninstall", true, guard)).rejects.toThrow(
    "unexpected backend",
  );
  fake.management.mockRejectedValue(Object.assign(Error("No metadata"), { code: "ENOENT" }));
  expect(await backendControl(f.env, "uninstall", true, guard)).toMatchObject({
    installed: false,
    enginePids: [],
  });
  await expect(readFile(join(f.root, "registration.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(fake.control).not.toHaveBeenCalled();
});
it("preserves the original scheduler pause setting across a failed handoff retry", async () => {
  const { env, root } = await fixture();
  fake.legacy.mockResolvedValue({ installed: true, nativeState: "running", service: { pid: 12 } });
  fake.legacyRequest.mockResolvedValue({ pausedAll: false });
  fake.control.mockRejectedValueOnce(new Error("supervisor unavailable"));
  await expect(backendControl(env, "install", true)).rejects.toThrow("supervisor");
  fake.legacyRequest.mockResolvedValue({ pausedAll: true });
  await backendControl(env, "install", true);
  const path = join(root, "scheduler-handoff.json");
  expect(JSON.parse(await readFile(path, "utf8")).pausedAll).toBe(false);
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error("uncertain previous work"))
    .mockResolvedValue(null);
  await expect(restoreSchedulerHandoff(env, request)).rejects.toThrow("uncertain");
  expect(JSON.parse(await readFile(path, "utf8")).pausedAll).toBe(false);
  await restoreSchedulerHandoff(env, request);
  expect(request).toHaveBeenLastCalledWith({ action: "resumeAll" });
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("retains a pinned runtime after partial enrollment and refuses an unowned live definition", async () => {
  const { env, root } = await fixture();
  fake.control.mockRejectedValueOnce(new Error("supervisor unavailable"));
  await expect(backendControl(env, "install", true)).rejects.toThrow("supervisor");
  const saved = JSON.parse(await readFile(join(root, "registration.json"), "utf8"));
  expect(saved.installed).toBe(false);
  expect(saved.runtime.executable).toBe(await realpath(process.execPath));
  fake.inspect.mockResolvedValue({ definitionPresent: true, state: "running", pid: 123 });
  fake.control.mockClear();
  await expect(backendControl(env, "repair", true)).rejects.toThrow("ownership");
  expect(fake.control).not.toHaveBeenCalled();
});

it("reports a same-version registration pointing to another runtime as conflicting without repair", async () => {
  const { env } = await fixture(true);
  expect(await backendControl(env, "status")).toMatchObject({ runtimeCurrent: false });
  expect(fake.control).not.toHaveBeenCalled();
});
it("preserves outside service-definition edits before any shutdown or replacement", async () => {
  const { env, root } = await fixture(true);
  const saved = await readFile(join(root, "registration.json"), "utf8");
  const definition = userServiceDefinition(
    process.platform,
    env.HOME,
    root,
    JSON.parse(saved).runtime,
    "backend",
  );
  await writeFile(definition.path, "unrelated outside edit", { mode: 0o600 });
  await expect(backendControl(env, "repair", true)).rejects.toThrow("definition ownership changed");
  await expect(backendControl(env, "status")).rejects.toThrow("definition ownership changed");
  expect(fake.control).not.toHaveBeenCalled();
  expect(fake.management).not.toHaveBeenCalled();
  expect(await readFile(definition.path, "utf8")).toBe("unrelated outside edit");
  expect(await readFile(join(root, "registration.json"), "utf8")).toBe(saved);
});
it("retains the original definition identity across failed replacement and explicit repair", async () => {
  const { env, root } = await fixture(true);
  const saved = JSON.parse(await readFile(join(root, "registration.json"), "utf8"));
  fake.inspect.mockResolvedValue({ definitionPresent: true, state: "stopped" });
  fake.control.mockRejectedValueOnce(Error("enrollment failed"));
  await expect(backendControl(env, "repair", true)).rejects.toThrow("enrollment failed");
  const partial = JSON.parse(await readFile(join(root, "registration.json"), "utf8"));
  expect(partial.previous).toEqual({ runtime: saved.runtime, appVersion: saved.appVersion });
  expect(partial.runtime.args[0]).toMatch(/gateway\/main\.js$/);
  expect(await backendControl(env, "status")).toMatchObject({ runtimeCurrent: false });
  await expect(backendControl(env, "start")).rejects.toThrow("partial");
  fake.control.mockImplementation(async (definition, action) => {
    expect(action).toBe("repair");
    await writeFile(definition.path, definition.contents, { mode: 0o600 });
    return { available: true };
  });
  await backendControl(env, "repair", true);
  const repaired = JSON.parse(await readFile(join(root, "registration.json"), "utf8"));
  expect(repaired.previous).toBeUndefined();
  expect(await backendControl(env, "status")).toMatchObject({ runtimeCurrent: true });
});
