import { spawn } from "node:child_process";
import { normalize } from "node:path";
import { diagnosticText } from "../platform/index.js";
import { GitError, runGit } from "./exec.js";

type CodebaseGitFetchStatus = "fetched" | "no_remote" | "failed" | "skipped";

export interface CodebaseMainSnapshot {
  topLevel: string;
  commonDir: string;
  branch: string;
  ref: string;
  commit: string;
  hasOrigin: boolean;
  fetchStatus: CodebaseGitFetchStatus;
  fetchWarning?: string;
}

export interface CodebaseTreeEntry {
  path: string;
  oid: string;
  size: number;
}

export interface CodebaseGitOps {
  syncMainBranch(
    repoDir: string,
    options?: { fetch?: boolean; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<CodebaseMainSnapshot>;
  listTreeFiles(
    repoDir: string,
    commit: string,
    signal?: AbortSignal,
  ): Promise<CodebaseTreeEntry[]>;
  readBlobs(
    repoDir: string,
    oids: readonly string[],
    options?: { maxBytes?: number; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<Map<string, string>>;
}

const DEFAULT_FETCH_TIMEOUT_MS = 20_000;
const DEFAULT_BLOB_MAX_BYTES = 256 * 1024;
const DEFAULT_BATCH_TIMEOUT_MS = 60_000;
const NON_INTERACTIVE_ENV: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: "0",
};

async function tryRevParseCommit(
  repoDir: string,
  ref: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const out = await runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], repoDir, {
      signal,
    });
    const commit = out.trim();
    return /^[a-f0-9]{40,64}$/.test(commit) ? commit : null;
  } catch {
    return null;
  }
}

async function resolveOriginHeadBranch(
  repoDir: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const out = await runGit(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], repoDir, {
      signal,
    });
    const ref = out.trim();
    if (ref.startsWith("refs/remotes/origin/")) {
      const branch = ref.slice("refs/remotes/origin/".length);
      return branch && !branch.startsWith("-") ? branch : null;
    }
  } catch {
    /* Fall through to ls-remote or local branch checks. */
  }
  return null;
}

async function resolveRemoteDefaultBranch(
  repoDir: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const out = await runGit(["ls-remote", "--symref", "origin", "HEAD"], repoDir, {
      signal,
      timeoutMs,
      env: NON_INTERACTIVE_ENV,
    });
    for (const line of out.split("\n")) {
      const match = /^ref:\s+refs\/heads\/([^\t\r\n]+)\tHEAD$/.exec(line.trim());
      if (match?.[1] && !match[1].startsWith("-")) return match[1];
    }
  } catch {
    /* Non-fatal: caller falls back to local refs. */
  }
  return null;
}

async function currentBranchName(repoDir: string, signal?: AbortSignal): Promise<string> {
  try {
    const out = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], repoDir, { signal });
    const name = out.trim();
    if (name) return name;
  } catch {
    /* Detached HEAD. */
  }
  return "HEAD";
}

function isMissingRemoteRef(error: unknown): boolean {
  const text = error instanceof GitError ? `${error.stderr} ${error.message}` : String(error);
  return /couldn't find remote ref|no such ref|not a valid ref/i.test(text);
}

/**
 * Resolves the latest commit on `main` (or the repository's default branch when `main` does not
 * exist) without mutating the working tree, staging index, HEAD, or local branches.
 */
