import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CODE60_VERSION } from "../core/index.js";
import { privateDirectory, writePrivateJson } from "../platform/index.js";
import { backendControl, restoreSchedulerHandoff } from "./registration.js";
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
