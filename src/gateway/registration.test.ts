import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CODE60_VERSION } from "../core/index.js";
import { privateDirectory, userServiceDefinition, writePrivateJson } from "../platform/index.js";
import { gatewayControl, restoreSchedulerHandoff } from "./registration.js";
import { gatewayRoot } from "./server.js";

const fake = vi.hoisted(() => ({
  control: vi.fn(),
  inspect: vi.fn(),
  management: vi.fn(),
  legacy: vi.fn(),
  legacyRequest: vi.fn(),
}));
vi.mock("../platform/index.js", async (original) => ({
  ...(await original<typeof import("../platform/index.js")>()),
  controlUserService: fake.control,
  inspectUserService: fake.inspect,
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
});
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture(installed = false) {
  if (!installed) fake.inspect.mockResolvedValue({ definitionPresent: false, state: "stopped" });
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
      "gateway",
    );
    await mkdir(dirname(definition.path), { recursive: true, mode: 0o700 });
    await writeFile(definition.path, definition.contents, { mode: 0o600 });
  }
  return { env, directory, root: gatewayRoot(env) };
}
it("keeps uninstalled status read-only and requires explicit consent before installation", async () => {
  const { env, root } = await fixture();
  expect(await gatewayControl(env, "status")).toMatchObject({ installed: false, service: null });
  await expect(gatewayControl(env, "install")).rejects.toThrow("consent");
  await expect(readFile(join(root, "registration.json"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(fake.control).not.toHaveBeenCalled();
});
it("pins plain Node and the Gateway entrypoint, ignoring Electron/AppImage environment", async () => {
  const { env, root } = await fixture();
  await gatewayControl(env, "install", true);
  const saved = JSON.parse(await readFile(join(root, "registration.json"), "utf8"));
  expect(saved.runtime.executable).toBe(await realpath(process.execPath));
  expect(saved.runtime.args[0]).toMatch(/gateway\/main\.js$/);
  expect(saved.runtime.env).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
  expect(fake.control.mock.calls[0]?.[0].path).toContain(
    process.platform === "darwin" ? "code60.gateway" : "code60-gateway",
  );
  await expect(gatewayControl(env, "install", true)).rejects.toThrow("already installed");
});
it("preserves the explicit Codex home path without persisting provider credentials or config payloads", async () => {
  const { env, root } = await fixture();
  await gatewayControl(
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
  await expect(gatewayControl({ ...env, CODEX_HOME: "relative" }, "install", true)).rejects.toThrow(
    "absolute",
  );
  expect(fake.control).not.toHaveBeenCalled();
  await expect(readFile(join(root, "registration.json"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("refuses an unverified responder before stopping or replacing registration", async () => {
  const { env, root } = await fixture(true);
  const before = await readFile(join(root, "registration.json"));
  fake.management.mockResolvedValue({ pid: 99 });
  expect(await gatewayControl(env, "status")).toMatchObject({
    nativeState: "unavailable",
    service: null,
  });
  await expect(gatewayControl(env, "repair", true)).rejects.toThrow("ownership");
  expect(fake.control).not.toHaveBeenCalled();
  expect(await readFile(join(root, "registration.json"))).toEqual(before);
});
it("drains owned work before a supervisor stop and keeps its installation metadata", async () => {
  const { env, root } = await fixture(true);
  await gatewayControl(env, "stop", true);
  expect(fake.management.mock.calls.map((call) => call[1])).toEqual(["status", "shutdown"]);
  expect(fake.control.mock.calls.map((call) => call[1])).toEqual(["stop"]);
  expect(JSON.parse(await readFile(join(root, "registration.json"), "utf8")).installed).toBe(true);
});
it("preserves the original scheduler pause setting across a failed handoff retry", async () => {
  const { env, root } = await fixture();
  fake.legacy.mockResolvedValue({ installed: true, nativeState: "running", service: { pid: 12 } });
  fake.legacyRequest.mockResolvedValue({ pausedAll: false });
  fake.control.mockRejectedValueOnce(new Error("supervisor unavailable"));
  await expect(gatewayControl(env, "install", true)).rejects.toThrow("supervisor");
  fake.legacyRequest.mockResolvedValue({ pausedAll: true });
  await gatewayControl(env, "install", true);
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
  await expect(gatewayControl(env, "install", true)).rejects.toThrow("supervisor");
  const saved = JSON.parse(await readFile(join(root, "registration.json"), "utf8"));
  expect(saved.installed).toBe(false);
  expect(saved.runtime.executable).toBe(await realpath(process.execPath));
  fake.inspect.mockResolvedValue({ definitionPresent: true, state: "running", pid: 123 });
  fake.control.mockClear();
  await expect(gatewayControl(env, "repair", true)).rejects.toThrow("ownership");
  expect(fake.control).not.toHaveBeenCalled();
});

it("reports a same-version registration pointing to another runtime as conflicting without repair", async () => {
  const { env } = await fixture(true);
  expect(await gatewayControl(env, "status")).toMatchObject({ runtimeCurrent: false });
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
    "gateway",
  );
  await writeFile(definition.path, "unrelated outside edit", { mode: 0o600 });
  await expect(gatewayControl(env, "repair", true)).rejects.toThrow("definition ownership changed");
  await expect(gatewayControl(env, "status")).rejects.toThrow("definition ownership changed");
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
  await expect(gatewayControl(env, "repair", true)).rejects.toThrow("enrollment failed");
  const partial = JSON.parse(await readFile(join(root, "registration.json"), "utf8"));
  expect(partial.previous).toEqual({ runtime: saved.runtime, appVersion: saved.appVersion });
  expect(partial.runtime.args[0]).toMatch(/gateway\/main\.js$/);
  expect(await gatewayControl(env, "status")).toMatchObject({ runtimeCurrent: false });
  await expect(gatewayControl(env, "start")).rejects.toThrow("partial");
  fake.control.mockImplementation(async (definition, action) => {
    expect(action).toBe("repair");
    await writeFile(definition.path, definition.contents, { mode: 0o600 });
    return { available: true };
  });
  await gatewayControl(env, "repair", true);
  const repaired = JSON.parse(await readFile(join(root, "registration.json"), "utf8"));
  expect(repaired.previous).toBeUndefined();
  expect(await gatewayControl(env, "status")).toMatchObject({ runtimeCurrent: true });
});