export async function syncMainBranch(
  repoDir: string,
  options: { fetch?: boolean; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<CodebaseMainSnapshot> {
  const signal = options.signal;
  signal?.throwIfAborted();
  let topLevel: string;
  let commonDir: string;
  try {
    const out = await runGit(
      ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"],
      repoDir,
      { signal },
    );
    const lines = out.trim().split("\n");
    if (!lines[0] || !lines[1]) throw new Error("Could not determine the Git repository");
    topLevel = normalize(lines[0]);
    commonDir = normalize(lines[1]);
  } catch (error) {
    if (error instanceof GitError) throw new Error("Target directory is not a Git repository");
    throw error;
  }

  let hasOrigin = false;
  try {
    const url = (await runGit(["remote", "get-url", "origin"], topLevel, { signal })).trim();
    hasOrigin = url.length > 0;
  } catch {
    hasOrigin = false;
  }

  let branch = "main";
  let fetchStatus: CodebaseGitFetchStatus = hasOrigin
    ? options.fetch === false
      ? "skipped"
      : "fetched"
    : "no_remote";
  let fetchWarning: string | undefined;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  if (hasOrigin && options.fetch !== false) {
    try {
      await runGit(["fetch", "--no-tags", "--quiet", "origin", "main"], topLevel, {
        signal,
        timeoutMs,
        env: NON_INTERACTIVE_ENV,
      });
      branch = "main";
      fetchStatus = "fetched";
    } catch (error) {
      if (signal?.aborted) throw error;
      if (isMissingRemoteRef(error)) {
        const remoteDefault =
          (await resolveOriginHeadBranch(topLevel, signal)) ??
          (await resolveRemoteDefaultBranch(topLevel, signal, timeoutMs));
        if (remoteDefault && remoteDefault !== "main") {
          try {
            await runGit(["fetch", "--no-tags", "--quiet", "origin", remoteDefault], topLevel, {
              signal,
              timeoutMs,
              env: NON_INTERACTIVE_ENV,
            });
            branch = remoteDefault;
            fetchStatus = "fetched";
          } catch (fallbackError) {
            if (signal?.aborted) throw fallbackError;
            fetchStatus = "failed";
            fetchWarning = diagnosticText(
              fallbackError instanceof Error ? fallbackError.message : "origin fetch failed",
            ).slice(0, 240);
          }
        } else {
          fetchStatus = "failed";
          fetchWarning = "Remote 'origin' does not have a 'main' branch; using local branch.";
        }
      } else {
        fetchStatus = "failed";
        fetchWarning = diagnosticText(
          error instanceof Error ? error.message : "origin fetch failed",
        ).slice(0, 240);
      }
    }
  } else if (hasOrigin) {
    const originHead = await resolveOriginHeadBranch(topLevel, signal);
    const hasOriginMain =
      (await tryRevParseCommit(topLevel, "refs/remotes/origin/main", signal)) !== null;
    if (!hasOriginMain && originHead) branch = originHead;
  }

  const candidates: Array<{ branch: string; ref: string }> = [];
  if (hasOrigin) {
    candidates.push({ branch, ref: `refs/remotes/origin/${branch}` });
  }
  candidates.push({ branch, ref: `refs/heads/${branch}` });
  if (branch !== "main") {
    candidates.push({ branch: "main", ref: "refs/heads/main" });
  }
  const headBranch = await currentBranchName(topLevel, signal);
  candidates.push({ branch: headBranch, ref: "HEAD" });

  for (const candidate of candidates) {
    const commit = await tryRevParseCommit(topLevel, candidate.ref, signal);
    if (commit) {
      return {
        topLevel,
        commonDir,
        branch: candidate.branch,
        ref: candidate.ref,
        commit,
        hasOrigin,
        fetchStatus,
        ...(fetchWarning ? { fetchWarning } : {}),
      };
    }
  }

  throw new Error("Git repository has no commits yet");
}

export function parseLsTreeOutput(output: string): CodebaseTreeEntry[] {
  const entries: CodebaseTreeEntry[] = [];
  for (const record of output.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const meta = record.slice(0, tab);
    const path = record.slice(tab + 1);
    if (!path) continue;
    const match = /^(\d{6}) (blob|tree|commit) ([a-f0-9]{40,64})\s+(\d+|-)$/.exec(meta);
    if (!match) continue;
    const [, mode, type, oid, rawSize] = match;
    if (type !== "blob" || (mode !== "100644" && mode !== "100755")) continue;
    const size = Number(rawSize);
    if (!Number.isSafeInteger(size) || size < 0 || !oid) continue;
    entries.push({ path, oid, size });
  }
  return entries;
}

/** Lists tracked regular blob files in a Git commit tree without touching the working tree. */
export async function listTreeFiles(
  repoDir: string,
  commit: string,
  signal?: AbortSignal,
): Promise<CodebaseTreeEntry[]> {
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("Invalid Git commit hash");
  const out = await runGit(["ls-tree", "-r", "-l", "-z", commit], repoDir, { signal });
  return parseLsTreeOutput(out);
}

/**
 * Reads UTF-8 text blobs in bulk via a single `git cat-file --batch` stream.
 * Oversized, missing, binary (NUL byte), and invalid-UTF-8 blobs are skipped safely.
 */
export function readBlobs(
  repoDir: string,
  oids: readonly string[],
  options: { maxBytes?: number; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Map<string, string>> {
  const unique = [...new Set(oids.filter((oid) => /^[a-f0-9]{40,64}$/.test(oid)))];
  if (unique.length === 0) return Promise.resolve(new Map());
  const maxBytes = options.maxBytes ?? DEFAULT_BLOB_MAX_BYTES;
  const signal = options.signal;
  const timeoutMs = options.timeoutMs ?? DEFAULT_BATCH_TIMEOUT_MS;
  const decoder = new TextDecoder("utf-8", { fatal: true });

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const child = spawn("git", ["cat-file", "--batch"], {
      cwd: repoDir,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const result = new Map<string, string>();
    let buffer: Buffer = Buffer.alloc(0);
    let pendingHeader: { oid: string; type: string; size: number } | null = null;
    let settled = false;
    let stderr = "";

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      child.kill("SIGKILL");
      reject(error);
    };
    const onAbort = () => fail(signal?.reason ?? new Error("Git blob read cancelled"));
    const timer = setTimeout(() => fail(new Error("Git blob read timed out")), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });

    const drain = () => {
      for (;;) {
        if (pendingHeader === null) {
          const newline = buffer.indexOf(0x0a);
          if (newline < 0) return;
          const line = buffer.subarray(0, newline).toString("utf8");
          buffer = buffer.subarray(newline + 1);
          if (line.endsWith(" missing")) continue;
          const match = /^([a-f0-9]{40,64}) (\S+) (\d+)$/.exec(line);
          if (!match?.[1] || !match[2] || !match[3]) {
            fail(new Error("Unexpected git cat-file --batch header"));
            return;
          }
          const size = Number(match[3]);
          if (!Number.isSafeInteger(size) || size < 0) {
            fail(new Error("Invalid git blob size"));
            return;
          }
          pendingHeader = { oid: match[1], type: match[2], size };
        }
        // Git writes `<size>` bytes followed by a trailing `\n`.
        const needed = pendingHeader.size + 1;
        if (buffer.length < needed) return;
        const payload = buffer.subarray(0, pendingHeader.size);
        buffer = buffer.subarray(needed);
        const current = pendingHeader;
        pendingHeader = null;
        if (current.type !== "blob" || current.size === 0 || current.size > maxBytes) continue;
        if (payload.includes(0)) continue;
        try {
          result.set(current.oid, decoder.decode(payload));
        } catch {
          /* Skip non-UTF-8 binary content. */
        }
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
      drain();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => fail(error));
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (code !== 0) {
        reject(new Error(`git cat-file --batch failed: ${stderr.trim() || String(code)}`));
        return;
      }
      resolve(result);
    });

    child.stdin.on("error", () => {
      /* Handled by child close/error. */
    });
    child.stdin.end(`${unique.join("\n")}\n`);
  });
}

export const codebaseGit: CodebaseGitOps = {
  syncMainBranch,
  listTreeFiles,
  readBlobs,
};
