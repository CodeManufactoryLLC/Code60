import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface NativeProcessIdentity {
  createdAt: string;
  owner: string;
  job?: string | undefined;
}

export function windowsHelper(): string {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const packaged = resources && join(resources, "native", "code60-host.exe");
  if (packaged && existsSync(packaged)) return packaged;
  const file = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../native/win32",
    process.arch,
    "code60-host.exe",
  );
  if (!existsSync(file))
    throw new Error(
      "The Code60 Windows helper is missing. Run 'npm run build:helper' with Microsoft C++ Build Tools and the Windows 11 SDK installed.",
    );
  return file;
}

export function helperOutput(
  args: readonly string[],
  maxBuffer = 2 * 1024 * 1024,
  timeoutMs = 7_000,
  signal?: AbortSignal,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      windowsHelper(),
      [...args],
      {
        windowsHide: true,
        timeout: timeoutMs,
        ...(signal ? { signal } : {}),
        maxBuffer,
        encoding: "buffer",
      },
      (error, stdout, stderr) => {
        if (error)
          reject(nativeError(stderr.toString("utf8").trim() || "Windows helper operation failed"));
        else resolve(stdout);
      },
    );
  });
}

function nativeError(message: string): Error {
  const code = /Windows error (2|3)\)/.test(message)
    ? "ENOENT"
    : /Windows error 5\)/.test(message)
      ? "EACCES"
      : /Windows error (32|33)\)/.test(message)
        ? "EBUSY"
        : undefined;
  return Object.assign(new Error(code ? `${code}: ${message}` : message), code ? { code } : {});
}

export function helperSync(args: readonly string[]): string {
  try {
    return execFileSync(windowsHelper(), [...args], {
      windowsHide: true,
      timeout: 7_000,
      maxBuffer: 128 * 1024,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer | string }).stderr?.toString().trim();
    throw new Error(
      stderr || (error instanceof Error ? error.message : "Windows helper operation failed"),
    );
  }
}

export function parseNativeIdentity(value: unknown): NativeProcessIdentity {
  if (value === null || typeof value !== "object") throw new Error("Invalid native identity");
  const record = value as Record<string, unknown>;
  if (
    typeof record.createdAt !== "string" ||
    !/^\d{1,20}$/.test(record.createdAt) ||
    typeof record.owner !== "string" ||
    !/^S-\d+(?:-\d+)+$/.test(record.owner) ||
    (record.job !== undefined &&
      (typeof record.job !== "string" || !/^Local\\Code60-[a-f\d-]{36}$/.test(record.job)))
  )
    throw new Error("Invalid native identity");
  return {
    createdAt: record.createdAt,
    owner: record.owner,
    ...(record.job === undefined ? {} : { job: record.job as string }),
  };
}

export async function nativeIdentity(pid: number): Promise<NativeProcessIdentity | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid process ID");
  const value: unknown = JSON.parse(
    (await helperOutput(["identity", String(pid)])).toString("utf8"),
  );
  return value === null ? null : parseNativeIdentity(value);
}

export async function ownedJob(
  action: "status" | "stop",
  pid: number,
  identity: NativeProcessIdentity,
  timeoutMs = 7_000,
): Promise<"gone" | "alive"> {
  parseNativeIdentity(identity);
  if (!identity.job || !Number.isSafeInteger(pid) || pid <= 0)
    throw new Error("Native job identity is missing; refusing operation");
  const output = (
    await helperOutput(
      [action, String(pid), identity.createdAt, identity.owner, identity.job],
      undefined,
      timeoutMs,
    )
  )
    .toString("utf8")
    .trim();
  if (output !== "gone" && output !== "alive") throw new Error("Invalid native job status");
  return output;
}
