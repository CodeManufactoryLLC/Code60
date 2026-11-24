import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runManagement } from "./cli.js";

const directories: string[] = [];
const inputDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
afterEach(async () => {
  vi.restoreAllMocks();
  if (inputDescriptor) Object.defineProperty(process.stdin, "isTTY", inputDescriptor);
  else Reflect.deleteProperty(process.stdin, "isTTY");
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function environment() {
  const directory = await mkdtemp(join(tmpdir(), "code60-management-"));
  directories.push(directory);
  return { directory, env: { HOME: directory, XDG_STATE_HOME: join(directory, "state") } };
}
it("prints machine-readable uninstalled status without mutating storage", async () => {
  const { env, directory } = await environment();
  const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  await runManagement(["service", "status"], env);
  expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual({
    installed: false,
    nativeState: "stopped",
    service: null,
  });
  expect(await readdir(directory)).toEqual([]);
});
it.each(["install", "repair", "stop", "uninstall"])(
  "does not prompt indefinitely for non-TTY %s",
  async (action) => {
    const { env, directory } = await environment();
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
    await expect(runManagement(["service", action], env)).rejects.toThrow("--yes");
    expect(await readdir(directory)).toEqual([]);
  },
);
it("rejects execution commands and unknown flags; open requires existing enrollment", async () => {
  const { env } = await environment();
  for (const args of [
    ["run", "prompt"],
    ["open", "extra"],
    ["service", "install", "--force"],
    ["service", "run"],
    ["pairing", "maybe"],
    ["pairing", "off", "--force"],
    ["workflows", "start"],
    ["workflows", "login", "--yes"],
  ])
    await expect(runManagement(args, env)).rejects.toThrow("Use code60");
  await expect(runManagement(["open"], env)).rejects.toThrow("Install the login backend");
  const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  await runManagement(["--help"], env);
  expect(String(output.mock.calls[0]?.[0])).toContain("code60 service");
  expect(String(output.mock.calls[0]?.[0])).toContain("code60 pairing");
  expect(String(output.mock.calls[0]?.[0])).toContain("code60 workflows login");
});
it("workflow authentication never prompts or initializes storage without a terminal", async () => {
  const { env, directory } = await environment();
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
  await expect(runManagement(["workflows", "login"], env)).rejects.toThrow(
    /interactive terminal|macOS Apple Silicon/,
  );
  expect(await readdir(directory)).toEqual([]);
});

it("exposes the default and persists consented pairing policy changes without installing a service", async () => {
  const { env } = await environment();
  const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  await runManagement(["pairing", "status"], env);
  await runManagement(["pairing", "on", "--yes"], env);
  await runManagement(["pairing"], env);
  await runManagement(["pairing", "off", "--yes"], env);
  expect(output.mock.calls.map((call) => JSON.parse(String(call[0])))).toEqual([
    { requirePairing: false },
    { requirePairing: true },
    { requirePairing: true },
    { requirePairing: false },
  ]);
});
it.each(["on", "off"])("requires explicit non-TTY consent for pairing %s", async (action) => {
  const { env, directory } = await environment();
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
  await expect(runManagement(["pairing", action], env)).rejects.toThrow("--yes");
  expect(await readdir(directory)).toEqual([]);
});

it("combined status is read-only on fresh state and accepts no mutation flags", async () => {
  const { env, directory } = await environment();
  const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  await runManagement(["status"], env);
  const value = JSON.parse(String(output.mock.calls[0]?.[0]));
  expect(value.installation.state).toBe("not-installed");
  expect(value.backend.installed).toBe(false);
  expect(value.database.state).toBe("unavailable");
  expect(await readdir(directory)).toEqual([]);
  await expect(runManagement(["status", "--yes"], env)).rejects.toThrow("Use code60 status");
});
