import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  boundedDirectorySize,
  inspectPrivateDirectorySafety,
  readMachineInfo,
  readVolumeSpace,
  summarizeProxyEnv,
} from "./health-probes.js";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "code60-health-probes-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("platform health probes", () => {
  it("strips credentials from proxy environment variables", () => {
    expect(summarizeProxyEnv({})).toEqual({ configured: false, summary: null });
    const result = summarizeProxyEnv({
      HTTPS_PROXY: "http://alice:super-secret@proxy.corp.example:8443/path",
      NO_PROXY: "localhost,127.0.0.1",
    });
    expect(result.configured).toBe(true);
    expect(result.summary).toBe("proxy.corp.example:8443 (NO_PROXY set)");
    expect(result.summary).not.toContain("alice");
    expect(result.summary).not.toContain("super-secret");
  });

  it("handles malformed proxy values safely without echoing raw input", () => {
    const result = summarizeProxyEnv({ HTTP_PROXY: "://not a valid url with secret-token" });
    expect(result.configured).toBe(true);
    expect(result.summary).toBe("configured (invalid URL)");
    expect(result.summary).not.toContain("secret-token");
  });

  it("reads local machine info without external network requests", async () => {
    const info = await readMachineInfo({ HTTPS_PROXY: "http://proxy.local:3128" });
    expect(info.platform).toBe(process.platform);
    expect(info.arch).toBe(process.arch);
    expect(info.cpuCores).toBeGreaterThan(0);
    expect(info.totalMemoryBytes).toBeGreaterThan(0);
    expect(info.timeZone.length).toBeGreaterThan(0);
    expect(info.hostname.length).toBeGreaterThan(0);
    expect(info.proxyConfigured).toBe(true);
    expect(info.proxySummary).toBe("proxy.local:3128");
  });

  it("reads volume space and deduplicates paths on the same filesystem", async () => {
    const root = await makeTempDir();
    const nested = join(root, "does-not-exist-yet", "child");
    const results = await readVolumeSpace([
      { id: "state", label: "State volume", path: root },
      { id: "nested", label: "Nested missing path", path: nested },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]?.availableBytes).toBeGreaterThan(0);
    expect(results[0]?.totalBytes).toBeGreaterThan(0);
    expect(results[1]?.sharedWith).toBe("State volume");
    expect(results[1]?.availableBytes).toBe(results[0]?.availableBytes);
  });

  it("audits private directory permissions, symlinks, files and missing paths", async () => {
    const root = await makeTempDir();
    const okDir = join(root, "private");
    await mkdir(okDir, { mode: 0o700 });
    expect(await inspectPrivateDirectorySafety(okDir)).toEqual({ status: "ok" });

    const broadDir = join(root, "broad");
    await mkdir(broadDir, { mode: 0o755 });
    await chmod(broadDir, 0o755);
    expect(await inspectPrivateDirectorySafety(broadDir)).toEqual({
      status: "unsafe",
      code: "broad_permissions",
    });

    const regularFile = join(root, "file.txt");
    await writeFile(regularFile, "hi", { mode: 0o600 });
    expect(await inspectPrivateDirectorySafety(regularFile)).toEqual({
      status: "unsafe",
      code: "not_directory",
    });

    const link = join(root, "link");
    await symlink(okDir, link);
    expect(await inspectPrivateDirectorySafety(link)).toEqual({
      status: "unsafe",
      code: "symlink",
    });

    expect(await inspectPrivateDirectorySafety(join(root, "missing"))).toEqual({
      status: "missing",
    });
  });

  it("measures bounded directory sizes and respects limits, missing roots and cancellation", async () => {
    const root = await makeTempDir();
    await writeFile(join(root, "a.bin"), Buffer.alloc(100));
    await mkdir(join(root, "sub"));
    await writeFile(join(root, "sub", "b.bin"), Buffer.alloc(250));
    await symlink(join(root, "a.bin"), join(root, "link.bin"));

    const full = await boundedDirectorySize(root, { maxEntries: 100, maxDepth: 4 });
    expect(full).toEqual({ bytes: 350, entries: 4, truncated: false, missing: false });

    const capped = await boundedDirectorySize(root, { maxEntries: 1, maxDepth: 4 });
    expect(capped.truncated).toBe(true);

    const missing = await boundedDirectorySize(join(root, "nope"), { maxEntries: 10, maxDepth: 2 });
    expect(missing).toEqual({ bytes: 0, entries: 0, truncated: false, missing: true });

    const abort = new AbortController();
    abort.abort();
    await expect(
      boundedDirectorySize(root, { maxEntries: 10, maxDepth: 2 }, abort.signal),
    ).rejects.toThrow();
  });
});
