import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalTransmission } from "./transmission.js";

const fake = vi.hoisted(() => ({
  probe: vi.fn(),
  spawn: vi.fn(),
  resolve: vi.fn(),
  preserve: vi.fn(),
}));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: Object.assign(() => {}, { [Symbol.for("nodejs.util.promisify.custom")]: fake.probe }),
}));
vi.mock("../platform/index.js", async (original) => ({
  ...(await original<typeof import("../platform/index.js")>()),
  spawnOwnedProcess: fake.spawn,
  resolveTransmissionRuntime: fake.resolve,
  preserveTransmissionBundle: fake.preserve,
}));
const roots: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  fake.resolve.mockResolvedValue({
    node: process.execPath,
    entry: "/bundle/engine.js",
    root: "/bundle",
  });
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
it("launches the preserved exact entrypoint without npm and releases only its MCP launcher", async () => {
  const f = await fixture();
  await f.client.connect(new AbortController().signal);
  const [command, temporary, env] = fake.spawn.mock.calls[0] as [
    string[],
    string,
    NodeJS.ProcessEnv,
  ];
  expect(command).toEqual([process.execPath, "/bundle/engine.js", "mcp"]);
  expect(fake.resolve).toHaveBeenCalledWith(
    expect.any(Object),
    "0.1.0-staging.20",
    expect.any(AbortSignal),
  );
  expect(temporary).toBe("/bundle");
  expect(env.TRANSMISSION_STATE_DIR).toBe(join(f.root, "state"));
  expect(env.PATH).toBe("/usr/bin");
  expect(env).not.toHaveProperty("NPM_CONFIG_REGISTRY");
  expect(env).not.toHaveProperty("NODE_OPTIONS");
  expect(env).not.toHaveProperty("npm_config_registry");
  expect(f.child.stop).toHaveBeenCalledWith(1000);
  expect(fake.preserve).not.toHaveBeenCalled();
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
it("stops a failed MCP launcher without removing the persistent engine", async () => {
  const f = await fixture();
  f.call.mockReset().mockRejectedValue(new Error("offline"));
  f.child.hasExited = () => true;
  await expect(f.client.connect(new AbortController().signal)).rejects.toThrow("launcher failed");
  expect(f.child.stop).toHaveBeenCalledOnce();
  expect(fake.preserve).not.toHaveBeenCalled();
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

it("preserves damaged bindings rather than falling back to a replacement", async () => {
  const f = await fixture();
  fake.resolve.mockRejectedValue(new Error("Damaged pinned identity"));
  await expect(f.client.connect(new AbortController().signal)).rejects.toThrow(
    "Damaged pinned identity",
  );
  expect(fake.spawn).not.toHaveBeenCalled();
  expect(fake.preserve).not.toHaveBeenCalled();
});
it("refuses a moved runtime identity before spawning", async () => {
  const f = await fixture();
  fake.probe.mockResolvedValue({
    stdout: JSON.stringify({ version: "24.22.0", executable: "/different/node" }),
  });
  await expect(f.client.connect(new AbortController().signal)).rejects.toThrow(
    "recorded Transmission runtime",
  );
  expect(fake.spawn).not.toHaveBeenCalled();
});
