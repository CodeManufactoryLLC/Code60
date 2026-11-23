import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalTransmission } from "./transmission.js";

const fake = vi.hoisted(() => ({ probe: vi.fn(), spawn: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: Object.assign(() => {}, { [Symbol.for("nodejs.util.promisify.custom")]: fake.probe }),
}));
vi.mock("../platform/index.js", async (original) => ({
  ...(await original<typeof import("../platform/index.js")>()),
  spawnOwnedProcess: fake.spawn,
}));
const roots: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  fake.probe.mockResolvedValue({
    stdout: JSON.stringify({ version: "24.22.0", executable: process.execPath }),
  });
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "transmission-bootstrap-"));
  roots.push(root);
  const client = new LocalTransmission(join(root, "state"), {
    PATH: "/usr/bin",
    NODE_OPTIONS: "unwanted",
    npm_config_registry: "https://invalid.example",
  });
  Object.defineProperty(client, "supported", { value: true });
  const child = {
    pid: 1234,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    hasExited: () => false,
    exited: new Promise(() => {}),
    stop: vi.fn(async () => {}),
  };
  fake.spawn.mockResolvedValue(child);
  const call = vi
    .spyOn(client, "call")
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ ready: true });
  return { root, client, child, call };
}
it("bootstraps only the pinned package in an isolated npm context and releases its launcher", async () => {
  const f = await fixture();
  await f.client.connect(new AbortController().signal);
  const [command, temporary, env] = fake.spawn.mock.calls[0] as [
    string[],
    string,
    NodeJS.ProcessEnv,
  ];
  expect(command).toEqual(["npx", "-y", "code60-transmission-server@0.1.0-staging.20", "mcp"]);
  expect(env.TRANSMISSION_STATE_DIR).toBe(join(f.root, "state"));
  expect(env.NPM_CONFIG_REGISTRY).toBe("https://registry.npmjs.org");
  expect(env.NPM_CONFIG_IGNORE_SCRIPTS).toBe("true");
  expect(env).not.toHaveProperty("NODE_OPTIONS");
  expect(env).not.toHaveProperty("npm_config_registry");
  expect(f.child.stop).toHaveBeenCalledWith(1000);
  await expect(stat(temporary)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(f.root, "state", "endpoint.json")).catch(() => null)).toBeNull();
});
it("attaches to an existing healthy engine without probing or downloading", async () => {
  const f = await fixture();
  f.call.mockReset().mockResolvedValue({ ready: true });
  await f.client.connect(new AbortController().signal);
  expect(fake.probe).not.toHaveBeenCalled();
  expect(fake.spawn).not.toHaveBeenCalled();
});
it.each(["22.12.0", "24.21.0", "25.0.0"])(
  "refuses incompatible external Node %s before launcher execution",
  async (version) => {
    const f = await fixture();
    fake.probe.mockResolvedValue({
      stdout: JSON.stringify({ version, executable: process.execPath }),
    });
    await expect(f.client.connect(new AbortController().signal)).rejects.toThrow("Install Node");
    expect(fake.spawn).not.toHaveBeenCalled();
  },
);
it("stops a failed launcher and removes temporary configuration", async () => {
  const f = await fixture();
  f.call.mockReset().mockRejectedValue(new Error("offline"));
  f.child.hasExited = () => true;
  await expect(f.client.connect(new AbortController().signal)).rejects.toThrow("launcher failed");
  const temporary = fake.spawn.mock.calls[0]?.[1] as string;
  expect(f.child.stop).toHaveBeenCalledOnce();
  await expect(stat(temporary)).rejects.toMatchObject({ code: "ENOENT" });
});
it("honors cancellation before downloading", async () => {
  const f = await fixture();
  const abort = new AbortController();
  abort.abort();
  await expect(f.client.connect(abort.signal)).rejects.toThrow();
  expect(fake.spawn).not.toHaveBeenCalled();
});
it("refuses the unsupported production execution boundary", async () => {
  const f = await fixture();
  Object.defineProperty(f.client, "supported", { value: false });
  await expect(f.client.connect(new AbortController().signal)).rejects.toThrow("macOS");
});
