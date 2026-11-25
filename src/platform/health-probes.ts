import { lstat, opendir, stat, statfs } from "node:fs/promises";
import {
  arch,
  cpus,
  freemem,
  hostname,
  networkInterfaces,
  type as osType,
  platform,
  release,
  totalmem,
  uptime,
} from "node:os";
import { dirname, join } from "node:path";
import { primaryPrivateIPv4 } from "./lan-address.js";
import { fileCode } from "./private-state.js";

export interface PlatformLocalAddress {
  interfaceName: string;
  family: "IPv4" | "IPv6";
  address: string;
  primary: boolean;
}

export interface PlatformMachineInfo {
  platform: string;
  osName: string;
  osRelease: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  uptimeSeconds: number;
  timeZone: string;
  localTimeIso: string;
  hostname: string;
  localAddresses: PlatformLocalAddress[];
  primaryPrivateIPv4: string | null;
  proxyConfigured: boolean;
  proxySummary: string | null;
}

export interface VolumeProbeInput {
  id: string;
  label: string;
  path: string;
}

export interface VolumeProbeResult {
  id: string;
  label: string;
  availableBytes: number | null;
  totalBytes: number | null;
  freePercent: number | null;
  sharedWith?: string;
  error?: string;
}

export interface PrivateDirectoryAudit {
  status: "ok" | "missing" | "unsafe" | "error";
  code?: "not_directory" | "symlink" | "foreign_owner" | "broad_permissions" | "unreadable";
}

export interface BoundedSizeResult {
  bytes: number;
  entries: number;
  truncated: boolean;
  missing: boolean;
}

function describeOsName(currentPlatform: string, osRelease: string): string {
  if (currentPlatform === "darwin") return `macOS (Darwin ${osRelease})`;
  if (currentPlatform === "linux") return `Linux ${osRelease}`;
  return `${osType()} ${osRelease}`;
}

/** Extract sanitized proxy hostnames only; never return embedded credentials or paths. */
export function summarizeProxyEnv(env: Readonly<NodeJS.ProcessEnv>): {
  configured: boolean;
  summary: string | null;
} {
  const keys = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];
  const hosts = new Set<string>();
  let configured = false;
  for (const key of keys) {
    const raw = env[key]?.trim();
    if (!raw) continue;
    configured = true;
    try {
      const parsed = new URL(raw.includes("://") ? raw : `http://${raw}`);
      if (parsed.hostname) {
        hosts.add(parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname);
      }
    } catch {
      hosts.add("configured (invalid URL)");
    }
  }
  if (!configured) return { configured: false, summary: null };
  const noProxy = env.NO_PROXY?.trim() || env.no_proxy?.trim();
  const hostText = hosts.size ? [...hosts].join(", ") : "configured";
  return {
    configured: true,
    summary: noProxy ? `${hostText} (NO_PROXY set)` : hostText,
  };
}

export async function readMachineInfo(
  env: Readonly<NodeJS.ProcessEnv> = process.env,
): Promise<PlatformMachineInfo> {
  const primaryIp = await primaryPrivateIPv4().catch(() => null);
  const interfaces = networkInterfaces();
  const addresses: PlatformLocalAddress[] = [];
  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      if (entry.family !== "IPv4" && entry.family !== "IPv6") continue;
      if (entry.family === "IPv6" && entry.address.startsWith("fe80:")) continue;
      addresses.push({
        interfaceName,
        family: entry.family,
        address: entry.address,
        primary: entry.family === "IPv4" && primaryIp !== null && entry.address === primaryIp,
      });
    }
  }
  addresses.sort((left, right) => {
    if (left.primary !== right.primary) return left.primary ? -1 : 1;
    if (left.family !== right.family) return left.family === "IPv4" ? -1 : 1;
    return left.interfaceName.localeCompare(right.interfaceName);
  });
  const cpuList = cpus();
  const cpuModel = cpuList[0]?.model?.trim() || "Unknown CPU";
  const currentPlatform = platform();
  const osRelease = release();
  let timeZone = "UTC";
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    /* Fallback to UTC if Intl timezone lookup fails. */
  }
  const proxy = summarizeProxyEnv(env);
  return {
    platform: currentPlatform,
    osName: describeOsName(currentPlatform, osRelease),
    osRelease,
    arch: arch(),
    cpuModel,
    cpuCores: cpuList.length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytes: freemem(),
    uptimeSeconds: uptime(),
    timeZone,
    localTimeIso: new Date().toISOString(),
    hostname: hostname(),
    localAddresses: addresses.slice(0, 12),
    primaryPrivateIPv4: primaryIp,
    proxyConfigured: proxy.configured,
    proxySummary: proxy.summary,
  };
}

