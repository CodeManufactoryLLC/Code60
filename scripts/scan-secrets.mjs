import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repository = fileURLToPath(new URL("..", import.meta.url));
export const VERSION = "8.30.1";
// Official release asset digests, reviewed independently of the downloaded archive.
export const ARCHIVES = {
  "darwin-arm64": [
    "darwin_arm64.tar.gz",
    "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5",
  ],
  "darwin-x64": [
    "darwin_x64.tar.gz",
    "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709",
  ],
  "linux-arm64": [
    "linux_arm64.tar.gz",
    "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080",
  ],
  "linux-x64": [
    "linux_x64.tar.gz",
    "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
  ],
  "win32-x64": [
    "windows_x64.zip",
    "d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e",
  ],
};

export function verifyArchive(bytes, digest) {
  if (createHash("sha256").update(bytes).digest("hex") !== digest)
    throw new Error("Gitleaks archive checksum mismatch");
}

/** Never copy matches, secrets, author information, or commit messages into diagnostics. */
export function safeFindings(findings, source) {
  if (!Array.isArray(findings)) throw new Error("Invalid Gitleaks report");
  return findings.map((finding) => {
    if (
      typeof finding.RuleID !== "string" ||
      typeof finding.File !== "string" ||
      !Number.isSafeInteger(finding.StartLine) ||
      finding.StartLine < 1 ||
      (finding.Commit !== undefined && !/^(?:[a-f0-9]{40,64})?$/.test(finding.Commit))
    )
      throw new Error("Invalid Gitleaks finding");
    return {
      source,
      rule: finding.RuleID,
      file: finding.File,
      line: finding.StartLine,
      commit: finding.Commit ?? "",
    };
  });
}

export async function installScanner(directory) {
  const asset = ARCHIVES[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error("No pinned Gitleaks binary for this platform");
  const response = await fetch(
    `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_${asset[0]}`,
    { signal: AbortSignal.timeout(60_000) },
  );
  if (!response.ok) throw new Error(`Gitleaks download failed (HTTP ${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyArchive(bytes, asset[1]);
  const archive = join(directory, `scanner.${asset[0].endsWith(".zip") ? "zip" : "tar.gz"}`);
  await writeFile(archive, bytes, { mode: 0o600, flag: "wx" });
  const name = process.platform === "win32" ? "gitleaks.exe" : "gitleaks";
  await execute("tar", ["-xf", archive, "-C", directory, name], { timeout: 30_000 });
  const binary = join(directory, name);
  if (process.platform !== "win32") await chmod(binary, 0o700);
  return binary;
}

/** Nonzero scanner execution and invalid/missing reports must never become a clean scan. */
export async function scan(binary, mode, target, temporary, run = execute) {
  const report = join(temporary, `${mode}-report.json`);
  const args = [
    mode,
    target,
    "--config",
    join(repository, ".gitleaks.toml"),
    "--gitleaks-ignore-path",
    join(temporary, "no-ignores"),
    "--ignore-gitleaks-allow",
    "--redact=100",
    "--no-banner",
    "--no-color",
    "--exit-code=10",
    "--timeout=300",
    "--report-format=json",
    "--report-path",
    report,
  ];
  if (mode === "git") args.push("--log-opts=--all --full-history");
  let code = 0;
  try {
    await run(binary, args, { cwd: target, timeout: 330_000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    code = error.code;
    // Do not echo subprocess stderr, which may include source lines or malformed input.
    if (code !== 10) throw new Error(`Gitleaks ${mode} scan could not complete`);
  }
  const findings = safeFindings(JSON.parse(await readFile(report, "utf8")), mode);
  if ((code === 10) !== findings.length > 0)
    throw new Error("Gitleaks exit status and report disagree");
  return findings;
}

export async function scanRepository(target = repository) {
  const temporary = await mkdtemp(join(tmpdir(), "code60-secrets-"));
  try {
    // Reject shallow checkouts instead of silently claiming to scan complete history.
    const { stdout } = await execute("git", ["rev-parse", "--is-shallow-repository"], {
      cwd: target,
      timeout: 10_000,
    });
    if (stdout.trim() !== "false") throw new Error("Secret scanning requires full Git history");
    const binary = await installScanner(temporary);
    const findings = [];
    // Run sequentially: both scans use the same checkout and scanner.
    for (const mode of ["git", "dir"])
      findings.push(...(await scan(binary, mode, target, temporary)));
    return findings;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error("Usage: npm run scan:secrets");
    const findings = await scanRepository();
    console.log(JSON.stringify({ scanner: `gitleaks ${VERSION}`, findings }, null, 2));
    process.exitCode = findings.length ? 1 : 0;
  } catch {
    console.error(
      "Secret scan could not complete. Check full Git history, GitHub access, and tar availability.",
    );
    process.exitCode = 2;
  }
}