async function resolveExistingAncestor(target: string): Promise<string | null> {
  let current = target;
  for (let depth = 0; depth < 32; depth++) {
    try {
      await stat(current);
      return current;
    } catch (error) {
      if (fileCode(error) !== "ENOENT") return null;
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
  return null;
}

export async function readVolumeSpace(
  inputs: readonly VolumeProbeInput[],
): Promise<VolumeProbeResult[]> {
  const seenByDevice = new Map<bigint, VolumeProbeResult>();
  const results: VolumeProbeResult[] = [];
  for (const input of inputs) {
    const probePath = await resolveExistingAncestor(input.path);
    if (!probePath) {
      results.push({
        id: input.id,
        label: input.label,
        availableBytes: null,
        totalBytes: null,
        freePercent: null,
        error: "Path could not be inspected",
      });
      continue;
    }
    try {
      const info = await stat(probePath, { bigint: true });
      const existing = seenByDevice.get(info.dev);
      if (existing) {
        results.push({
          id: input.id,
          label: input.label,
          availableBytes: existing.availableBytes,
          totalBytes: existing.totalBytes,
          freePercent: existing.freePercent,
          sharedWith: existing.label,
        });
        continue;
      }
      const fsInfo = await statfs(probePath);
      const totalBytes = Number(fsInfo.blocks) * Number(fsInfo.bsize);
      const availableBytes = Number(fsInfo.bavail) * Number(fsInfo.bsize);
      const freePercent =
        totalBytes > 0 ? Math.max(0, Math.min(100, (availableBytes / totalBytes) * 100)) : null;
      const entry: VolumeProbeResult = {
        id: input.id,
        label: input.label,
        availableBytes,
        totalBytes,
        freePercent,
      };
      seenByDevice.set(info.dev, entry);
      results.push(entry);
    } catch {
      results.push({
        id: input.id,
        label: input.label,
        availableBytes: null,
        totalBytes: null,
        freePercent: null,
        error: "Filesystem capacity could not be read",
      });
    }
  }
  return results;
}

export async function inspectPrivateDirectorySafety(path: string): Promise<PrivateDirectoryAudit> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return { status: "unsafe", code: "symlink" };
    if (!info.isDirectory()) return { status: "unsafe", code: "not_directory" };
    const uid = process.getuid?.();
    if (uid !== undefined && info.uid !== uid) return { status: "unsafe", code: "foreign_owner" };
    if ((info.mode & 0o077) !== 0) return { status: "unsafe", code: "broad_permissions" };
    return { status: "ok" };
  } catch (error) {
    if (fileCode(error) === "ENOENT") return { status: "missing" };
    return { status: "error", code: "unreadable" };
  }
}

export async function boundedDirectorySize(
  root: string,
  limits: { maxEntries: number; maxDepth: number },
  signal?: AbortSignal,
): Promise<BoundedSizeResult> {
  let bytes = 0;
  let entries = 0;
  let truncated = false;
  try {
    const rootInfo = await lstat(root);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
      return { bytes: 0, entries: 0, truncated: false, missing: true };
    }
  } catch (error) {
    if (fileCode(error) === "ENOENT")
      return { bytes: 0, entries: 0, truncated: false, missing: true };
    throw error;
  }
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  while (queue.length) {
    signal?.throwIfAborted();
    const current = queue.shift();
    if (!current) break;
    let dir: Awaited<ReturnType<typeof opendir>>;
    try {
      dir = await opendir(current.path);
    } catch {
      continue;
    }
    try {
      for await (const dirent of dir) {
        signal?.throwIfAborted();
        if (entries >= limits.maxEntries) {
          truncated = true;
          return { bytes, entries, truncated, missing: false };
        }
        entries++;
        const child = join(current.path, dirent.name);
        let info: Awaited<ReturnType<typeof lstat>>;
        try {
          info = await lstat(child);
        } catch {
          continue;
        }
        if (info.isSymbolicLink()) continue;
        if (info.isFile()) bytes += info.size;
        else if (info.isDirectory()) {
          if (current.depth < limits.maxDepth)
            queue.push({ path: child, depth: current.depth + 1 });
          else truncated = true;
        }
      }
    } finally {
      await dir.close().catch(() => {});
    }
  }
  return { bytes, entries, truncated, missing: false };
}
